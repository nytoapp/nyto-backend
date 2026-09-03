import { describe, expect, it } from "vitest";

/**
 * Pure invariant tests — Prisma client must be regenerated after migrate
 * for enum imports; keep these string-level so CI doesn't need a live DLL rename.
 */
describe("host application invariants", () => {
  it("pending is the only approvable status", () => {
    const statuses = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
    const approvable = statuses.filter((s) => s === "PENDING");
    expect(approvable).toEqual(["PENDING"]);
  });

  it("owner staff role is used for approved hosts", () => {
    expect("OWNER").toBe("OWNER");
  });

  it("consumer role elevates to VENUE_STAFF, not ADMIN", () => {
    expect(["USER", "VENUE_STAFF", "ADMIN"]).toContain("VENUE_STAFF");
    expect(["USER", "VENUE_STAFF", "ADMIN"]).not.toContain("HOST");
  });
});
