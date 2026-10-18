-- Who organises nights at a venue (NYTO curated vs partner dashboard).
CREATE TYPE "VenueHostedBy" AS ENUM ('NYTO', 'PARTNER');

ALTER TABLE "venues"
  ADD COLUMN "hostedBy" "VenueHostedBy" NOT NULL DEFAULT 'NYTO';

CREATE INDEX "venues_hostedBy_isActive_idx" ON "venues"("hostedBy", "isActive");
