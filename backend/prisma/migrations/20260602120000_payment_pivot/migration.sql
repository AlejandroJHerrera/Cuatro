-- UserRole enum
CREATE TYPE "UserRole" AS ENUM ('customer', 'doorStaff', 'admin');

-- User.role
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'customer';

-- Order: drop stripeSessionId, add verification fields
ALTER TABLE "Order" DROP COLUMN IF EXISTS "stripeSessionId";
ALTER TABLE "Order" ADD COLUMN "verificationAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "rejectionReason" TEXT;

-- Ticket: qrPayload (nullable for backfill — no paid orders yet)
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
