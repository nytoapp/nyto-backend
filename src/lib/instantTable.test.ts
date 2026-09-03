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

  it("is false on a weekday even if today", () => {
    const starts = new Date("2026-09-09T14:30:00.000Z"); // Wednesday
    const now = new Date("2026-09-09T08:00:00.000Z");
    expect(isInstantTable(starts, 2, true, now)).toBe(false);
  });

  it("is false when event is tomorrow", () => {
    const starts = new Date("2026-09-06T14:30:00.000Z");
    const now = new Date("2026-09-05T08:00:00.000Z");
    expect(isInstantTable(starts, 2, true, now)).toBe(false);
  });

  it("is false when booking is not open yet", () => {
    const starts = new Date("2026-09-05T14:30:00.000Z");
    const now = new Date("2026-09-05T08:00:00.000Z");
    expect(isInstantTable(starts, 2, false, now)).toBe(false);
  });
});
