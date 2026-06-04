# Payment Verifier Extract-then-Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `ClaudeVerifier` so it extracts receipt fields with the model and renders the approve/reject verdict in deterministic, unit-tested TypeScript — grounded in real BAC Honduras receipt formats.

**Architecture:** The `PaymentVerifier.verify()` interface is unchanged. Internally `ClaudeVerifier` now (1) calls Claude vision with a single `extract_receipt` tool to fill a `ReceiptFields` object, then (2) passes those fields to a pure `judgeReceipt()` function that applies the rules (account-number gate, exact amount, strict 24h window, non-empty reference) and returns the `VerifyVerdict`. The account number to gate on comes from a new `BANK_ACCOUNT_NUMBER` env var.

**Tech Stack:** TypeScript, Express 5, `@anthropic-ai/sdk`, Vitest, Zod.

---

### Task 1: Add `BANK_ACCOUNT_NUMBER` env var

**Files:**
- Modify: `backend/src/env.ts:20` (inside the `schema` object, after `BANK_ACCOUNT_REF`)
- Modify: `backend/.env.example:13`
- Modify: `backend/.env.test` (append)
- Modify: `backend/.env` (real dev env — append)

This must come first: `paymentVerifier.ts` imports `env`, so every test that imports it will fail Zod validation unless `.env.test` already has the var.

- [ ] **Step 1: Add the field to the Zod schema**

In `backend/src/env.ts`, add this line immediately after the `BANK_ACCOUNT_REF` line:

```ts
  BANK_ACCOUNT_NUMBER: z.string().regex(/^\d+$/, "BANK_ACCOUNT_NUMBER must be all digits"),
```

- [ ] **Step 2: Add to `.env.test`**

Append to `backend/.env.test`:

```
BANK_ACCOUNT_NUMBER=100355841
```

- [ ] **Step 3: Add to `.env.example`**

In `backend/.env.example`, add immediately under the `BANK_ACCOUNT_REF=` line:

```
BANK_ACCOUNT_NUMBER=          # destination account number the verifier gates on (digits only)
```

- [ ] **Step 4: Add to the real dev `.env`**

Append to `backend/.env` (gitignored — will not be committed):

```
BANK_ACCOUNT_NUMBER=100355841
```

- [ ] **Step 5: Verify typecheck + existing tests still pass**

Run: `cd backend && npm run typecheck && npm test`
Expected: typecheck clean; all existing tests PASS (env still validates because `.env.test` now has the var).

Note: this shell may export an empty `ANTHROPIC_API_KEY` that shadows `.env`. If `npm test`/typecheck fails with `ANTHROPIC_API_KEY ... at least 1 character`, prefix the command: `unset ANTHROPIC_API_KEY && npm test`. (Vitest loads `.env.test` which sets it to `fake`, so tests are usually fine; this note is for dev runs.)

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandro/Desktop/Cuatro
git add backend/src/env.ts backend/.env.example backend/.env.test
git commit -m "feat(verifier): add BANK_ACCOUNT_NUMBER env var

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(`.env` is gitignored and intentionally not staged.)

---

### Task 2: `ReceiptFields` type + pure `judgeReceipt()` (TDD)

**Files:**
- Modify: `backend/src/services/paymentVerifier.ts` (add type + function near the top, after the existing `VerifyVerdict`/`RejectionReason` types)
- Test: `backend/src/services/paymentVerifier.test.ts`

`judgeReceipt` takes its own narrow `expected` shape `{ accountNumber, amountLps }`, so it is fully independent of `VerifyInput` and testable with zero API calls.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/services/paymentVerifier.test.ts`:

```ts
import { judgeReceipt, type ReceiptFields } from "./paymentVerifier.js";

// Canonical BAC "Notificación de transferencia" fixture (real format sample).
const bacFields: ReceiptFields = {
  isBankReceipt: true,
  destAccountNumber: "759407831",
  destName: "ALEJANDRO JOSE HERRERA CHINCHILLA",
  senderName: "JOSE JAVIER DIAZ CHINCHILLA",
  amount: 8210,
  currency: "L",
  dateTimeIso: "2026-05-22T11:12:00-06:00",
  reference: "412467270",
};

// A real Cuatro order: 2 seats × L1,000, paid to the configured account.
const order = { accountNumber: "100355841", amountLps: 2000 };
// "now" shortly after a matching receipt's timestamp.
const now = new Date("2026-05-22T13:00:00-06:00");

function approvable(): ReceiptFields {
  return { ...bacFields, destAccountNumber: "100355841", amount: 2000 };
}

test("judgeReceipt approves a matching, recent receipt", () => {
  const v = judgeReceipt(approvable(), order, now);
  expect(v).toEqual({ ok: true, txnId: "412467270", senderName: "JOSE JAVIER DIAZ CHINCHILLA" });
});

test("judgeReceipt rejects wrong destination account (the BAC sample)", () => {
  const v = judgeReceipt(bacFields, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("wrong-account");
});

test("judgeReceipt rejects amount mismatch", () => {
  const v = judgeReceipt({ ...approvable(), amount: 8210 }, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("amount-mismatch");
});

test("judgeReceipt rejects a receipt older than 24h", () => {
  const later = new Date("2026-06-03T12:00:00-06:00");
  const v = judgeReceipt(approvable(), order, later);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("stale-receipt");
});

test("judgeReceipt rejects a future-dated receipt", () => {
  const earlier = new Date("2026-05-20T11:12:00-06:00");
  const v = judgeReceipt(approvable(), order, earlier);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("stale-receipt");
});

test("judgeReceipt rejects when reference is empty", () => {
  const v = judgeReceipt({ ...approvable(), reference: "  " }, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("missing-txn-id");
});

test("judgeReceipt rejects a non-receipt image", () => {
  const v = judgeReceipt({ ...approvable(), isBankReceipt: false }, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("not-a-receipt");
});

test("judgeReceipt rejects when currency marker is absent", () => {
  const v = judgeReceipt({ ...approvable(), currency: null }, order, now);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reason).toBe("unreadable");
});

test("judgeReceipt normalizes account numbers with spaces/dashes", () => {
  const v = judgeReceipt({ ...approvable(), destAccountNumber: "1003-5584 1" }, order, now);
  expect(v.ok).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && unset ANTHROPIC_API_KEY; npm test -- paymentVerifier`
Expected: FAIL — `judgeReceipt` / `ReceiptFields` are not exported.

- [ ] **Step 3: Implement `ReceiptFields` + `judgeReceipt`**

In `backend/src/services/paymentVerifier.ts`, add after the `VerifyVerdict` type declaration (before `export interface PaymentVerifier`):

```ts
export type ReceiptFields = {
  isBankReceipt: boolean;
  destAccountNumber: string | null;
  destName: string | null;
  senderName: string | null;
  amount: number | null;
  currency: string | null;
  dateTimeIso: string | null;
  reference: string | null;
};

const LEMPIRA_MARKERS = new Set(["HNL", "LPS", "L", "LEMPIRAS"]);
const STALE_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 10 * 60 * 1000; // tolerate small bank/server clock skew

const STATIC_DETAIL: Record<Exclude<RejectionReason, "amount-mismatch">, string> = {
  "wrong-account": "La transferencia no fue a la cuenta correcta.",
  "stale-receipt": "El comprobante es de hace más de 24 horas.",
  "missing-txn-id": "No encontramos un número de referencia en el comprobante.",
  "not-a-receipt": "La imagen no parece un comprobante bancario.",
  unreadable: "No pudimos leer el comprobante con claridad.",
};

function normalizeDigits(s: string | null): string {
  return (s ?? "").replace(/\D/g, "");
}

function formatLps(amount: number): string {
  return `L ${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Pure verdict logic. The model only extracts ReceiptFields; this function
 * applies the rules (account-number gate, exact amount, strict 24h window,
 * non-empty reference) and is the primary unit-test surface.
 */
export function judgeReceipt(
  fields: ReceiptFields,
  expected: { accountNumber: string; amountLps: number },
  now: Date,
): VerifyVerdict {
  if (!fields.isBankReceipt) {
    return { ok: false, reason: "not-a-receipt", detail: STATIC_DETAIL["not-a-receipt"] };
  }

  if (normalizeDigits(fields.destAccountNumber) !== normalizeDigits(expected.accountNumber)) {
    return { ok: false, reason: "wrong-account", detail: STATIC_DETAIL["wrong-account"] };
  }

  const currencyOk =
    fields.currency != null && LEMPIRA_MARKERS.has(fields.currency.trim().toUpperCase());
  if (fields.amount == null || !currencyOk) {
    return { ok: false, reason: "unreadable", detail: STATIC_DETAIL.unreadable };
  }
  if (Math.abs(fields.amount - expected.amountLps) >= 0.005) {
    return {
      ok: false,
      reason: "amount-mismatch",
      detail: `El monto no coincide — esperábamos ${formatLps(expected.amountLps)}.`,
    };
  }

  const when = fields.dateTimeIso ? new Date(fields.dateTimeIso) : null;
  if (!when || Number.isNaN(when.getTime())) {
    return { ok: false, reason: "unreadable", detail: STATIC_DETAIL.unreadable };
  }
  const ageMs = now.getTime() - when.getTime();
  if (ageMs > STALE_MS || ageMs < -FUTURE_SKEW_MS) {
    return { ok: false, reason: "stale-receipt", detail: STATIC_DETAIL["stale-receipt"] };
  }

  if (!fields.reference || fields.reference.trim() === "") {
    return { ok: false, reason: "missing-txn-id", detail: STATIC_DETAIL["missing-txn-id"] };
  }

  return { ok: true, txnId: fields.reference.trim(), senderName: fields.senderName };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && unset ANTHROPIC_API_KEY; npm test -- paymentVerifier`
Expected: PASS — all `judgeReceipt` tests green, plus the existing 3 `FakeVerifier` tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandro/Desktop/Cuatro
git add backend/src/services/paymentVerifier.ts backend/src/services/paymentVerifier.test.ts
git commit -m "feat(verifier): add ReceiptFields + pure judgeReceipt with tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire `accountNumber` through `VerifyInput` + route + test fixture

**Files:**
- Modify: `backend/src/services/paymentVerifier.ts` (the `VerifyInput` type's `expected` block)
- Modify: `backend/src/routes/checkoutVerify.ts:69-74` (the `expected` packet)
- Modify: `backend/src/services/paymentVerifier.test.ts:7-12` (the `baseInput.expected` fixture)

Adding a required field means all three must change together so the build stays green. No verdict behavior changes in this task.

- [ ] **Step 1: Add `accountNumber` to the `VerifyInput.expected` type**

In `backend/src/services/paymentVerifier.ts`, update the `expected` block of `VerifyInput`:

```ts
  expected: {
    amountLps: number;
    accountRef: string;
    accountNumber: string;
    orderCode: string;
    holdCreatedAt: Date;
  };
```

- [ ] **Step 2: Pass it from the route**

In `backend/src/routes/checkoutVerify.ts`, in the `expected` object passed to `opts.verifier.verify(...)`, add the `accountNumber` line:

```ts
      expected: {
        amountLps: totalLps,
        accountRef: env.BANK_ACCOUNT_REF,
        accountNumber: env.BANK_ACCOUNT_NUMBER,
        orderCode: order.code,
        holdCreatedAt: firstHold.createdAt,
      },
```

- [ ] **Step 3: Update the existing test fixture**

In `backend/src/services/paymentVerifier.test.ts`, update `baseInput.expected` to include the new required field:

```ts
  expected: {
    amountLps: 48,
    accountRef: "Banco Test 12345",
    accountNumber: "100355841",
    orderCode: "ABC123",
    holdCreatedAt: new Date(),
  },
```

- [ ] **Step 4: Verify typecheck + tests**

Run: `cd backend && unset ANTHROPIC_API_KEY; npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS (including `checkoutVerify` route tests, which use `FakeVerifier` and are unaffected by the new field).

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandro/Desktop/Cuatro
git add backend/src/services/paymentVerifier.ts backend/src/routes/checkoutVerify.ts backend/src/services/paymentVerifier.test.ts
git commit -m "feat(verifier): thread accountNumber into VerifyInput.expected

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Refactor `ClaudeVerifier` to extract-then-judge

**Files:**
- Modify: `backend/src/services/paymentVerifier.ts` (replace `VERDICT_TOOL`, `SYSTEM_PROMPT`, and the body of `ClaudeVerifier.verify`)

- [ ] **Step 1: Replace the verdict tool with an extraction tool**

In `backend/src/services/paymentVerifier.ts`, delete the entire `const VERDICT_TOOL = { ... } as const;` block and replace it with:

```ts
const EXTRACT_TOOL = {
  name: "extract_receipt",
  description: "Extrae los campos del comprobante de transferencia bancaria.",
  input_schema: {
    type: "object",
    properties: {
      isBankReceipt: { type: "boolean" },
      destAccountNumber: { type: ["string", "null"] },
      destName: { type: ["string", "null"] },
      senderName: { type: ["string", "null"] },
      amount: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      dateTimeIso: { type: ["string", "null"] },
      reference: { type: ["string", "null"] },
    },
    required: [
      "isBankReceipt",
      "destAccountNumber",
      "destName",
      "senderName",
      "amount",
      "currency",
      "dateTimeIso",
      "reference",
    ],
    additionalProperties: false,
  },
} as const;
```

- [ ] **Step 2: Replace the system prompt**

Replace the entire `const SYSTEM_PROMPT = \`...\`;` block with:

```ts
const SYSTEM_PROMPT = `Eres un extractor de datos de comprobantes de transferencia bancaria de Honduras (BAC, Ficohsa, Banpaís, Tigo Money, etc.). Recibes una captura de pantalla. Extrae los campos y devuélvelos SIEMPRE mediante la herramienta extract_receipt. No emitas ningún juicio de aprobación; solo extrae lo que ves.

Guía de campos:
- isBankReceipt: true solo si la imagen es claramente un comprobante o notificación de transferencia bancaria/billetera. false para memes, fotos al azar o notas manuscritas.
- destAccountNumber: el número de la CUENTA DESTINO (a la que se envió el dinero). Búscalo junto a "a la cuenta", "cuenta Nº", "cuenta destino" o "a nombre de". Devuelve solo los dígitos.
- destName: el nombre del titular de la cuenta destino ("a nombre de ...").
- senderName: quién envió o realizó la transferencia, si aparece.
- amount: el monto como número, sin símbolo ni separador de miles (ej. "L8,210.00" → 8210).
- currency: el código o símbolo de moneda tal como aparece (ej. "L", "HNL", "LPS").
- dateTimeIso: combina la fecha y la hora del comprobante en formato ISO 8601 con offset de Honduras (-06:00). Ej. fecha "22 mayo 2026" + hora "11:12 AM" → "2026-05-22T11:12:00-06:00". Si falta la hora, usa T00:00:00-06:00. Si no hay fecha, null.
- reference: el número de referencia o de transacción ("Referencia", "No. de transacción", "comprobante"), como string.

Tanto los comprobantes del lado de quien envía como las notificaciones del lado de quien recibe son válidos: en ambos casos la cuenta destino es la que aparece tras "a nombre de" / "a la cuenta".`;
```

- [ ] **Step 3: Rewrite `ClaudeVerifier.verify`**

Replace the body of `ClaudeVerifier.verify` with:

```ts
  async verify(input: VerifyInput): Promise<VerifyVerdict> {
    const response = await this.client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL as any],
      tool_choice: { type: "tool", name: "extract_receipt" } as any,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mimeType,
                data: input.imageBuffer.toString("base64"),
              },
            },
            { type: "text", text: "Extrae los campos de este comprobante." },
          ],
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use" || toolUse.name !== "extract_receipt") {
      throw new Error("verifier-returned-no-tool-use");
    }

    const fields = toolUse.input as ReceiptFields;
    return judgeReceipt(
      fields,
      { accountNumber: input.expected.accountNumber, amountLps: input.expected.amountLps },
      new Date(),
    );
  }
```

- [ ] **Step 4: Verify typecheck + full test suite**

Run: `cd backend && unset ANTHROPIC_API_KEY; npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS. (No new automated test for the live extraction call — that is validated manually in Step 6.)

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandro/Desktop/Cuatro
git add backend/src/services/paymentVerifier.ts
git commit -m "feat(verifier): extract-then-judge ClaudeVerifier for BAC receipts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual extraction sanity check (real API)**

This exercises the one non-deterministic part (image → `ReceiptFields`) against the real BAC screenshot. Requires a real `ANTHROPIC_API_KEY` in `backend/.env`.

Create a throwaway script `backend/scripts/tryExtract.ts`:

```ts
import { readFileSync } from "node:fs";
import { ClaudeVerifier } from "../src/services/paymentVerifier.js";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: tsx scripts/tryExtract.ts <image-path>");
  const buf = readFileSync(path);
  const mime = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const v = await new ClaudeVerifier().verify({
    imageBuffer: buf,
    mimeType: mime as "image/png" | "image/jpeg",
    expected: {
      amountLps: 8210,
      accountRef: "BAC · 759407831",
      accountNumber: "759407831",
      orderCode: "TEST01",
      holdCreatedAt: new Date(),
    },
  });
  console.log(JSON.stringify(v, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run (point at the saved BAC screenshot; supply a real key inline):
`cd backend && ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/tryExtract.ts /path/to/bac-screenshot.jpg`

Expected: with `accountNumber: "759407831"` and `amountLps: 8210` matching this sample, and a 24h window — if you run it within 24h of the receipt date it approves with `txnId: "412467270"`; otherwise it returns `stale-receipt`. The point is to confirm the model extracts `destAccountNumber`, `amount`, `reference`, and `dateTimeIso` correctly. Then delete the script:

```bash
rm backend/scripts/tryExtract.ts
```

---

### Task 5: Final integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + tests**

Run: `cd backend && unset ANTHROPIC_API_KEY; npm run typecheck && npm test`
Expected: typecheck clean; full suite PASS (the original count plus the new `judgeReceipt` tests).

- [ ] **Step 2: Confirm the branch is clean**

Run: `cd /Users/alejandro/Desktop/Cuatro && git status --short`
Expected: no uncommitted changes under `backend/src` (the throwaway script from Task 4 Step 6 deleted). `backend/.env` may show as untracked/ignored — that is fine.

---

## Notes for the implementer

- **The `unset ANTHROPIC_API_KEY` prefix** works around this machine's shell exporting an empty `ANTHROPIC_API_KEY` that shadows `.env`/`.env.test`. Vitest loads `.env.test` (key = `fake`), so tests usually pass regardless, but typecheck/dev runs need it.
- **Postgres must be running** for the route tests: `docker compose up -d` from the project root.
- `holdCreatedAt` remains in `VerifyInput.expected` (still passed by the route) but is no longer used by the judge; the 24h window is measured from `now`. Leaving it avoids touching the route signature further.
