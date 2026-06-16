-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('customer', 'adminReserved', 'adminSold');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'customer',
ADD COLUMN "recipientEmail" TEXT;
