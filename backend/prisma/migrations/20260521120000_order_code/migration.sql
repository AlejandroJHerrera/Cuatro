-- AlterTable: add the human-readable order code, unique. Empty table so we can
-- add NOT NULL without a backfill.
ALTER TABLE "Order" ADD COLUMN "code" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");
