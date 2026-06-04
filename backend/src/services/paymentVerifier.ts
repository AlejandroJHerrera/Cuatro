import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";

export type VerifyInput = {
  imageBuffer: Buffer;
  mimeType: "image/png" | "image/jpeg";
  expected: {
    amountLps: number;
    accountRef: string;
    accountNumber: string;
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

const LEMPIRA_MARKERS = new Set(["HNL", "LPS", "L", "LEMPIRA", "LEMPIRAS"]);
const STALE_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 10 * 60 * 1000; // tolerate small bank/server clock skew

const STATIC_DETAIL: Record<Exclude<RejectionReason, "amount-mismatch">, string> = {
  "wrong-account": "La transferencia no fue a la cuenta correcta.",
  "stale-receipt": "La fecha del comprobante está fuera del rango válido (últimas 24 horas).",
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
 * Assumes expected.accountNumber is digits-only (validated at the env layer).
 * fields.destName is extracted for display/logging only and is not gated on.
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
  // 0.005 = half a centavo; absorbs float noise from OCR-parsed amounts.
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

const SYSTEM_PROMPT = `Eres un extractor de datos de comprobantes de transferencia bancaria de Honduras (BAC, Ficohsa, Banpaís, Tigo Money, etc.). Recibes una captura de pantalla. Extrae los campos y devuélvelos SIEMPRE mediante la herramienta extract_receipt. No emitas ningún juicio de aprobación; solo extrae lo que ves.

Guía de campos:
- isBankReceipt: true solo si la imagen es claramente un comprobante o notificación de transferencia bancaria/billetera. false para memes, fotos al azar o notas manuscritas.
- destAccountNumber: el número de la CUENTA DESTINO (a la que se envió el dinero). Búscalo junto a "a la cuenta", "cuenta Nº", "cuenta destino", "Cta. Crédito", "Cuenta" o "a nombre de". Devuelve solo los dígitos.
- destName: el nombre del titular de la cuenta destino ("a nombre de ...").
- senderName: quién envió o realizó la transferencia, si aparece.
- amount: el monto como número, sin símbolo ni separador de miles (ej. "L8,210.00" → 8210).
- currency: el código o símbolo de moneda tal como aparece (ej. "L", "HNL", "LPS"). Si la moneda va pegada al número (ej. "L8,210.00"), extráela como "L".
- dateTimeIso: combina la fecha y la hora del comprobante en formato ISO 8601 con offset de Honduras (-06:00). Ej. fecha "22 mayo 2026" + hora "11:12 AM" → "2026-05-22T11:12:00-06:00". Si falta la hora, usa T00:00:00-06:00. Si no hay fecha, null.
- reference: el número de referencia o de transacción ("Referencia", "No. de transacción", "comprobante"), como string.

Tanto los comprobantes del lado de quien envía como las notificaciones del lado de quien recibe son válidos: en ambos casos la cuenta destino es la que aparece tras "a nombre de" / "a la cuenta".`;

export class ClaudeVerifier implements PaymentVerifier {
  private client: Anthropic;
  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

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
}
