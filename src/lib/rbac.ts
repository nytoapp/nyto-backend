import { UserRole } from "@prisma/client";

/**
 * Platform RBAC helpers.
 *
 * Roles are always loaded from the database — never from the JWT or request body.
 * ADMIN bypasses venue tenancy; VENUE_STAFF is scoped by VenueStaff memberships.
 */

/** True when `role` is allowed to hit a route gated by `allowed`. ADMIN always passes. */
export function roleAllowed(role: UserRole, allowed: readonly UserRole[]): boolean {
  if (role === UserRole.ADMIN) return true;
  return allowed.includes(role);
}

/**
 * True when the actor may act on `venueId`.
 * ADMIN: any venue. VENUE_STAFF: only active memberships. USER: never.
 */
export function canAccessVenue(
  role: UserRole,
  venueIds: readonly string[],
  venueId: string,
): boolean {
  if (!venueId) return false;
  if (role === UserRole.ADMIN) return true;
  if (role !== UserRole.VENUE_STAFF) return false;
  return venueIds.includes(venueId);
}
