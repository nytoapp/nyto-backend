-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'VENUE_STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "VenueStaffRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "venue_staff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "staffRole" "VenueStaffRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "venue_staff_venueId_isActive_idx" ON "venue_staff"("venueId", "isActive");

-- CreateIndex
CREATE INDEX "venue_staff_userId_isActive_idx" ON "venue_staff"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "venue_staff_userId_venueId_key" ON "venue_staff"("userId", "venueId");

-- AddForeignKey
ALTER TABLE "venue_staff" ADD CONSTRAINT "venue_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_staff" ADD CONSTRAINT "venue_staff_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
