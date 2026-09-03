-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CAPTURED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CARD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STUB', 'RAZORPAY');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "checkInCode" TEXT,
ADD COLUMN "checkedInAt" TIMESTAMP(3),
ADD COLUMN "cancelReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bookings_checkInCode_key" ON "bookings"("checkInCode");

-- CreateIndex
CREATE INDEX "bookings_tableId_status_idx" ON "bookings"("tableId", "status");

-- CreateIndex
CREATE INDEX "bookings_userId_status_idx" ON "bookings"("userId", "status");

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL DEFAULT 'UNKNOWN',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STUB',
    "providerRef" TEXT,
    "capturedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_bookingId_key" ON "payments"("bookingId");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
