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
