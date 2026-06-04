import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";

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
            enum: [
              "amount-mismatch",
              "wrong-account",
              "stale-receipt",
              "missing-txn-id",
              "not-a-receipt",
              "unreadable",
            ],
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
El cliente paga por transferencia bancaria. Recibes el comprobante (captura de pantalla) y los datos esperados.
Debes aprobar SOLO si TODAS las verificaciones pasan:
1. El monto en el comprobante es exactamente igual al monto esperado (en LPS / HNL).
2. La cuenta destino del comprobante coincide con la cuenta esperada.
3. La fecha del comprobante está dentro de las últimas 24 horas.
4. El comprobante muestra un número de transacción/referencia no vacío.
5. La imagen es claramente un comprobante bancario (no un meme, foto al azar, ni nota manuscrita).

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
              source: {
                type: "base64",
                media_type: input.mimeType,
                data: input.imageBuffer.toString("base64"),
              },
            },
            { type: "text", text: userText },
          ],
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (
      !toolUse ||
      toolUse.type !== "tool_use" ||
      toolUse.name !== "emit_verdict"
    ) {
      throw new Error("verifier-returned-no-tool-use");
    }
    return toolUse.input as VerifyVerdict;
  }
}
