-- CreateEnum
CREATE TYPE "NytoTableType" AS ENUM ('WEEKLY', 'WOMEN_LED', 'COUPLES', 'SINGLES');

-- CreateEnum
CREATE TYPE "TablePaymentType" AS ENUM ('ALL_INCLUSIVE', 'PAY_OWN_BILL');

-- AlterEnum
ALTER TYPE "BookingType" ADD VALUE 'COUPLE';

-- AlterTable
ALTER TABLE "supper_tables" ADD COLUMN "tableType" "NytoTableType" NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN "paymentType" "TablePaymentType" NOT NULL DEFAULT 'ALL_INCLUSIVE',
ADD COLUMN "vibeCopy" TEXT,
ADD COLUMN "inclusions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing women-only inventory becomes Women-Led.
UPDATE "supper_tables"
SET "tableType" = 'WOMEN_LED'
WHERE "genderPreference" = 'WOMEN_ONLY';

-- CreateIndex
CREATE INDEX "supper_tables_tableType_idx" ON "supper_tables"("tableType");
