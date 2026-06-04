# Payment Verifier — Extract-then-Judge (BAC receipts)

**Date:** 2026-06-03
**Status:** Approved design
**Topic:** Rework `ClaudeVerifier` so the safety-critical checks are deterministic and testable, grounded in real BAC Honduras receipt formats.

## Background

The bank-transfer flow has the customer upload a transfer-receipt screenshot to `POST /api/checkout/verify`. Today `ClaudeVerifier` ([backend/src/services/paymentVerifier.ts](../../../backend/src/services/paymentVerifier.ts)) sends the image to Claude Sonnet 4.6 and asks the model to emit a full **verdict** (approve/reject) via a single `oneOf` tool. The model does both the OCR *and* the numeric/date comparisons.

Two problems surfaced when validating against a real BAC "Notificación de transferencia" screenshot:

1. **The order code can never be on the receipt.** The current prompt tells Claude the order code is "mencionada en el voucher", but BAC's *Detalle* field is typically "(Sin detalle)" — customers don't type a 6-char code into a transfer. This risks false rejections.
2. **The model is doing the exact comparisons** (amount equality, account match, 24h date math) — exactly the operations LLMs are least reliable at, and which are impossible to unit-test without burning API calls.

### Reference receipt (format sample)

A real BAC notification, used as the canonical fixture. It is a *format* sample to a different account — a correct verifier rejects it.

| Field | Value |
|---|---|
| Bank / type | BAC — "Notificación de transferencia" |
| Body | "JOSE JAVIER DIAZ CHINCHILLA realizó una transferencia a la cuenta bancaria Nº **759407831** a nombre de **ALEJANDRO JOSE HERRERA CHINCHILLA**" |
| Fecha | 22 mayo 2026 |
| Hora | 11:12 AM |
| Monto | **L8,210.00** |
| Detalle | (Sin detalle) |
| Referencia | **412467270** |

## Decisions (from brainstorming)

- **Real destination account stays as configured:** `100355841 / José Javier Díaz Alvarado`. The screenshot above is only a format sample.
- **Account number is the gate.** Require the destination account *number* to match exactly. The name is confirmatory only — never reject on name spelling/accent differences.
- **Strict 24-hour window.** Reject receipts older than 24h (or future-dated).
- **Exact amount match.** BAC-to-BAC transfers carry no fee; require the amount to equal the expected order total (to the cent).
- **Approach A — extract-then-judge.** The model extracts fields; deterministic TypeScript renders the verdict.

## Architecture

Public interface is unchanged:

```ts
interface PaymentVerifier {
  verify(input: VerifyInput): Promise<VerifyVerdict>;
}
```

`checkoutVerify.ts` and `FakeVerifier` (used by route tests) are untouched. The change is internal to `ClaudeVerifier`, which becomes two stages:

```
verify(input)
  ├─ 1. extractReceipt(image)               → Claude vision, tool "extract_receipt" → ReceiptFields   (non-deterministic OCR)
  └─ 2. judgeReceipt(fields, expected, now) → VerifyVerdict                                            (pure TS, deterministic)
```

`judgeReceipt` is exported as a pure function — the primary unit-test surface.

## Data shapes

```ts
export type ReceiptFields = {
  isBankReceipt: boolean;
  destAccountNumber: string | null;  // digits as printed; judge normalizes
  destName: string | null;
  senderName: string | null;
  amount: number | null;             // Lempiras; "L8,210.00" → 8210
  currency: string | null;           // "HNL" | "LPS" | "L" | ...
  dateTimeIso: string | null;        // Fecha + Hora combined, ISO 8601 with -06:00
  reference: string | null;          // "Referencia" / transaction number
};
```

`VerifyInput.expected` gains `accountNumber: string` (the digit string to gate on). `amountLps`, `accountRef`, `holdCreatedAt` remain; `orderCode` is retained in the type but no longer referenced by the prompt.

`VerifyVerdict` and `RejectionReason` are unchanged:

```ts
type VerifyVerdict =
  | { ok: true; txnId: string; senderName: string | null }
  | { ok: false; reason: RejectionReason; detail: string };
```

## The judge (deterministic, ordered)

`judgeReceipt(fields, expected, now)` evaluates in this order; first failure wins:

1. `!isBankReceipt` → `not-a-receipt`
2. `normalizeDigits(destAccountNumber) !== expected.accountNumber` → `wrong-account`
3. `amount == null` or currency not Lempira → `unreadable`
4. `Math.abs(amount − expected.amountLps) ≥ 0.005` → `amount-mismatch`
5. `dateTimeIso` unparseable → `unreadable`
6. `now − dateTime > 24h` OR `dateTime` in the future → `stale-receipt`
7. `reference` trims to empty → `missing-txn-id`
8. otherwise → `{ ok: true, txnId: reference, senderName }`

`normalizeDigits` strips spaces, dashes, and any non-digit characters before comparison. Accepted Lempira currency markers (case-insensitive): `HNL`, `LPS`, `L`, `LEMPIRAS`. The check is conservative — a missing/`null` currency or any non-Lempira marker yields `unreadable` (we do not assume Lempira when the marker is absent).

Each rejection carries a Spanish `detail` (≤120 chars) from a code template keyed by reason, e.g.:
- `amount-mismatch` → `El monto no coincide — esperábamos L 2,000.00.`
- `wrong-account` → `La transferencia no fue a la cuenta correcta.`
- `stale-receipt` → `El comprobante es de hace más de 24 horas.`
- `missing-txn-id` → `No encontramos un número de referencia en el comprobante.`
- `not-a-receipt` → `La imagen no parece un comprobante bancario.`
- `unreadable` → `No pudimos leer el comprobante con claridad.`

### Applied to the reference receipt

Account `759407831` ≠ configured `100355841` → **`wrong-account`**. Correct: it is a sample to a different account.

## Config change

Add `BANK_ACCOUNT_NUMBER` (zod-validated, non-empty digit string) to `env.ts`:

```
BANK_ACCOUNT_NUMBER=100355841
```

Added to `.env`, `.env.example`, `.env.test`. `BANK_ACCOUNT_REF` is retained unchanged for the customer-facing checkout instructions card. `checkoutVerify.ts` adds one line: `accountNumber: env.BANK_ACCOUNT_NUMBER` in the `expected` packet.

## Extraction prompt

A rewritten Spanish system prompt instructing Claude to **extract only** (no verdict) from a Honduras bank transfer receipt or notification. Properties:

- Bank-agnostic on layout (BAC, Ficohsa, Banpaís, Tigo Money, …) but anchored on reading the **destination** ("a nombre de …", "cuenta Nº …", "cuenta destino").
- Tolerant of both sender-side ("realizaste una transferencia…") and recipient-side ("X realizó una transferencia a tu cuenta…") wording.
- Combine `Fecha` + `Hora` into an ISO 8601 datetime with the `-06:00` Honduras offset.
- `isBankReceipt` true only for a clear bank/wallet transfer receipt (not a meme, photo, or handwritten note).
- **No mention of the order code.**

Single `extract_receipt` tool with a flat object schema (no `oneOf`), `tool_choice` forced to it. Model `claude-sonnet-4-6`, `max_tokens` ~512.

## Error handling

- Model returns `isBankReceipt: false` → `not-a-receipt` verdict (not a throw).
- `amount`/`dateTimeIso` null or unparseable → `unreadable` verdict.
- No `tool_use` block in the response, or transport error → `verify` throws; the route's existing error path and 30s soft-cap handle it (unchanged behavior).

## Testing

- **`judgeReceipt` pure unit tests** (zero API calls), using the reference BAC fields as a fixture:
  - approve (matching account/amount/recent date/non-empty reference)
  - `wrong-account` — the reference receipt (759407831)
  - `amount-mismatch` — 8210 vs an expected 2000
  - `stale-receipt` — 22 mayo 2026 vs a `now` >24h later
  - `missing-txn-id` — empty reference
  - `not-a-receipt` — `isBankReceipt: false`
  - normalization: account number with spaces/dashes still matches
- `FakeVerifier` behavior and `checkoutVerify.test.ts` unaffected.
- The image→`ReceiptFields` extraction step (the only non-deterministic part) is validated manually with the real screenshot during the Tier 1 end-to-end smoke test.

## Files touched

- `backend/src/services/paymentVerifier.ts` — refactor `ClaudeVerifier` into extract + judge; add `ReceiptFields`, `extract_receipt` tool, new prompt; export pure `judgeReceipt` + detail templates.
- `backend/src/env.ts` — add `BANK_ACCOUNT_NUMBER`.
- `backend/.env`, `backend/.env.example`, `backend/.env.test` — add `BANK_ACCOUNT_NUMBER`.
- `backend/src/routes/checkoutVerify.ts` — pass `accountNumber` in `expected` (one line).
- `backend/src/services/paymentVerifier.test.ts` — add `judgeReceipt` tests with the BAC fixture; keep existing `FakeVerifier` coverage.

## Out of scope

- Non-Lempira currencies and FX.
- Guaranteed parsing for banks beyond best-effort.
- OCR fallback when the model cannot read the image.
- Changing the 3-attempt cap, dedup, or email flows.
