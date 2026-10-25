import { describe, expect, it } from "vitest";
import {
  isBelowMinToRun,
  isInUnderfillFillWindow,
  paidSeatsForRun,
  venueMayCancelUnderfill,
} from "./tableUnderfill";

describe("paidSeatsForRun", () => {
  it("counts confirmed and attended only", () => {
    expect(
      paidSeatsForRun([
        { seatsBooked: 2, status: "CONFIRMED" },
        { seatsBooked: 1, status: "PENDING_PAYMENT" },
        { seatsBooked: 1, status: "ATTENDED" },
        { seatsBooked: 2, status: "CANCELLED" },
      ]),
    ).toBe(3);
  });
});

describe("isBelowMinToRun", () => {
  it("is true below 3", () => {
    expect(isBelowMinToRun(0)).toBe(true);
    expect(isBelowMinToRun(2)).toBe(true);
    expect(isBelowMinToRun(3)).toBe(false);
  });
});

describe("isInUnderfillFillWindow", () => {
  it("boosts underfilled nights within 24h", () => {
    const starts = new Date("2026-10-26T14:30:00.000Z"); // ~20:00 IST
    const now = new Date("2026-10-25T16:00:00.000Z"); // ~21.5h before
    expect(isInUnderfillFillWindow(starts, 2, 4, true, now)).toBe(true);
  });

  it("does not boost when already at min", () => {
    const starts = new Date("2026-10-26T14:30:00.000Z");
    const now = new Date("2026-10-25T16:00:00.000Z");
    expect(isInUnderfillFillWindow(starts, 3, 3, true, now)).toBe(false);
  });

  it("does not boost more than 24h out", () => {
    const starts = new Date("2026-10-27T14:30:00.000Z");
    const now = new Date("2026-10-25T14:30:00.000Z"); // 48h before
    expect(isInUnderfillFillWindow(starts, 1, 5, true, now)).toBe(false);
  });
});

describe("venueMayCancelUnderfill", () => {
  it("allows cancel when underfilled and no attendance", () => {
    expect(
      venueMayCancelUnderfill({ paidSeats: 2, hasAttended: false }),
    ).toBe(true);
  });

  it("blocks when attended or at min", () => {
    expect(
      venueMayCancelUnderfill({ paidSeats: 2, hasAttended: true }),
    ).toBe(false);
    expect(
      venueMayCancelUnderfill({ paidSeats: 3, hasAttended: false }),
    ).toBe(false);
  });
});
