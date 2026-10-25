import { describe, expect, it } from "vitest";
import { isInstantTable } from "./instantTable";

describe("isInstantTable", () => {
  it("is true for Saturday today with seats left and booking open", () => {
    // 2026-09-05 20:00 IST = 14:30 UTC
    const starts = new Date("2026-09-05T14:30:00.000Z");
    const now = new Date("2026-09-05T08:00:00.000Z"); // 13:30 IST same day
    expect(isInstantTable(starts, 2, true, now)).toBe(true);
  });

  it("is true for Sunday today with seats left", () => {
    const starts = new Date("2026-09-06T14:30:00.000Z");
    const now = new Date("2026-09-06T08:00:00.000Z");
    expect(isInstantTable(starts, 1, true, now)).toBe(true);
  });

  it("is false when sold out", () => {
    const starts = new Date("2026-09-05T14:30:00.000Z");
    const now = new Date("2026-09-05T08:00:00.000Z");
    expect(isInstantTable(starts, 0, true, now)).toBe(false);
  });

  it("is false on a weekday today when already at min paid seats", () => {
    const starts = new Date("2026-09-09T14:30:00.000Z"); // Wednesday
    const now = new Date("2026-09-09T08:00:00.000Z");
    // paidSeats=3 → no underfill Instant; weekday ≠ classic Sat/Sun Instant
    expect(isInstantTable(starts, 2, true, now, 3)).toBe(false);
  });

  it("is true on a weekday today when underfilled (Instant fill boost)", () => {
    const starts = new Date("2026-09-09T14:30:00.000Z"); // Wednesday
    const now = new Date("2026-09-09T08:00:00.000Z");
    expect(isInstantTable(starts, 2, true, now, 1)).toBe(true);
  });

  it("is false when event is tomorrow and fully filled enough", () => {
    const starts = new Date("2026-09-06T14:30:00.000Z");
    const now = new Date("2026-09-05T08:00:00.000Z");
    // paidSeats=3 → no underfill boost; tomorrow ≠ weekend-today Instant
    expect(isInstantTable(starts, 2, true, now, 3)).toBe(false);
  });

  it("is true when underfilled within 24h (any day) — Instant fill boost", () => {
    const starts = new Date("2026-09-09T14:30:00.000Z"); // Wednesday
    const now = new Date("2026-09-08T16:00:00.000Z"); // ~22.5h before
    expect(isInstantTable(starts, 4, true, now, 2)).toBe(true);
  });

  it("is false when booking is not open yet", () => {
    const starts = new Date("2026-09-05T14:30:00.000Z");
    const now = new Date("2026-09-05T08:00:00.000Z");
    expect(isInstantTable(starts, 2, false, now)).toBe(false);
  });
});
