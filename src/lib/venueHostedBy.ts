import { AppError } from "../middleware/errorHandler";

export type VenuePublishSurface = {
  name: string;
  hostedBy: "NYTO" | "PARTNER" | string;
};

/** Admin console may publish packages only for NYTO curated venues. */
export function assertAdminCanPublish(venue: VenuePublishSurface) {
  if (String(venue.hostedBy) === "PARTNER") {
    throw new AppError(
      `${venue.name} is partner hosted. Packages are created in the venue dashboard — admin is view-only.`,
      403,
    );
  }
}

/** Venue portal may publish packages only for partner-hosted venues. */
export function assertVenuePortalCanPublish(venue: VenuePublishSurface) {
  if (String(venue.hostedBy) !== "PARTNER") {
    throw new AppError(
      `${venue.name} is NYTO curated. Packages are published from admin, not the venue dashboard.`,
      403,
    );
  }
}
