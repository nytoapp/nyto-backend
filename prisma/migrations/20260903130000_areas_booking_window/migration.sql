-- AlterTable
ALTER TABLE "venues" ADD COLUMN "area" TEXT;

-- CreateIndex
CREATE INDEX "venues_city_area_idx" ON "venues"("city", "area");

-- AlterTable: backfill bookingOpensAt = createdAt for existing rows, then require NOT NULL
ALTER TABLE "supper_tables" ADD COLUMN "bookingOpensAt" TIMESTAMP(3);

UPDATE "supper_tables"
SET "bookingOpensAt" = COALESCE("createdAt", "startsAt" - INTERVAL '3 days')
WHERE "bookingOpensAt" IS NULL;

ALTER TABLE "supper_tables" ALTER COLUMN "bookingOpensAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "supper_tables_bookingOpensAt_idx" ON "supper_tables"("bookingOpensAt");
