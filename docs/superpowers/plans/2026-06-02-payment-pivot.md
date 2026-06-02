# Payment Pivot — Bank Transfer + AI Verification + QR Check-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sterile Stripe checkout with a bank-transfer-screenshot flow verified by Claude Sonnet 4.6, emit signed QR codes on approval, and ship an admin scanner surface for door staff.

**Architecture:** Customer uploads a receipt screenshot to `POST /api/checkout/verify`. The screenshot stays in memory only — multer `memoryStorage`. The route calls a `PaymentVerifier` (real impl uses Claude Sonnet 4.6 vision via the Anthropic SDK; a `FakeVerifier` exists for tests). On approval, holds are converted to tickets in one Prisma transaction and a per-seat HMAC-signed QR is generated and embedded in a Resend email. Door staff scan QRs on `/admin/scan`, which POSTs the signed payload to `/api/admin/scan`; the route verifies the HMAC and idempotently stamps redemption.

**Tech Stack:** Express 5 + Prisma 5 (backend), Next.js 15 App Router (frontend), Postgres 16 in Docker, Anthropic SDK (`@anthropic-ai/sdk`), Resend (`resend` + `@react-email/components`), `qrcode` for PNG generation, `multer` for upload handling, `vitest` + `supertest` for backend tests, `jsqr` for browser scanning.

**Spec:** [docs/superpowers/specs/2026-06-02-payment-pivot-design.md](../specs/2026-06-02-payment-pivot-design.md)

---

## File map

**Backend — new:**
- `backend/src/services/qrSigning.ts` — sign + verify QR payloads
- `backend/src/services/paymentVerifier.ts` — interface, FakeVerifier, ClaudeVerifier
- `backend/src/services/orders.ts` — find-or-create pending Order, convert holds → tickets
- `backend/src/services/email.ts` — Resend client + three templates
- `backend/src/services/qrRender.ts` — wraps `qrcode` for PNG buffer rendering
- `backend/src/routes/checkoutVerify.ts` — `POST /api/checkout/verify`
- `backend/src/routes/admin.ts` — `/api/admin/scan`, `/api/admin/door`, `/api/admin/manual-checkin`
- `backend/src/routes/resend.ts` — `POST /api/orders/:code/resend-email`
- `backend/src/auth/requireRole.ts` — role-gating middleware
- `backend/src/test/setup.ts` — vitest harness (Prisma test DB, supertest app)
- `backend/src/test/factories.ts` — typed builders for User/Movie/Seat/Order

**Backend — modified:**
- `backend/prisma/schema.prisma` — drop `stripeSessionId`, add `Ticket.qrPayload/redeemedAt/redeemedBy`, add `Order.verificationAttempts/verifiedAt/rejectionReason`, add `PaymentReceipt`, add `User.role` + `UserRole` enum
- `backend/src/env.ts` — add `QR_SIGNING_SECRET`, `BANK_ACCOUNT_REF`, `PAYMENT_ARCHIVE_EMAIL`, `ANTHROPIC_API_KEY`; remove `STRIPE_*`
- `backend/src/index.ts` — mount new routes
- `backend/.env.example` — same shape changes
- `backend/package.json` — drop `stripe`, add `multer`, `qrcode`, `resend`, `@react-email/components`, `@anthropic-ai/sdk`, `vitest`, `supertest`, `@types/multer`, `@types/qrcode`, `@types/supertest`

**Backend — deleted:**
- `backend/src/services/checkout.ts`
- `backend/src/routes/checkout.ts`

**Frontend — new:**
- `frontend/app/admin/scan/page.tsx` + `ScanClient.tsx`
- `frontend/app/admin/door/page.tsx` + `DoorClient.tsx`
- `frontend/app/components/PaymentInstructionsCard.tsx`
- `frontend/app/components/ScreenshotUploader.tsx`
- `frontend/app/components/QrBlock.tsx`
- `frontend/lib/checkoutVerify.ts` — browser client for upload + verdict

**Frontend — modified:**
- `frontend/app/checkout/page.tsx` + `components/CheckoutClient.tsx` — replace PAGAR CTA with instructions + upload + verifying state
- `frontend/app/success/page.tsx` + `components/TicketStub.tsx` — embed QR PNG
- `frontend/app/components/ResendEmailButton.tsx` — wire to real endpoint
- `frontend/app/cancel/page.tsx` + `components/CancelClient.tsx` — drop Stripe-cancel framing
- `frontend/lib/orders.ts` — extend `Order` with `qrPayloads` map
- `frontend/lib/copy.ts` — Spanish strings for new surfaces

---

## Phase A — Foundation

### Task 1: Schema migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260602120000_payment_pivot/migration.sql`

- [ ] **Step 1: Update `schema.prisma`** — apply these diffs in place:

Add enum near other enums:

```prisma
enum UserRole {
  customer
  doorStaff
  admin
}
```

In `model User`, add:

```prisma
  role         UserRole     @default(customer)
  redemptions  Ticket[]     @relation("Redemptions")
```

In `model Order`, replace `stripeSessionId String? @unique` with:

```prisma
  verificationAttempts Int       @default(0)
  verifiedAt           DateTime?
  rejectionReason      String?
  paymentReceipt       PaymentReceipt?
```

In `model Ticket`, add after `userId`:

```prisma
  qrPayload      String   @unique
  redeemedAt     DateTime?
  redeemedBy     String?
  redeemedByUser User?    @relation("Redemptions", fields: [redeemedBy], references: [id])
```

Add new model at the bottom:

```prisma
model PaymentReceipt {
  id         String   @id @default(cuid())
  orderId    String   @unique
  order      Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  txnId      String   @unique
  verifiedAt DateTime @default(now())
}
```

- [ ] **Step 2: Create migration SQL by hand** (Prisma's `migrate dev` needs a TTY; this project's convention is to write the SQL file directly — see `20260521120000_order_code/migration.sql` for the pattern).

Create `backend/prisma/migrations/20260602120000_payment_pivot/migration.sql`:

```sql
-- UserRole enum
CREATE TYPE "UserRole" AS ENUM ('customer', 'doorStaff', 'admin');

-- User.role
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'customer';

-- Order: drop stripeSessionId, add verification fields
ALTER TABLE "Order" DROP COLUMN IF EXISTS "stripeSessionId";
ALTER TABLE "Order" ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "rejectionReason" TEXT;

-- Ticket: qrPayload (nullable bootstrap, then NOT NULL after backfill — but there are no paid orders yet so we just enforce NOT NULL on insert via app code; allow NULL at the SQL level for existing rows).
ALTER TABLE "Ticket" ADD COLUMN "qrPayload" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "redeemedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "redeemedBy" TEXT;
CREATE UNIQUE INDEX "Ticket_qrPayload_key" ON "Ticket"("qrPayload");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_redeemedBy_fkey" FOREIGN KEY ("redeemedBy") REFERENCES "User"("id") ON DELETE SET NULL;

-- PaymentReceipt
CREATE TABLE "PaymentReceipt" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "txnId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentReceipt_orderId_key" ON "PaymentReceipt"("orderId");
CREATE UNIQUE INDEX "PaymentReceipt_txnId_key" ON "PaymentReceipt"("txnId");
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE;
```

- [ ] **Step 3: Apply migration + regen client**

Run from `backend/`:

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: migration applies cleanly, `@prisma/client` types update.

- [ ] **Step 4: Typecheck**

Run from `backend/`: `npm run typecheck`
Expected: PASS (existing code still compiles — `stripeSessionId` only referenced in soon-to-be-deleted files; that's fine for now because the column was nullable).

If `services/checkout.ts` or `routes/checkout.ts` references break the typecheck, comment those files' contents to a stub `export {}` — they'll be deleted in Task 6.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma backend/src
git commit -m "Schema: drop Stripe column, add verification + QR + role fields"
```

---

### Task 2: Backend test harness

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/src/test/setup.ts`
- Create: `backend/src/test/factories.ts`
- Create: `backend/.env.test`

- [ ] **Step 1: Add dev deps**

Run from `backend/`:

```bash
npm install -D vitest supertest @types/supertest
```

- [ ] **Step 2: Add `test` script in `package.json`** — under `"scripts"`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `backend/vitest.config.ts`**:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["src/test/setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 4: Create `backend/.env.test`**:

```
DATABASE_URL=postgresql://cuatro:cuatro@localhost:5433/cuatro_test
NODE_ENV=test
SESSION_SECRET=test-secret-test-secret-test-secret
QR_SIGNING_SECRET=0000000000000000000000000000000000000000000000000000000000000000
BANK_ACCOUNT_REF=Test Bank · 0000000000
PAYMENT_ARCHIVE_EMAIL=pagos-test@cuatro.test
ANTHROPIC_API_KEY=fake
RESEND_API_KEY=fake
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:4000
```

- [ ] **Step 5: Create `backend/src/test/setup.ts`**:

```ts
import "dotenv/config";
import { beforeAll, beforeEach, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { prisma } from "../db.js";

beforeAll(() => {
  // .env.test loaded by dotenv via process.env override
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://cuatro:cuatro@localhost:5433/cuatro_test";
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
});

beforeEach(async () => {
  // Tables truncated in FK-safe order. Fast and avoids re-running migrations.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "PaymentReceipt", "Ticket", "SeatHold", "Order", "Seat", "Movie", "User" RESTART IDENTITY CASCADE;`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 6: Create `backend/src/test/factories.ts`**:

```ts
import { prisma } from "../db.js";
import bcrypt from "bcryptjs";

export async function makeUser(overrides: { email?: string; role?: "customer" | "doorStaff" | "admin"; name?: string } = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? `u${Date.now()}-${Math.random()}@test.local`,
      name: overrides.name ?? "Test User",
      provider: "email",
      passwordHash: await bcrypt.hash("password123", 4),
      role: overrides.role ?? "customer",
    },
  });
}

export async function makeMovie() {
  return prisma.movie.create({
    data: {
      title: "CUATRO",
      director: "Jose Javier Diaz",
      synopsis: "test",
      startsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      runtimeMin: 90,
      language: "ES",
      year: 2026,
      venueName: "Test Venue",
      venueAddress: "Test",
      priceLps: 12,
    },
  });
}

export async function makeSeats(movieId: string, labels: string[]) {
  return Promise.all(
    labels.map((label, i) =>
      prisma.seat.create({
        data: {
          movieId,
          row: label[0],
          num: Number(label.slice(1)),
          col: i + 1,
          label,
        },
      }),
    ),
  );
}

export async function makeHold(userId: string, seatId: string, ttlMs = 10 * 60 * 1000) {
  return prisma.seatHold.create({
    data: { userId, seatId, expiresAt: new Date(Date.now() + ttlMs) },
  });
}
```

- [ ] **Step 7: Create the test DB**

Run from project root:

```bash
docker compose exec -T postgres psql -U cuatro -d postgres -c "CREATE DATABASE cuatro_test OWNER cuatro;" 2>&1 || true
```

(Idempotent — ignores the "database exists" error.)

- [ ] **Step 8: Smoke test the harness** — create `backend/src/test/setup.test.ts`:

```ts
import { test, expect } from "vitest";
import { makeUser } from "./factories.js";

test("harness creates and truncates", async () => {
  const u = await makeUser();
  expect(u.id).toBeTruthy();
});
```

Run from `backend/`:

```bash
DATABASE_URL=postgresql://cuatro:cuatro@localhost:5433/cuatro_test npm test
```

Expected: 1 passed.

- [ ] **Step 9: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.ts backend/src/test backend/.env.test
git commit -m "Add vitest harness with truncating Postgres setup + factories"
```

---

### Task 3: QR signing module

**Files:**
- Create: `backend/src/services/qrSigning.ts`
- Create: `backend/src/services/qrSigning.test.ts`
- Modify: `backend/src/env.ts`
- Modify: `backend/.env.example`

- [ ] **Step 1: Extend `env.ts`** — replace the schema with:

```ts
const schema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  BACKEND_URL: z.string().url().default("http://localhost:4000"),

  SESSION_SECRET: z.string().min(16).default("dev-secret-change-me-please-32chars"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Payment pivot
  QR_SIGNING_SECRET: z.string().regex(/^[0-9a-f]{64}$/, "must be 32-byte hex"),
  BANK_ACCOUNT_REF: z.string().min(1),
  PAYMENT_ARCHIVE_EMAIL: z.string().email(),
  ANTHROPIC_API_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
});
```

- [ ] **Step 2: Update `backend/.env.example`** — drop `STRIPE_*` lines, add:

```
QR_SIGNING_SECRET=          # openssl rand -hex 32
BANK_ACCOUNT_REF=Banco Atlántida · Cuenta 0000000000 · Cuatro Films
PAYMENT_ARCHIVE_EMAIL=pagos@cuatro.example
ANTHROPIC_API_KEY=
RESEND_API_KEY=
```

Drop `backend/.env` Stripe lines and add real values (generate the secret with `openssl rand -hex 32`).

- [ ] **Step 3: Write the failing test** — `backend/src/services/qrSigning.test.ts`:

```ts
import { test, expect, describe } from "vitest";
import { signQrPayload, verifyQrPayload } from "./qrSigning.js";

describe("qrSigning", () => {
  test("round-trips a valid payload", () => {
    const payload = signQrPayload("ABC123", "A7");
    expect(payload.startsWith("cuatro:1:ABC123:A7:")).toBe(true);
    expect(verifyQrPayload(payload)).toEqual({ orderCode: "ABC123", seatId: "A7" });
  });

  test("rejects a tampered signature", () => {
    const payload = signQrPayload("ABC123", "A7");
    const tampered = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    expect(verifyQrPayload(tampered)).toBeNull();
  });

  test("rejects a tampered seat", () => {
    const payload = signQrPayload("ABC123", "A7");
    const parts = payload.split(":");
    parts[3] = "A8";
    expect(verifyQrPayload(parts.join(":"))).toBeNull();
  });

  test("rejects wrong version", () => {
    expect(verifyQrPayload("cuatro:2:ABC123:A7:xxx")).toBeNull();
  });

  test("rejects malformed", () => {
    expect(verifyQrPayload("not-a-payload")).toBeNull();
    expect(verifyQrPayload("cuatro:1:ABC123:A7")).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to see failure**

Run from `backend/`: `npm test -- qrSigning`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `backend/src/services/qrSigning.ts`**:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

const VERSION = "1";
const PREFIX = `cuatro:${VERSION}`;

function sign(input: string): string {
  return createHmac("sha256", Buffer.from(env.QR_SIGNING_SECRET, "hex"))
    .update(input)
    .digest("base64url");
}

export function signQrPayload(orderCode: string, seatId: string): string {
  const base = `${PREFIX}:${orderCode}:${seatId}`;
  return `${base}:${sign(base)}`;
}

export function verifyQrPayload(payload: string): { orderCode: string; seatId: string } | null {
  const parts = payload.split(":");
  if (parts.length !== 5) return null;
  const [scheme, version, orderCode, seatId, sig] = parts;
  if (scheme !== "cuatro" || version !== VERSION) return null;

  const expected = sign(`${PREFIX}:${orderCode}:${seatId}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { orderCode, seatId };
}
```

- [ ] **Step 6: Run test to verify pass**

Run from `backend/`: `npm test -- qrSigning`
Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/src/env.ts backend/src/services/qrSigning.ts backend/src/services/qrSigning.test.ts backend/.env.example
git commit -m "Add QR HMAC signing service + tests"
```

---

### Task 4: PaymentVerifier interface + FakeVerifier

**Files:**
- Create: `backend/src/services/paymentVerifier.ts`
- Create: `backend/src/services/paymentVerifier.test.ts`

- [ ] **Step 1: Write the interface + FakeVerifier + tests first** — `backend/src/services/paymentVerifier.test.ts`:

```ts
import { test, expect } from "vitest";
import { FakeVerifier, type VerifyInput } from "./paymentVerifier.js";

const baseInput: VerifyInput = {
  imageBuffer: Buffer.from([0xff, 0xd8, 0xff]),
  mimeType: "image/jpeg",
  expected: {
    amountLps: 48,
    accountRef: "Banco Test 12345",
    orderCode: "ABC123",
    holdCreatedAt: new Date(),
  },
};

test("FakeVerifier returns canned approve verdict", async () => {
  const v = new FakeVerifier({ ok: true, txnId: "TXN-001", senderName: "Test" });
  expect(await v.verify(baseInput)).toEqual({ ok: true, txnId: "TXN-001", senderName: "Test" });
});

test("FakeVerifier returns canned reject verdict", async () => {
  const v = new FakeVerifier({ ok: false, reason: "amount-mismatch", detail: "no coincide" });
  const result = await v.verify(baseInput);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("amount-mismatch");
});

test("FakeVerifier can throw to simulate timeout", async () => {
  const v = new FakeVerifier(new Error("timeout"));
  await expect(v.verify(baseInput)).rejects.toThrow("timeout");
});
```

- [ ] **Step 2: Run test to see failure**

Run from `backend/`: `npm test -- paymentVerifier`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `backend/src/services/paymentVerifier.ts`**:

```ts
export type VerifyInput = {
  imageBuffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  expected: {
    amountLps: number;
    accountRef: string;
    orderCode: string;
    holdCreatedAt: Date;
  };
};

export type RejectionReason =
  | "amount-mismatch"
  | "wrong-account"
  | "stale-receipt"
  | "missing-txn-id"
  | "not-a-receipt"
  | "unreadable";

export type VerifyVerdict =
  | { ok: true; txnId: string; senderName: string | null }
  | { ok: false; reason: RejectionReason; detail: string };

export interface PaymentVerifier {
  verify(input: VerifyInput): Promise<VerifyVerdict>;
}

export class FakeVerifier implements PaymentVerifier {
  constructor(private readonly canned: VerifyVerdict | Error) {}
  async verify(_input: VerifyInput): Promise<VerifyVerdict> {
    if (this.canned instanceof Error) throw this.canned;
    return this.canned;
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run from `backend/`: `npm test -- paymentVerifier`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/paymentVerifier.ts backend/src/services/paymentVerifier.test.ts
git commit -m "Add PaymentVerifier interface + FakeVerifier for tests"
```

---

### Task 5: Real ClaudeVerifier

**Files:**
- Modify: `backend/src/services/paymentVerifier.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Install Anthropic SDK**

Run from `backend/`:

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Append `ClaudeVerifier` to `backend/src/services/paymentVerifier.ts`**:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";

const VERDICT_TOOL = {
  name: "emit_verdict",
  description: "Emit the structured verification verdict.",
  input_schema: {
    type: "object",
    oneOf: [
      {
        type: "object",
        properties: {
          ok: { const: true },
          txnId: { type: "string", minLength: 1 },
          senderName: { type: ["string", "null"] },
        },
        required: ["ok", "txnId", "senderName"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          ok: { const: false },
          reason: {
            type: "string",
            enum: ["amount-mismatch", "wrong-account", "stale-receipt", "missing-txn-id", "not-a-receipt", "unreadable"],
          },
          detail: { type: "string", maxLength: 120 },
        },
        required: ["ok", "reason", "detail"],
        additionalProperties: false,
      },
    ],
  },
} as const;

const SYSTEM_PROMPT = `Eres un verificador de comprobantes de pago para una función única del cine CUATRO en Honduras.
El cliente paga por transferencia bancaria o Tigo Money. Recibes el comprobante (captura de pantalla) y los datos esperados.
Debes aprobar SOLO si TODAS las verificaciones pasan:
1. El monto en el comprobante es exactamente igual al monto esperado (en LPS / HNL).
2. La cuenta destino del comprobante coincide con la cuenta esperada.
3. La fecha del comprobante está dentro de las últimas 24 horas.
4. El comprobante muestra un número de transacción/referencia no vacío.
5. La imagen es claramente un comprobante bancario o de Tigo Money (no un meme, foto al azar, ni nota manuscrita).

Si una verificación falla, devuelve el rechazo MÁS específico posible y un "detail" en español de máximo 120 caracteres dirigido al cliente (ej. "El monto no coincide — esperábamos L 48.00").

Responde SIEMPRE mediante la herramienta emit_verdict.`;

export class ClaudeVerifier implements PaymentVerifier {
  private client: Anthropic;
  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async verify(input: VerifyInput): Promise<VerifyVerdict> {
    const userText = [
      `Datos esperados:`,
      `- Monto: L ${input.expected.amountLps.toFixed(2)}`,
      `- Cuenta destino: ${input.expected.accountRef}`,
      `- Referencia esperada (mencionada en el voucher): ${input.expected.orderCode}`,
      `- Reservación creada: ${input.expected.holdCreatedAt.toISOString()}`,
    ].join("\n");

    const response = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [VERDICT_TOOL as any],
      tool_choice: { type: "tool", name: "emit_verdict" } as any,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: input.mimeType, data: input.imageBuffer.toString("base64") },
            },
            { type: "text", text: userText },
          ],
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== "emit_verdict") {
      throw new Error("verifier-returned-no-tool-use");
    }
    return toolUse.input as VerifyVerdict;
  }
}
```

- [ ] **Step 3: Typecheck**

Run from `backend/`: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/services/paymentVerifier.ts
git commit -m "Add ClaudeVerifier using Sonnet 4.6 with single-tool emit_verdict"
```

---

## Phase B — Payment flow

### Task 6: Remove Stripe debris

**Files:**
- Delete: `backend/src/services/checkout.ts`
- Delete: `backend/src/routes/checkout.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Delete the files**

```bash
cd /Users/alejandro/Desktop/Cuatro
rm backend/src/services/checkout.ts backend/src/routes/checkout.ts
```

- [ ] **Step 2: Remove the import + mount in `backend/src/index.ts`** — delete the `import checkoutRouter from "./routes/checkout.js";` line and the `app.use("/api/checkout", checkoutRouter);` mount. Leave the rest of the file untouched.

- [ ] **Step 3: Uninstall `stripe`**

Run from `backend/`:

```bash
npm uninstall stripe
```

- [ ] **Step 4: Typecheck**

Run from `backend/`: `npm run typecheck`
Expected: PASS (no remaining references).

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/package.json backend/package-lock.json
git commit -m "Strip Stripe debris from backend"
```

---

### Task 7: Order service — find-or-create + holds → tickets

**Files:**
- Create: `backend/src/services/orders.ts`
- Create: `backend/src/services/orders.test.ts`

- [ ] **Step 1: Write the failing test** — `backend/src/services/orders.test.ts`:

```ts
import { test, expect, beforeEach } from "vitest";
import { prisma } from "../db.js";
import { makeUser, makeMovie, makeSeats, makeHold } from "../test/factories.js";
import { findOrCreatePendingOrder, finalizeOrderAsPaid } from "./orders.js";

async function setup() {
  const user = await makeUser();
  const movie = await makeMovie();
  const seats = await makeSeats(movie.id, ["A1", "A2"]);
  for (const seat of seats) await makeHold(user.id, seat.id);
  return { user, movie, seats };
}

test("creates a pending order when none exists", async () => {
  const { user } = await setup();
  const order = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: user.name ?? "X" });
  expect(order.status).toBe("pending");
  expect(order.code).toMatch(/^[A-Z2-9]{6}$/);
  expect(order.verificationAttempts).toBe(0);
});

test("reuses the existing pending order for the same user", async () => {
  const { user } = await setup();
  const a = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: "X" });
  const b = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: "X" });
  expect(b.id).toBe(a.id);
});

test("finalizeOrderAsPaid converts holds → tickets + sets status", async () => {
  const { user } = await setup();
  const order = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: "X" });
  const finalized = await finalizeOrderAsPaid({
    orderId: order.id,
    userId: user.id,
    qrPayloadFor: (seatLabel) => `cuatro:1:${order.code}:${seatLabel}:sig`,
    txnId: "TXN-1",
  });
  expect(finalized.tickets).toHaveLength(2);
  expect(finalized.tickets.every((t) => t.qrPayload?.startsWith("cuatro:1:"))).toBe(true);
  const dbHolds = await prisma.seatHold.findMany({ where: { userId: user.id } });
  expect(dbHolds).toHaveLength(0);
  const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
  expect(dbOrder?.status).toBe("paid");
  expect(dbOrder?.verifiedAt).toBeTruthy();
  const receipt = await prisma.paymentReceipt.findUnique({ where: { orderId: order.id } });
  expect(receipt?.txnId).toBe("TXN-1");
});

test("rejects duplicate txnId across orders", async () => {
  const { user } = await setup();
  const order1 = await findOrCreatePendingOrder({ userId: user.id, totalLps: 24, guestName: "X" });
  await finalizeOrderAsPaid({
    orderId: order1.id,
    userId: user.id,
    qrPayloadFor: (s) => `cuatro:1:${order1.code}:${s}:sig`,
    txnId: "TXN-DUP",
  });

  const user2 = await makeUser();
  const movie = (await prisma.movie.findFirst())!;
  const seats = await makeSeats(movie.id, ["B1", "B2"]);
  for (const seat of seats) await makeHold(user2.id, seat.id);
  const order2 = await findOrCreatePendingOrder({ userId: user2.id, totalLps: 24, guestName: "Y" });

  await expect(
    finalizeOrderAsPaid({
      orderId: order2.id,
      userId: user2.id,
      qrPayloadFor: (s) => `cuatro:1:${order2.code}:${s}:sig`,
      txnId: "TXN-DUP",
    }),
  ).rejects.toThrow(/duplicate/);
});
```

- [ ] **Step 2: Run test to see failure**

Run from `backend/`: `npm test -- orders`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `backend/src/services/orders.ts`**:

```ts
import { customAlphabet } from "nanoid";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

const ORDER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newOrderCode = customAlphabet(ORDER_CODE_ALPHABET, 6);

export async function findOrCreatePendingOrder(args: {
  userId: string;
  totalLps: number;
  guestName: string;
}) {
  const existing = await prisma.order.findFirst({
    where: { userId: args.userId, status: "pending" },
  });
  if (existing) return existing;

  return prisma.order.create({
    data: {
      code: newOrderCode(),
      userId: args.userId,
      status: "pending",
      totalLps: args.totalLps,
      guestName: args.guestName,
    },
  });
}

export async function incrementOrderAttempts(orderId: string, reason: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: { verificationAttempts: { increment: 1 }, rejectionReason: reason },
  });
}

export async function finalizeOrderAsPaid(args: {
  orderId: string;
  userId: string;
  qrPayloadFor: (seatLabel: string) => string;
  txnId: string;
}) {
  return prisma.$transaction(async (tx) => {
    // Duplicate-txn check is the first thing inside the tx so concurrent
    // attempts collide deterministically on the unique index.
    const dup = await tx.paymentReceipt.findUnique({ where: { txnId: args.txnId } });
    if (dup) throw new Error(`duplicate-txn-id:${args.txnId}`);

    const holds = await tx.seatHold.findMany({
      where: { userId: args.userId, expiresAt: { gt: new Date() } },
      include: { seat: { select: { id: true, label: true } } },
    });
    if (holds.length === 0) throw new Error("no-active-holds");

    const tickets = await Promise.all(
      holds.map((h) =>
        tx.ticket.create({
          data: {
            orderId: args.orderId,
            seatId: h.seat.id,
            userId: args.userId,
            qrPayload: args.qrPayloadFor(h.seat.label),
          },
          include: { seat: { select: { label: true } } },
        }),
      ),
    );

    await tx.seatHold.deleteMany({ where: { userId: args.userId } });

    await tx.paymentReceipt.create({
      data: { orderId: args.orderId, txnId: args.txnId },
    });

    const order = await tx.order.update({
      where: { id: args.orderId },
      data: { status: "paid", verifiedAt: new Date(), rejectionReason: null },
    });

    return { order, tickets };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
```

- [ ] **Step 4: Run test to verify pass**

Run from `backend/`: `npm test -- orders`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orders.ts backend/src/services/orders.test.ts
git commit -m "Add order service: find-or-create pending + finalizeAsPaid"
```

---

### Task 8: QR rendering helper

**Files:**
- Create: `backend/src/services/qrRender.ts`
- Create: `backend/src/services/qrRender.test.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Install qrcode**

Run from `backend/`:

```bash
npm install qrcode
npm install -D @types/qrcode
```

- [ ] **Step 2: Write the test** — `backend/src/services/qrRender.test.ts`:

```ts
import { test, expect } from "vitest";
import { renderQrPng } from "./qrRender.js";

test("renders a PNG buffer with a PNG magic prefix", async () => {
  const buf = await renderQrPng("cuatro:1:ABC123:A7:sig");
  expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  expect(buf.length).toBeGreaterThan(200);
});
```

- [ ] **Step 3: Implement `backend/src/services/qrRender.ts`**:

```ts
import QRCode from "qrcode";

export async function renderQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: "png",
    errorCorrectionLevel: "M",
    width: 512,
    margin: 2,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}
```

- [ ] **Step 4: Run test**

Run from `backend/`: `npm test -- qrRender`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/services/qrRender.ts backend/src/services/qrRender.test.ts
git commit -m "Add qrRender PNG buffer helper"
```

---

### Task 9: Email service + templates

**Files:**
- Create: `backend/src/services/email.ts`
- Create: `backend/src/emails/PaymentArchiveEmail.tsx`
- Create: `backend/src/emails/OrderConfirmationEmail.tsx`
- Create: `backend/src/emails/OrderRejectionEmail.tsx`
- Modify: `backend/package.json`
- Modify: `backend/tsconfig.json` (enable JSX)

- [ ] **Step 1: Install deps**

Run from `backend/`:

```bash
npm install resend @react-email/components react react-dom
npm install -D @types/react @types/react-dom
```

- [ ] **Step 2: Enable JSX in `backend/tsconfig.json`** — add to `compilerOptions`:

```json
    "jsx": "react-jsx"
```

- [ ] **Step 3: Create `backend/src/emails/OrderConfirmationEmail.tsx`**:

```tsx
import { Html, Head, Body, Container, Heading, Text, Section, Img } from "@react-email/components";
import * as React from "react";

export type ConfirmationProps = {
  guestName: string;
  orderCode: string;
  showtimeIso: string;
  venueName: string;
  totalLps: number;
  seats: { label: string; qrCid: string }[];
};

export function OrderConfirmationEmail(p: ConfirmationProps) {
  return (
    <Html lang="es">
      <Head />
      <Body style={{ background: "#0c0c0d", color: "#f5f1e6", fontFamily: "serif", margin: 0 }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
          <Heading style={{ fontSize: 28 }}>Tu reservación CUATRO</Heading>
          <Text>Hola {p.guestName},</Text>
          <Text>Tu pago está verificado. Te esperamos {new Date(p.showtimeIso).toLocaleString("es-HN")} en {p.venueName}.</Text>
          <Text>Orden: <strong>{p.orderCode}</strong> · Total: L {p.totalLps.toFixed(2)}</Text>
          {p.seats.map((s) => (
            <Section key={s.label} style={{ borderTop: "1px solid #333", padding: "16px 0", textAlign: "center" }}>
              <Text style={{ fontSize: 24, margin: 0 }}>{s.label.replace(/^(.)(\d+)$/, "$1·$2")}</Text>
              <Img src={`cid:${s.qrCid}`} alt={`QR ${s.label}`} width={180} height={180} />
            </Section>
          ))}
          <Text style={{ marginTop: 24, fontSize: 12 }}>En la puerta verificamos por nombre y escaneamos el QR de cada butaca.</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 4: Create `backend/src/emails/PaymentArchiveEmail.tsx`**:

```tsx
import { Html, Body, Container, Heading, Text } from "@react-email/components";
import * as React from "react";

export type ArchiveProps = {
  orderCode: string;
  guestName: string;
  email: string;
  amountLps: number;
  seats: string[];
  verdict: "approved" | "rejected";
  reason?: string;
  detail?: string;
  txnId?: string;
};

export function PaymentArchiveEmail(p: ArchiveProps) {
  return (
    <Html lang="es">
      <Body style={{ fontFamily: "monospace" }}>
        <Container>
          <Heading>[{p.verdict.toUpperCase()}] {p.orderCode}</Heading>
          <Text>Cliente: {p.guestName} &lt;{p.email}&gt;</Text>
          <Text>Monto: L {p.amountLps.toFixed(2)}</Text>
          <Text>Butacas: {p.seats.join(", ")}</Text>
          {p.verdict === "approved" && <Text>Txn ID: {p.txnId}</Text>}
          {p.verdict === "rejected" && <Text>Motivo: {p.reason} — {p.detail}</Text>}
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 5: Create `backend/src/emails/OrderRejectionEmail.tsx`**:

```tsx
import { Html, Body, Container, Heading, Text, Link } from "@react-email/components";
import * as React from "react";

export type RejectionProps = {
  guestName: string;
  orderCode: string;
  detail: string;
  retryUrl: string;
};

export function OrderRejectionEmail(p: RejectionProps) {
  return (
    <Html lang="es">
      <Body style={{ background: "#0c0c0d", color: "#f5f1e6", fontFamily: "serif" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
          <Heading>No pudimos verificar tu pago</Heading>
          <Text>Hola {p.guestName},</Text>
          <Text>Tu orden {p.orderCode} no pudo verificarse: {p.detail}</Text>
          <Text>Si tu pago es válido, intenta de nuevo: <Link href={p.retryUrl}>{p.retryUrl}</Link></Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 6: Create `backend/src/services/email.ts`**:

```ts
import { Resend } from "resend";
import { render } from "@react-email/components";
import { env } from "../env.js";
import { OrderConfirmationEmail, type ConfirmationProps } from "../emails/OrderConfirmationEmail.js";
import { PaymentArchiveEmail, type ArchiveProps } from "../emails/PaymentArchiveEmail.js";
import { OrderRejectionEmail, type RejectionProps } from "../emails/OrderRejectionEmail.js";

const resend = new Resend(env.RESEND_API_KEY);
const FROM = "Cuatro <no-reply@cuatro.example>";

export async function sendOrderConfirmation(args: {
  to: string;
  props: ConfirmationProps;
  qrAttachments: { filename: string; content: Buffer; cid: string }[];
}) {
  const html = await render(OrderConfirmationEmail(args.props));
  return resend.emails.send({
    from: FROM,
    to: args.to,
    subject: `Tu reservación CUATRO · ${args.props.orderCode}`,
    html,
    attachments: args.qrAttachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
      content_id: a.cid,
    })),
  } as any);
}

export async function sendPaymentArchive(args: {
  props: ArchiveProps;
  screenshot?: { filename: string; content: Buffer; mimeType: string };
}) {
  const html = await render(PaymentArchiveEmail(args.props));
  return resend.emails.send({
    from: FROM,
    to: env.PAYMENT_ARCHIVE_EMAIL,
    subject: `[CUATRO] ${args.props.orderCode} · L${args.props.amountLps.toFixed(2)} · ${args.props.guestName}`,
    html,
    attachments: args.screenshot
      ? [{ filename: args.screenshot.filename, content: args.screenshot.content.toString("base64") }]
      : undefined,
  } as any);
}

export async function sendOrderRejection(args: { to: string; props: RejectionProps }) {
  const html = await render(OrderRejectionEmail(args.props));
  return resend.emails.send({
    from: FROM,
    to: args.to,
    subject: `No pudimos verificar tu pago · ${args.props.orderCode}`,
    html,
  } as any);
}
```

- [ ] **Step 7: Typecheck**

Run from `backend/`: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/tsconfig.json backend/src/emails backend/src/services/email.ts
git commit -m "Add Resend email service + three templates"
```

---

### Task 10: `POST /api/checkout/verify` route

**Files:**
- Create: `backend/src/routes/checkoutVerify.ts`
- Create: `backend/src/routes/checkoutVerify.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Install multer**

Run from `backend/`:

```bash
npm install multer
npm install -D @types/multer
```

- [ ] **Step 2: Create the route factory** — `backend/src/routes/checkoutVerify.ts`. We pass `verifier` + `mailer` in so tests can swap them out:

```ts
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireAuth } from "../auth/routes.js";
import { signQrPayload } from "../services/qrSigning.js";
import { renderQrPng } from "../services/qrRender.js";
import { finalizeOrderAsPaid, findOrCreatePendingOrder, incrementOrderAttempts } from "../services/orders.js";
import { releaseUserHolds } from "../services/holds.js";
import { type PaymentVerifier, type VerifyVerdict } from "../services/paymentVerifier.js";
import { sendOrderConfirmation, sendOrderRejection, sendPaymentArchive } from "../services/email.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/png" || file.mimetype === "image/jpeg") cb(null, true);
    else cb(new Error("unsupported-mime"));
  },
});

const SOFT_CAP_MS = 30_000;
const MAX_ATTEMPTS = 3;

export type Mailer = {
  confirmation: typeof sendOrderConfirmation;
  archive: typeof sendPaymentArchive;
  rejection: typeof sendOrderRejection;
};

const defaultMailer: Mailer = {
  confirmation: sendOrderConfirmation,
  archive: sendPaymentArchive,
  rejection: sendOrderRejection,
};

export function checkoutVerifyRouter(opts: { verifier: PaymentVerifier; mailer?: Mailer }) {
  const router = Router();
  const mailer = opts.mailer ?? defaultMailer;

  router.post("/verify", requireAuth, upload.single("screenshot"), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "screenshot required" });
    const user = req.user!;

    const holds = await prisma.seatHold.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      include: { seat: { include: { movie: true } } },
    });
    if (holds.length === 0) return res.status(410).json({ status: "holds-expired" });

    const movie = holds[0].seat.movie;
    const totalLps = movie.priceLps * holds.length;

    const order = await findOrCreatePendingOrder({
      userId: user.id,
      totalLps,
      guestName: user.name ?? user.email,
    });

    if (order.verificationAttempts >= MAX_ATTEMPTS) {
      await releaseUserHolds(user.id);
      return res.status(410).json({ status: "attempts-exhausted" });
    }

    const verifyPromise = opts.verifier.verify({
      imageBuffer: req.file.buffer,
      mimeType: req.file.mimetype as "image/png" | "image/jpeg",
      expected: {
        amountLps: totalLps,
        accountRef: env.BANK_ACCOUNT_REF,
        orderCode: order.code,
        holdCreatedAt: holds[0].createdAt,
      },
    });

    const verdict = await Promise.race<VerifyVerdict | "timeout">([
      verifyPromise.catch((e: unknown) => {
        throw e;
      }),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), SOFT_CAP_MS)),
    ]).catch((): VerifyVerdict => ({ ok: false, reason: "unreadable", detail: "No pudimos leer el comprobante." }));

    if (verdict === "timeout") {
      const screenshotCopy = { buffer: Buffer.from(req.file.buffer), mimeType: req.file.mimetype, filename: req.file.originalname };
      verifyPromise
        .then((v) => applyVerdict({ verdict: v, user, order, totalLps, seats: holds.map((h) => h.seat.label), screenshotCopy, mailer }))
        .catch(async () => {
          await incrementOrderAttempts(order.id, "unreadable");
        });
      return res.status(202).json({ status: "pending" });
    }

    return applyVerdictAndRespond({
      verdict,
      user,
      order,
      totalLps,
      seats: holds.map((h) => h.seat.label),
      screenshotCopy: { buffer: req.file.buffer, mimeType: req.file.mimetype, filename: req.file.originalname },
      mailer,
      res,
    });
  });

  return router;
}

async function applyVerdictAndRespond(args: {
  verdict: VerifyVerdict;
  user: { id: string; email: string; name: string | null };
  order: { id: string; code: string };
  totalLps: number;
  seats: string[];
  screenshotCopy: { buffer: Buffer; mimeType: string; filename: string };
  mailer: Mailer;
  res: Response;
}) {
  if (args.verdict.ok) {
    try {
      await finalizeAndEmail({ ...args, txnId: args.verdict.txnId });
      return args.res.status(200).json({ status: "approved", orderCode: args.order.code });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("duplicate-txn-id")) {
        await incrementOrderAttempts(args.order.id, "duplicate-receipt");
        await args.mailer.archive({
          props: archiveProps({ ...args, verdict: { ok: false, reason: "missing-txn-id", detail: "Comprobante reutilizado." } }),
          screenshot: { filename: args.screenshotCopy.filename, content: args.screenshotCopy.buffer, mimeType: args.screenshotCopy.mimeType },
        });
        const left = MAX_ATTEMPTS - (await prisma.order.findUnique({ where: { id: args.order.id } }))!.verificationAttempts;
        return args.res.status(422).json({ status: "rejected", reason: "duplicate-receipt", detail: "Comprobante ya usado.", attemptsLeft: Math.max(left, 0) });
      }
      throw e;
    }
  }
  await incrementOrderAttempts(args.order.id, args.verdict.reason);
  await args.mailer.archive({
    props: archiveProps({ ...args, verdict: args.verdict }),
    screenshot: { filename: args.screenshotCopy.filename, content: args.screenshotCopy.buffer, mimeType: args.screenshotCopy.mimeType },
  });
  const updated = await prisma.order.findUnique({ where: { id: args.order.id } });
  return args.res.status(422).json({
    status: "rejected",
    reason: args.verdict.reason,
    detail: args.verdict.detail,
    attemptsLeft: Math.max(MAX_ATTEMPTS - (updated?.verificationAttempts ?? MAX_ATTEMPTS), 0),
  });
}

async function applyVerdict(args: {
  verdict: VerifyVerdict;
  user: { id: string; email: string; name: string | null };
  order: { id: string; code: string };
  totalLps: number;
  seats: string[];
  screenshotCopy: { buffer: Buffer; mimeType: string; filename: string };
  mailer: Mailer;
}) {
  if (args.verdict.ok) {
    await finalizeAndEmail({ ...args, txnId: args.verdict.txnId });
    return;
  }
  await incrementOrderAttempts(args.order.id, args.verdict.reason);
  await args.mailer.archive({
    props: archiveProps({ ...args, verdict: args.verdict }),
    screenshot: { filename: args.screenshotCopy.filename, content: args.screenshotCopy.buffer, mimeType: args.screenshotCopy.mimeType },
  });
  await args.mailer.rejection({
    to: args.user.email,
    props: {
      guestName: args.user.name ?? "amigo",
      orderCode: args.order.code,
      detail: args.verdict.detail,
      retryUrl: `${env.FRONTEND_URL}/checkout?retry=${args.order.code}`,
    },
  });
}

async function finalizeAndEmail(args: {
  user: { id: string; email: string; name: string | null };
  order: { id: string; code: string };
  totalLps: number;
  seats: string[];
  txnId: string;
  mailer: Mailer;
}) {
  const finalized = await finalizeOrderAsPaid({
    orderId: args.order.id,
    userId: args.user.id,
    qrPayloadFor: (label) => signQrPayload(args.order.code, label),
    txnId: args.txnId,
  });

  const movie = (await prisma.movie.findFirst())!;
  const qrAttachments = await Promise.all(
    finalized.tickets.map(async (t) => {
      const png = await renderQrPng(t.qrPayload!);
      return { filename: `qr-${t.seat.label}.png`, content: png, cid: `qr-${t.seat.label}` };
    }),
  );

  await args.mailer.confirmation({
    to: args.user.email,
    props: {
      guestName: args.user.name ?? "amigo",
      orderCode: args.order.code,
      showtimeIso: movie.startsAt.toISOString(),
      venueName: movie.venueName,
      totalLps: args.totalLps,
      seats: finalized.tickets.map((t) => ({ label: t.seat.label, qrCid: `qr-${t.seat.label}` })),
    },
    qrAttachments,
  });

  await args.mailer.archive({
    props: {
      orderCode: args.order.code,
      guestName: args.user.name ?? args.user.email,
      email: args.user.email,
      amountLps: args.totalLps,
      seats: args.seats,
      verdict: "approved",
      txnId: args.txnId,
    },
  });
}

function archiveProps(args: {
  user: { email: string; name: string | null };
  order: { code: string };
  totalLps: number;
  seats: string[];
  verdict: VerifyVerdict;
}) {
  if (args.verdict.ok) {
    return {
      orderCode: args.order.code,
      guestName: args.user.name ?? args.user.email,
      email: args.user.email,
      amountLps: args.totalLps,
      seats: args.seats,
      verdict: "approved" as const,
      txnId: args.verdict.txnId,
    };
  }
  return {
    orderCode: args.order.code,
    guestName: args.user.name ?? args.user.email,
    email: args.user.email,
    amountLps: args.totalLps,
    seats: args.seats,
    verdict: "rejected" as const,
    reason: args.verdict.reason,
    detail: args.verdict.detail,
  };
}
```

- [ ] **Step 3: Mount in `backend/src/index.ts`** — add to imports + after `seatsRouter` mount:

```ts
import { checkoutVerifyRouter } from "./routes/checkoutVerify.js";
import { ClaudeVerifier } from "./services/paymentVerifier.js";
// ...
app.use("/api/checkout", checkoutVerifyRouter({ verifier: new ClaudeVerifier() }));
```

- [ ] **Step 4: Write the route tests** — `backend/src/routes/checkoutVerify.test.ts`. Uses `FakeVerifier` and a mock `Mailer` to avoid Resend calls:

```ts
import { test, expect, vi, beforeEach } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
import { prisma } from "../db.js";
import { checkoutVerifyRouter, type Mailer } from "./checkoutVerify.js";
import { FakeVerifier } from "../services/paymentVerifier.js";
import { makeUser, makeMovie, makeSeats, makeHold } from "../test/factories.js";

function buildApp(verifier: FakeVerifier, mailer: Mailer, userId: string) {
  const app = express();
  app.use(session({ secret: "x", resave: false, saveUninitialized: true }));
  app.use((req, _res, next) => {
    (req as any).user = { id: userId, email: "u@test.local", name: "Test" };
    (req as any).isAuthenticated = () => true;
    next();
  });
  app.use("/api/checkout", checkoutVerifyRouter({ verifier, mailer }));
  return app;
}

function fakeMailer(): Mailer {
  return {
    confirmation: vi.fn().mockResolvedValue({ id: "e1" }) as any,
    archive: vi.fn().mockResolvedValue({ id: "e2" }) as any,
    rejection: vi.fn().mockResolvedValue({ id: "e3" }) as any,
  };
}

async function seedScenario() {
  const user = await makeUser({ name: "Alex" });
  const movie = await makeMovie();
  const seats = await makeSeats(movie.id, ["A1", "A2"]);
  for (const s of seats) await makeHold(user.id, s.id);
  return { user, movie, seats };
}

const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("approve → 200, tickets created, holds gone, confirmation + archive emails sent", async () => {
  const { user, movie } = await seedScenario();
  const mailer = fakeMailer();
  const verifier = new FakeVerifier({ ok: true, txnId: "TXN-1", senderName: "Alex" });
  const app = buildApp(verifier, mailer, user.id);

  const res = await request(app)
    .post("/api/checkout/verify")
    .attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe("approved");
  const tickets = await prisma.ticket.findMany({ where: { userId: user.id } });
  expect(tickets).toHaveLength(2);
  expect(tickets.every((t) => t.qrPayload?.startsWith("cuatro:1:"))).toBe(true);
  const holds = await prisma.seatHold.findMany({ where: { userId: user.id } });
  expect(holds).toHaveLength(0);
  expect((mailer.confirmation as any).mock.calls).toHaveLength(1);
  expect((mailer.archive as any).mock.calls).toHaveLength(1);
});

test("reject → 422, attempts++, archive email with screenshot", async () => {
  const { user } = await seedScenario();
  const mailer = fakeMailer();
  const verifier = new FakeVerifier({ ok: false, reason: "amount-mismatch", detail: "no coincide" });
  const app = buildApp(verifier, mailer, user.id);

  const res = await request(app)
    .post("/api/checkout/verify")
    .attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });

  expect(res.status).toBe(422);
  expect(res.body.reason).toBe("amount-mismatch");
  expect(res.body.attemptsLeft).toBe(2);
  const order = await prisma.order.findFirst({ where: { userId: user.id } });
  expect(order?.verificationAttempts).toBe(1);
  expect((mailer.archive as any).mock.calls[0][0].screenshot).toBeTruthy();
});

test("4th reject → 410 attempts-exhausted, holds released", async () => {
  const { user } = await seedScenario();
  const mailer = fakeMailer();
  const verifier = new FakeVerifier({ ok: false, reason: "amount-mismatch", detail: "x" });
  const app = buildApp(verifier, mailer, user.id);

  for (let i = 0; i < 3; i++) {
    await request(app).post("/api/checkout/verify").attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });
  }
  const res = await request(app)
    .post("/api/checkout/verify")
    .attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });

  expect(res.status).toBe(410);
  expect(res.body.status).toBe("attempts-exhausted");
  const holds = await prisma.seatHold.findMany({ where: { userId: user.id } });
  expect(holds).toHaveLength(0);
});

test("no holds → 410 holds-expired", async () => {
  const user = await makeUser();
  await makeMovie();
  const mailer = fakeMailer();
  const verifier = new FakeVerifier({ ok: true, txnId: "x", senderName: null });
  const app = buildApp(verifier, mailer, user.id);

  const res = await request(app)
    .post("/api/checkout/verify")
    .attach("screenshot", tinyPng, { filename: "r.png", contentType: "image/png" });

  expect(res.status).toBe(410);
  expect(res.body.status).toBe("holds-expired");
});
```

- [ ] **Step 5: Run the tests**

Run from `backend/`: `npm test -- checkoutVerify`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/routes/checkoutVerify.ts backend/src/routes/checkoutVerify.test.ts backend/src/index.ts
git commit -m "Add POST /api/checkout/verify with multer + soft-cap pending path"
```

---

### Task 11: `POST /api/orders/:code/resend-email`

**Files:**
- Create: `backend/src/routes/resend.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create `backend/src/routes/resend.ts`**:

```ts
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { renderQrPng } from "../services/qrRender.js";
import { sendOrderConfirmation } from "../services/email.js";

export const resendRouter = Router();

resendRouter.post("/:code/resend-email", requireAuth, async (req, res) => {
  const user = req.user!;
  const order = await prisma.order.findUnique({
    where: { code: req.params.code },
    include: { tickets: { include: { seat: { select: { label: true } } } } },
  });
  if (!order || order.userId !== user.id) return res.status(404).json({ error: "not-found" });
  if (order.status !== "paid") return res.status(409).json({ error: "not-paid" });

  const movie = (await prisma.movie.findFirst())!;
  const attachments = await Promise.all(
    order.tickets.map(async (t) => ({
      filename: `qr-${t.seat.label}.png`,
      content: await renderQrPng(t.qrPayload!),
      cid: `qr-${t.seat.label}`,
    })),
  );

  await sendOrderConfirmation({
    to: user.email,
    props: {
      guestName: user.name ?? "amigo",
      orderCode: order.code,
      showtimeIso: movie.startsAt.toISOString(),
      venueName: movie.venueName,
      totalLps: order.totalLps,
      seats: order.tickets.map((t) => ({ label: t.seat.label, qrCid: `qr-${t.seat.label}` })),
    },
    qrAttachments: attachments,
  });

  return res.status(200).json({ ok: true });
});
```

- [ ] **Step 2: Mount in `backend/src/index.ts`**:

```ts
import { resendRouter } from "./routes/resend.js";
// ...
app.use("/api/orders", resendRouter);
```

- [ ] **Step 3: Typecheck**

Run from `backend/`: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/resend.ts backend/src/index.ts
git commit -m "Add POST /api/orders/:code/resend-email"
```

---

## Phase C — Frontend (customer-facing)

### Task 12: Browser checkout-verify client

**Files:**
- Create: `frontend/lib/checkoutVerify.ts`

- [ ] **Step 1: Create the client**:

```ts
import { BACKEND_URL } from "./api";

export type VerifyResult =
  | { status: "approved"; orderCode: string }
  | { status: "rejected"; reason: string; detail: string; attemptsLeft: number }
  | { status: "pending" }
  | { status: "attempts-exhausted" }
  | { status: "holds-expired" }
  | { status: "network-error" };

export async function submitScreenshot(file: File): Promise<VerifyResult> {
  const fd = new FormData();
  fd.append("screenshot", file);
  try {
    const res = await fetch(`${BACKEND_URL}/api/checkout/verify`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 200) return { status: "approved", orderCode: body.orderCode };
    if (res.status === 202) return { status: "pending" };
    if (res.status === 410 && body.status === "attempts-exhausted") return { status: "attempts-exhausted" };
    if (res.status === 410) return { status: "holds-expired" };
    if (res.status === 422) return { status: "rejected", reason: body.reason, detail: body.detail, attemptsLeft: body.attemptsLeft };
    return { status: "network-error" };
  } catch {
    return { status: "network-error" };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/checkoutVerify.ts
git commit -m "Add browser checkout-verify client"
```

---

### Task 13: `/checkout` rebuild

**Files:**
- Create: `frontend/app/components/PaymentInstructionsCard.tsx`
- Create: `frontend/app/components/ScreenshotUploader.tsx`
- Modify: `frontend/app/components/CheckoutClient.tsx`
- Modify: `frontend/lib/copy.ts` (add `checkout.instructions`, `checkout.upload`, `checkout.verifying`, `checkout.rejected`, `checkout.softCap`)

- [ ] **Step 1: Add copy** in `frontend/lib/copy.ts` — extend the `checkout` namespace with:

```ts
  instructions: {
    title: "TRANSFIERE EL PAGO",
    body: "Realiza la transferencia con los datos abajo y luego sube tu comprobante.",
    referencePrefix: "REFERENCIA",
  },
  upload: {
    label: "SUBIR COMPROBANTE",
    cta: "VERIFICAR PAGO",
    pickAnother: "SUBIR OTRO COMPROBANTE",
  },
  verifying: "Verificando comprobante…",
  rejected: {
    attemptsLeft: (n: number) => `Intentos restantes: ${n}`,
    exhausted: "Agotaste los intentos. Vuelve a elegir butacas.",
    expired: "Tu reserva expiró. Elige butacas de nuevo.",
  },
  softCap: "Estamos revisando tu pago — te avisaremos por correo cuando esté listo.",
```

- [ ] **Step 2: Create `frontend/app/components/PaymentInstructionsCard.tsx`**:

```tsx
"use client";
import { copy } from "@/lib/copy";

export function PaymentInstructionsCard({
  bankRef,
  amountLps,
  orderCode,
}: {
  bankRef: string;
  amountLps: number;
  orderCode: string;
}) {
  const copyToClipboard = (s: string) => navigator.clipboard?.writeText(s);
  return (
    <section className="border border-bulb/40 p-6 font-mono text-sm">
      <h2 className="font-serif text-2xl mb-2">{copy.checkout.instructions.title}</h2>
      <p className="mb-4 text-bulb/80">{copy.checkout.instructions.body}</p>
      <dl className="space-y-2">
        <Row label="CUENTA" value={bankRef} onCopy={() => copyToClipboard(bankRef)} />
        <Row label="MONTO" value={`L ${amountLps.toFixed(2)}`} onCopy={() => copyToClipboard(amountLps.toFixed(2))} />
        <Row label={copy.checkout.instructions.referencePrefix} value={orderCode} onCopy={() => copyToClipboard(orderCode)} />
      </dl>
    </section>
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-bulb/60">{label}</dt>
      <dd className="flex items-center gap-2">
        <span>{value}</span>
        <button type="button" onClick={onCopy} className="text-xs underline">COPIAR</button>
      </dd>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/app/components/ScreenshotUploader.tsx`**:

```tsx
"use client";
import { useState } from "react";
import { copy } from "@/lib/copy";

export function ScreenshotUploader({ onSubmit, busy }: { onSubmit: (file: File) => void; busy: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/png", "image/jpeg"].includes(f.type)) return setError("Solo PNG o JPG.");
    if (f.size > 5 * 1024 * 1024) return setError("Máximo 5 MB.");
    setError(null);
    setFile(f);
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="font-mono text-xs">{copy.checkout.upload.label}</span>
        <input type="file" accept="image/png,image/jpeg" onChange={pick} className="block mt-1" disabled={busy} />
      </label>
      {file && <p className="font-mono text-xs">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        type="button"
        disabled={!file || busy}
        onClick={() => file && onSubmit(file)}
        className="bg-marquee-gold text-hall-black px-4 py-2 font-mono disabled:opacity-40"
      >
        {copy.checkout.upload.cta} →
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `frontend/app/components/CheckoutClient.tsx`** — replace the existing PAGAR-mock body with:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentInstructionsCard } from "./PaymentInstructionsCard";
import { ScreenshotUploader } from "./ScreenshotUploader";
import { submitScreenshot, type VerifyResult } from "@/lib/checkoutVerify";
import { copy } from "@/lib/copy";

export function CheckoutClient(props: {
  seats: string[];
  totalLps: number;
  orderCode: string;
  bankRef: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "verifying" | "softCap" | "result">("idle");
  const [result, setResult] = useState<VerifyResult | null>(null);

  useEffect(() => {
    if (phase !== "verifying") return;
    const t = setTimeout(() => setPhase((p) => (p === "verifying" ? "softCap" : p)), 30_000);
    return () => clearTimeout(t);
  }, [phase]);

  async function submit(file: File) {
    setPhase("verifying");
    const r = await submitScreenshot(file);
    setResult(r);

    if (r.status === "approved") return router.push(`/success?order=${r.orderCode}`);
    if (r.status === "pending") return setPhase("softCap");
    if (r.status === "attempts-exhausted" || r.status === "holds-expired") {
      router.push(`/seats?flash=${r.status}`);
      return;
    }
    setPhase("result");
  }

  if (phase === "verifying") return <Verifying />;
  if (phase === "softCap") return <SoftCap />;

  return (
    <div className="space-y-6">
      <PaymentInstructionsCard bankRef={props.bankRef} amountLps={props.totalLps} orderCode={props.orderCode} />
      {result?.status === "rejected" && (
        <div className="border border-red-400/40 p-4 text-sm">
          <p className="text-red-300 font-mono">{result.detail}</p>
          <p className="text-bulb/60 mt-1 font-mono text-xs">{copy.checkout.rejected.attemptsLeft(result.attemptsLeft)}</p>
        </div>
      )}
      <ScreenshotUploader onSubmit={submit} busy={false} />
    </div>
  );
}

function Verifying() {
  return (
    <div className="text-center py-16">
      <div className="inline-block w-3 h-3 bg-marquee-gold animate-pulse rounded-full" />
      <p className="mt-4 font-mono">{copy.checkout.verifying}</p>
    </div>
  );
}

function SoftCap() {
  return <p className="text-center font-mono py-16">{copy.checkout.softCap}</p>;
}
```

- [ ] **Step 5: Update `frontend/app/checkout/page.tsx`** — the existing page reads `?seats=` and `?expires=`, calls `requireUser`, and renders `<CheckoutClient seats={...} totalLps={...} expiresAt={...} />`. Change the render to also pass `orderCode` and `bankRef`:

```tsx
// At the top: add the import.
import { cookies } from "next/headers";
import { BACKEND_URL } from "@/lib/api";

// Inside the page function, after `requireUser` and after computing `totalLps`:
const cookieHeader = (await cookies()).toString();
const orderRes = await fetch(`${BACKEND_URL}/api/orders/pending`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: cookieHeader },
  body: JSON.stringify({ totalLps, guestName: user.name ?? user.email }),
  cache: "no-store",
});
const { code: orderCode } = (await orderRes.json()) as { code: string };

return (
  <CheckoutClient
    seats={seatIds}
    totalLps={totalLps}
    orderCode={orderCode}
    bankRef={process.env.NEXT_PUBLIC_BANK_ACCOUNT_REF ?? "Cuenta pendiente"}
  />
);
```

The new `/api/orders/pending` endpoint is added to `backend/src/routes/resend.ts` in the next sub-step (colocating with the resend route is fine):

```ts
resendRouter.post("/pending", requireAuth, async (req, res) => {
  const { totalLps, guestName } = req.body as { totalLps: number; guestName: string };
  const order = await findOrCreatePendingOrder({ userId: req.user!.id, totalLps, guestName });
  res.json({ code: order.code });
});
```

Add `import { findOrCreatePendingOrder } from "../services/orders.js";` at the top of the file.

- [ ] **Step 6: Set `NEXT_PUBLIC_BANK_ACCOUNT_REF`** in `frontend/.env.local`:

```
NEXT_PUBLIC_BANK_ACCOUNT_REF=Banco Atlántida · Cuenta 0000000000 · Cuatro Films
```

- [ ] **Step 7: Manual UI check**

Start backend + frontend, sign in, pick 2 seats, hit `/checkout`. Verify:
- Instructions card shows account/amount/REFERENCIA.
- File picker accepts PNG/JPG, rejects others with inline error.
- Submitting fires the verifying spinner.
- (Use `FakeVerifier` in dev by swapping `new ClaudeVerifier()` for `new FakeVerifier({...})` if you want fast feedback before wiring real Claude.)

- [ ] **Step 8: Commit**

```bash
git add frontend backend/src/routes/resend.ts
git commit -m "Frontend: /checkout rebuild with instructions + upload + verifying states"
```

---

### Task 14: `/success` — embed QRs

**Files:**
- Create: `frontend/app/components/QrBlock.tsx`
- Modify: `frontend/app/success/page.tsx`
- Modify: `frontend/app/components/TicketStub.tsx`
- Modify: `frontend/app/components/ResendEmailButton.tsx`
- Modify: `frontend/lib/orders.ts`

- [ ] **Step 1: Extend backend `/api/my-tickets` to include `qrPayload`** — open `backend/src/routes/myTickets.ts` and add `qrPayload: true` to the seat/ticket select set; thread it into the DTO.

- [ ] **Step 2: Update `frontend/lib/orders.ts`** — add `qrPayload: string` to the `Ticket` (or per-seat) entry in the order DTO.

- [ ] **Step 3: Create `frontend/app/components/QrBlock.tsx`** — renders a QR client-side from the payload so the server doesn't need to embed PNGs:

```tsx
"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrBlock({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(payload, { width: 256, margin: 2, errorCorrectionLevel: "M" }).then(setDataUrl);
  }, [payload]);
  if (!dataUrl) return <div className="w-32 h-32 bg-bulb/10" />;
  return <img src={dataUrl} alt="QR" className="w-32 h-32 inline-block" />;
}
```

- [ ] **Step 4: Install `qrcode` in the frontend**

Run from `frontend/`:

```bash
npm install qrcode
npm install -D @types/qrcode
```

- [ ] **Step 5: Pass `qrPayload` into each `TicketStub`** — modify `TicketStub.tsx` to accept `qrPayload: string` and render `<QrBlock payload={qrPayload} />` under the serif seat ID.

- [ ] **Step 6: Update `/success/page.tsx`** — fetch the order via `GET /api/my-tickets`, find by `?order=`, render one `TicketStub` per ticket with the real `qrPayload`. If `?order=` is missing or unknown to the user, render the existing empty fallback.

- [ ] **Step 7: Wire `ResendEmailButton.tsx`** — replace the mock with:

```tsx
async function onClick() {
  setBusy(true);
  const res = await fetch(`${BACKEND_URL}/api/orders/${orderCode}/resend-email`, {
    method: "POST",
    credentials: "include",
  });
  setBusy(false);
  setStatus(res.ok ? "sent" : "error");
}
```

- [ ] **Step 8: Manual check** — visit `/success?order=<code>` for a paid order; QRs render; clicking REENVIAR CORREO triggers a 200.

- [ ] **Step 9: Commit**

```bash
git add frontend backend/src/routes/myTickets.ts
git commit -m "Frontend: /success embeds QR per seat, ResendEmailButton hits real endpoint"
```

---

## Phase D — Admin / scanner

### Task 15: `requireRole` middleware

**Files:**
- Create: `backend/src/auth/requireRole.ts`
- Create: `backend/src/auth/requireRole.test.ts`

- [ ] **Step 1: Write the test** — `backend/src/auth/requireRole.test.ts`:

```ts
import { test, expect, vi } from "vitest";
import { requireRole } from "./requireRole.js";

function buildReqRes(user: any) {
  return {
    req: { user, isAuthenticated: () => !!user } as any,
    res: { status: vi.fn().mockReturnThis(), json: vi.fn() } as any,
    next: vi.fn(),
  };
}

test("401 when unauthenticated", () => {
  const mw = requireRole("admin");
  const { req, res, next } = buildReqRes(null);
  mw(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});

test("403 when role mismatch", () => {
  const mw = requireRole("admin");
  const { req, res, next } = buildReqRes({ id: "1", role: "customer" });
  mw(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

test("next() when role matches", () => {
  const mw = requireRole("admin", "doorStaff");
  const { req, res, next } = buildReqRes({ id: "1", role: "doorStaff" });
  mw(req, res, next);
  expect(next).toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement** — `backend/src/auth/requireRole.ts`:

```ts
import type { Request, Response, NextFunction } from "express";

type Role = "customer" | "doorStaff" | "admin";

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated?.() || !req.user) return res.status(401).json({ error: "unauthenticated" });
    if (!allowed.includes((req.user as any).role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
```

- [ ] **Step 3: Run test**

Run from `backend/`: `npm test -- requireRole`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/src/auth/requireRole.ts backend/src/auth/requireRole.test.ts
git commit -m "Add requireRole middleware + tests"
```

---

### Task 16: `POST /api/admin/scan`

**Files:**
- Create: `backend/src/routes/admin.ts`
- Create: `backend/src/routes/admin.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write the tests** — `backend/src/routes/admin.test.ts`:

```ts
import { test, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../db.js";
import { adminRouter } from "./admin.js";
import { makeUser, makeMovie, makeSeats } from "../test/factories.js";
import { signQrPayload } from "../services/qrSigning.js";

function appAs(user: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = user;
    (req as any).isAuthenticated = () => !!user;
    next();
  });
  app.use("/api/admin", adminRouter);
  return app;
}

async function seedPaidTicket() {
  const customer = await makeUser({ role: "customer" });
  const staff = await makeUser({ role: "doorStaff" });
  const movie = await makeMovie();
  const [seat] = await makeSeats(movie.id, ["A1"]);
  const order = await prisma.order.create({
    data: { code: "ABC123", userId: customer.id, status: "paid", totalLps: 12, guestName: "Alex" },
  });
  const payload = signQrPayload("ABC123", "A1");
  const ticket = await prisma.ticket.create({
    data: { orderId: order.id, seatId: seat.id, userId: customer.id, qrPayload: payload },
  });
  return { customer, staff, ticket, payload };
}

test("scan: valid payload → ok with guestName + seat", async () => {
  const { staff, payload } = await seedPaidTicket();
  const res = await request(appAs(staff)).post("/api/admin/scan").send({ payload });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, seat: "A1", guestName: "Alex", alreadyUsed: false });
});

test("scan: second time → alreadyUsed with timestamp", async () => {
  const { staff, payload } = await seedPaidTicket();
  await request(appAs(staff)).post("/api/admin/scan").send({ payload });
  const res = await request(appAs(staff)).post("/api/admin/scan").send({ payload });
  expect(res.status).toBe(200);
  expect(res.body.alreadyUsed).toBe(true);
  expect(res.body.redeemedAt).toBeTruthy();
});

test("scan: tampered signature → 400 invalid", async () => {
  const { staff, payload } = await seedPaidTicket();
  const bad = payload.slice(0, -2) + "ZZ";
  const res = await request(appAs(staff)).post("/api/admin/scan").send({ payload: bad });
  expect(res.status).toBe(400);
});

test("scan: customer role → 403", async () => {
  const customer = await makeUser({ role: "customer" });
  const res = await request(appAs(customer)).post("/api/admin/scan").send({ payload: "x" });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Implement `backend/src/routes/admin.ts`**:

```ts
import { Router } from "express";
import { prisma } from "../db.js";
import { requireRole } from "../auth/requireRole.js";
import { verifyQrPayload } from "../services/qrSigning.js";

export const adminRouter = Router();

adminRouter.post("/scan", requireRole("doorStaff", "admin"), async (req, res) => {
  const { payload } = req.body as { payload?: string };
  if (!payload) return res.status(400).json({ ok: false, reason: "missing-payload" });

  const parsed = verifyQrPayload(payload);
  if (!parsed) return res.status(400).json({ ok: false, reason: "invalid" });

  const ticket = await prisma.ticket.findUnique({
    where: { qrPayload: payload },
    include: { seat: { select: { label: true } }, order: { select: { guestName: true } }, redeemedByUser: { select: { name: true } } },
  });
  if (!ticket) return res.status(400).json({ ok: false, reason: "unknown" });

  if (ticket.redeemedAt) {
    return res.json({
      ok: true,
      alreadyUsed: true,
      seat: ticket.seat.label,
      guestName: ticket.order.guestName,
      redeemedAt: ticket.redeemedAt.toISOString(),
      redeemedBy: ticket.redeemedByUser?.name ?? null,
    });
  }

  const staff = req.user!;
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { redeemedAt: new Date(), redeemedBy: staff.id },
  });
  return res.json({
    ok: true,
    alreadyUsed: false,
    seat: ticket.seat.label,
    guestName: ticket.order.guestName,
    redeemedAt: updated.redeemedAt!.toISOString(),
  });
});

adminRouter.get("/door", requireRole("admin"), async (_req, res) => {
  const orders = await prisma.order.findMany({
    where: { status: "paid" },
    include: { tickets: { include: { seat: { select: { label: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const total = orders.reduce((n, o) => n + o.tickets.length, 0);
  const scanned = orders.reduce((n, o) => n + o.tickets.filter((t) => t.redeemedAt).length, 0);
  res.json({
    totals: { sold: total, scanned, capacity: 121 },
    orders: orders.map((o) => ({
      code: o.code,
      guestName: o.guestName,
      totalLps: o.totalLps,
      tickets: o.tickets.map((t) => ({ id: t.id, seat: t.seat.label, redeemedAt: t.redeemedAt?.toISOString() ?? null })),
    })),
  });
});

adminRouter.post("/manual-checkin", requireRole("admin"), async (req, res) => {
  const { ticketId } = req.body as { ticketId?: string };
  if (!ticketId) return res.status(400).json({ error: "ticketId required" });
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return res.status(404).json({ error: "not-found" });
  if (ticket.redeemedAt) return res.status(200).json({ ok: true, alreadyUsed: true });
  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { redeemedAt: new Date(), redeemedBy: req.user!.id },
  });
  res.json({ ok: true, redeemedAt: updated.redeemedAt!.toISOString() });
});
```

- [ ] **Step 3: Mount in `backend/src/index.ts`**:

```ts
import { adminRouter } from "./routes/admin.js";
app.use("/api/admin", adminRouter);
```

- [ ] **Step 4: Run tests**

Run from `backend/`: `npm test -- admin`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin.ts backend/src/routes/admin.test.ts backend/src/index.ts
git commit -m "Add /api/admin/scan + /api/admin/door + /api/admin/manual-checkin"
```

---

### Task 17: `/admin/scan` UI

**Files:**
- Create: `frontend/app/admin/scan/page.tsx`
- Create: `frontend/app/admin/scan/ScanClient.tsx`
- Modify: `frontend/lib/auth.ts` — add a `requireRole(role[], next)` helper, mirroring `requireUser`
- Modify: `frontend/package.json`

- [ ] **Step 1: Install jsqr**

Run from `frontend/`:

```bash
npm install jsqr
```

- [ ] **Step 2: Extend `/api/me` and the frontend `User` type to carry `role`**:

In `backend/src/auth/routes.ts`, find the `/me` handler. Update the user shape returned to include `role: req.user.role`. (The Passport serializer already hydrates the full User row; this is just exposing the field.)

In `frontend/lib/auth.ts`, extend the `SessionUser` type with `role: "customer" | "doorStaff" | "admin"`.

- [ ] **Step 3: Add the `requireRole` helper in `frontend/lib/auth.ts`**:

```ts
export async function requireRole(allowed: Array<"doorStaff" | "admin">, next: string) {
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(next)}`);
  if (!allowed.includes(user.role as "doorStaff" | "admin")) redirect("/");
  return user;
}
```

- [ ] **Step 4: Create `frontend/app/admin/scan/page.tsx`**:

```tsx
import { requireRole } from "@/lib/auth";
import { ScanClient } from "./ScanClient";

export default async function ScanPage() {
  await requireRole(["doorStaff", "admin"], "/admin/scan");
  return <ScanClient />;
}
```

- [ ] **Step 5: Create `frontend/app/admin/scan/ScanClient.tsx`**:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { BACKEND_URL } from "@/lib/api";

type Verdict =
  | { ok: true; seat: string; guestName: string; alreadyUsed: false }
  | { ok: true; seat: string; guestName: string; alreadyUsed: true; redeemedAt: string; redeemedBy: string | null }
  | { ok: false; reason: string };

export function ScanClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [last, setLast] = useState<Verdict | null>(null);
  const [history, setHistory] = useState<Verdict[]>([]);
  const cooldown = useRef(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((s) => {
      stream = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play();
      }
    });
    const interval = setInterval(scan, 250);
    return () => {
      clearInterval(interval);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function scan() {
    if (Date.now() < cooldown.current) return;
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || v.readyState !== 4) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(v, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const code = jsQR(img.data, img.width, img.height);
    if (!code) return;
    cooldown.current = Date.now() + 2000;

    const res = await fetch(`${BACKEND_URL}/api/admin/scan`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: code.data }),
    });
    const verdict = (await res.json()) as Verdict;
    setLast(verdict);
    setHistory((h) => [verdict, ...h].slice(0, 5));
  }

  return (
    <main className="min-h-screen bg-hall-black text-bulb">
      <video ref={videoRef} className="w-full" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
      {last && <VerdictOverlay v={last} />}
      <ul className="mt-4 font-mono text-xs p-4 space-y-1">
        {history.map((v, i) => (
          <li key={i}>
            <Dot v={v} /> {"seat" in v ? v.seat : v.reason}
          </li>
        ))}
      </ul>
    </main>
  );
}

function VerdictOverlay({ v }: { v: Verdict }) {
  if (!v.ok) return <Big bg="bg-red-700">INVÁLIDO · {v.reason}</Big>;
  if (v.alreadyUsed) return <Big bg="bg-amber-600">YA ESCANEADO · {v.seat}</Big>;
  return <Big bg="bg-emerald-700">LIBRE · {v.seat} · {v.guestName}</Big>;
}

function Big({ bg, children }: { bg: string; children: React.ReactNode }) {
  return <div className={`fixed inset-0 ${bg} flex items-center justify-center text-3xl font-serif text-white p-8 text-center pointer-events-none animate-fadeout`}>{children}</div>;
}

function Dot({ v }: { v: Verdict }) {
  const color = !v.ok ? "bg-red-500" : v.alreadyUsed ? "bg-amber-500" : "bg-emerald-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${color} mr-2`} />;
}
```

Add `animate-fadeout` to `globals.css`:

```css
@keyframes fadeout {
  0%, 70% { opacity: 1 }
  100% { opacity: 0 }
}
.animate-fadeout { animation: fadeout 1.5s forwards }
```

- [ ] **Step 6: Manual test**

Promote a user to `doorStaff` in Prisma Studio, sign in as them, open `/admin/scan` on a phone, allow camera, scan a QR from a `/success` screen. Verify green/yellow/red flow.

- [ ] **Step 7: Commit**

```bash
git add frontend backend/src/auth/routes.ts
git commit -m "Frontend: /admin/scan with jsqr camera viewfinder + verdict overlay"
```

---

### Task 18: `/admin/door` UI

**Files:**
- Create: `frontend/app/admin/door/page.tsx`
- Create: `frontend/app/admin/door/DoorClient.tsx`

- [ ] **Step 1: Create `frontend/app/admin/door/page.tsx`**:

```tsx
import { requireRole } from "@/lib/auth";
import { DoorClient } from "./DoorClient";
import { BACKEND_URL } from "@/lib/api";
import { cookies } from "next/headers";

export default async function DoorPage() {
  await requireRole(["admin"], "/admin/door");
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${BACKEND_URL}/api/admin/door`, { headers: { cookie: cookieHeader }, cache: "no-store" });
  const data = await res.json();
  return <DoorClient initial={data} />;
}
```

- [ ] **Step 2: Create `frontend/app/admin/door/DoorClient.tsx`**:

```tsx
"use client";
import { useState } from "react";
import { BACKEND_URL } from "@/lib/api";

type Door = {
  totals: { sold: number; scanned: number; capacity: number };
  orders: { code: string; guestName: string; totalLps: number; tickets: { id: string; seat: string; redeemedAt: string | null }[] }[];
};

export function DoorClient({ initial }: { initial: Door }) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState("");

  async function checkIn(ticketId: string) {
    const res = await fetch(`${BACKEND_URL}/api/admin/manual-checkin`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId }),
    });
    if (!res.ok) return;
    setData((d) => ({
      ...d,
      totals: { ...d.totals, scanned: d.totals.scanned + 1 },
      orders: d.orders.map((o) => ({
        ...o,
        tickets: o.tickets.map((t) => (t.id === ticketId ? { ...t, redeemedAt: new Date().toISOString() } : t)),
      })),
    }));
  }

  const visible = data.orders.filter(
    (o) => !q || o.code.toLowerCase().includes(q.toLowerCase()) || o.guestName.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <main className="bg-hall-black min-h-screen text-bulb p-4 space-y-4">
      <header className="font-mono text-sm flex justify-between">
        <span>TOTAL VENDIDAS · {data.totals.sold} / {data.totals.capacity}</span>
        <span>ESCANEADAS · {data.totals.scanned} / {data.totals.sold}</span>
      </header>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nombre u orden…"
        className="w-full bg-transparent border-b border-bulb/40 py-2 font-mono"
      />
      <ul className="space-y-3">
        {visible.map((o) => (
          <li key={o.code} className="border border-bulb/30 p-3">
            <div className="flex justify-between font-serif text-lg">
              <span>{o.guestName}</span>
              <span className="font-mono text-xs">{o.code}</span>
            </div>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {o.tickets.map((t) => (
                <li key={t.id} className="flex justify-between items-center">
                  <span>
                    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${t.redeemedAt ? "bg-emerald-500" : "bg-bulb/40"}`} />
                    {t.seat}
                  </span>
                  {!t.redeemedAt && (
                    <button onClick={() => checkIn(t.id)} className="text-marquee-gold">MARCAR ENTRADA ✓</button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Manual test**

Sign in as `admin`, visit `/admin/door`, search, manually check in a ticket, confirm counters update.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/door
git commit -m "Frontend: /admin/door manifest with search + manual check-in"
```

---

## Phase E — Cleanup

### Task 19: `/cancel` copy + HANDOFF.md refresh

**Files:**
- Modify: `frontend/app/cancel/page.tsx` + `frontend/app/components/CancelClient.tsx`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Strip Stripe-cancel framing from `/cancel`** — search the file for "Stripe" / "cancel landing" and replace with neutral copy:

```ts
// In copy.cancel:
title: "Pago en pausa",
body: "Tu reservación sigue activa por unos minutos. Vuelve para subir tu comprobante o elige butacas de nuevo.",
```

- [ ] **Step 2: Update `HANDOFF.md`** — replace the "Payment blocker" section with a short note:

```markdown
## Payments — bank transfer + AI verification

Customer uploads a screenshot on `/checkout`. The backend calls Claude
Sonnet 4.6 to verify it (30s soft cap), and on approval converts holds
to tickets and emails signed QR codes. Door staff scan at `/admin/scan`,
admins manage at `/admin/door`. See
[docs/superpowers/specs/2026-06-02-payment-pivot-design.md](docs/superpowers/specs/2026-06-02-payment-pivot-design.md).
```

Drop the Stripe debris bullet list, drop the "Stripe MCP" note.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/cancel frontend/app/components/CancelClient.tsx frontend/lib/copy.ts HANDOFF.md
git commit -m "Drop Stripe-cancel framing + refresh HANDOFF.md for the new payment flow"
```

---

## Final check

- [ ] Run `cd backend && npm test` — all green.
- [ ] Run `cd backend && npm run typecheck` — green.
- [ ] Run `cd frontend && npm run typecheck` — green.
- [ ] Manual end-to-end with `FakeVerifier`: sign in → seats → checkout → upload PNG → /success with QRs → scan one QR via `/admin/scan` → see green verdict → scan again → yellow.
- [ ] Swap `FakeVerifier` for `ClaudeVerifier` in `index.ts` for the real-LLM smoke test (one real screenshot, real API key in `.env`).
- [ ] Verify `backend/.env` has been git-ignored and `.env.example` reflects the new vars only.
