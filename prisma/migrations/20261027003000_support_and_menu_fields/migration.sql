-- CreateEnum
CREATE TYPE "MenuPublishStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "SupportSource" AS ENUM ('VENUE', 'GUEST');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('DOOR', 'BOOKING', 'NIGHT', 'PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED');

-- AlterTable VenueMenu — first-class publish status + categories
ALTER TABLE "venue_menus" ADD COLUMN "publishStatus" "MenuPublishStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "venue_menus" ADD COLUMN "categories" "NytoTableType"[] DEFAULT ARRAY[]::"NytoTableType"[];

-- CreateTable support_tickets
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "source" "SupportSource" NOT NULL DEFAULT 'VENUE',
    "venueId" TEXT,
    "bookingId" TEXT,
    "userId" TEXT,
    "staffUserId" TEXT,
    "subject" TEXT NOT NULL,
    "category" "SupportCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_status_createdAt_idx" ON "support_tickets"("status", "createdAt");
CREATE INDEX "support_tickets_venueId_status_idx" ON "support_tickets"("venueId", "status");
CREATE INDEX "support_tickets_source_status_idx" ON "support_tickets"("source", "status");

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
