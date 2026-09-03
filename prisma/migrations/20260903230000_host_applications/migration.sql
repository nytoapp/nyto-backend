-- CreateEnum
CREATE TYPE "HostApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "host_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "HostApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "venueName" TEXT NOT NULL,
    "venueType" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Hyderabad',
    "area" TEXT,
    "businessDetails" TEXT,
    "notes" TEXT,
    "venueId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_applications_status_createdAt_idx" ON "host_applications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "host_applications_userId_status_idx" ON "host_applications"("userId", "status");

-- AddForeignKey
ALTER TABLE "host_applications" ADD CONSTRAINT "host_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_applications" ADD CONSTRAINT "host_applications_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
