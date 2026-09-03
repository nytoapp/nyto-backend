import { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canAccessVenue, roleAllowed } from "./rbac";

describe("roleAllowed", () => {
  it("allows exact role matches", () => {
    expect(roleAllowed(UserRole.USER, [UserRole.USER])).toBe(true);
    expect(roleAllowed(UserRole.VENUE_STAFF, [UserRole.VENUE_STAFF])).toBe(true);
  });

  it("rejects consumers on staff/admin gates", () => {
    expect(roleAllowed(UserRole.USER, [UserRole.VENUE_STAFF])).toBe(false);
    expect(roleAllowed(UserRole.USER, [UserRole.ADMIN])).toBe(false);
  });

  it("lets ADMIN through any gate", () => {
    expect(roleAllowed(UserRole.ADMIN, [UserRole.ADMIN])).toBe(true);
    expect(roleAllowed(UserRole.ADMIN, [UserRole.VENUE_STAFF])).toBe(true);
    expect(roleAllowed(UserRole.ADMIN, [UserRole.USER])).toBe(true);
  });
});

describe("canAccessVenue", () => {
  const venues = ["venue_a", "venue_b"];

  it("ADMIN can access any venue", () => {
    expect(canAccessVenue(UserRole.ADMIN, [], "venue_z")).toBe(true);
  });

  it("VENUE_STAFF only for memberships", () => {
    expect(canAccessVenue(UserRole.VENUE_STAFF, venues, "venue_a")).toBe(true);
    expect(canAccessVenue(UserRole.VENUE_STAFF, venues, "venue_z")).toBe(false);
  });

  it("USER never gets venue access", () => {
    expect(canAccessVenue(UserRole.USER, venues, "venue_a")).toBe(false);
  });

  it("rejects empty venueId", () => {
    expect(canAccessVenue(UserRole.ADMIN, venues, "")).toBe(false);
  });
});
