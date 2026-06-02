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
