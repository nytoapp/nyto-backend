import { describe, expect, it } from "vitest";
import { isRevealEligible, REVEAL_WINDOW_MS } from "./tableReveal";

describe("isRevealEligible", () => {
  it("is false more than 24h before start", () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    const startsAt = new Date(now.getTime() + REVEAL_WINDOW_MS + 60_000);
    expect(isRevealEligible(startsAt, now)).toBe(false);
  });

  it("is true inside the 24h window", () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    const startsAt = new Date(now.getTime() + REVEAL_WINDOW_MS - 60_000);
    expect(isRevealEligible(startsAt, now)).toBe(true);
  });

  it("is true after start", () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    const startsAt = new Date(now.getTime() - 60_000);
    expect(isRevealEligible(startsAt, now)).toBe(true);
  });
});
