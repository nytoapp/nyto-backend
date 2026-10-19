import { describe, expect, it } from "vitest";
import {
  OVERVIEW_UPCOMING_DAYS,
  occupancyPercent,
  overviewWindowEnd,
} from "./adminOverviewMetrics";

describe("adminOverviewMetrics", () => {
  it("overviewWindowEnd is half-open style end bound (now + N days)", () => {
    const now = new Date("2026-10-19T06:00:00.000Z");
    const end = overviewWindowEnd(now, 30);
    expect(end.getTime() - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(OVERVIEW_UPCOMING_DAYS).toBe(30);
  });

  it("occupancyPercent rounds and caps at 100", () => {
    expect(occupancyPercent(38, 48)).toBe(79);
    expect(occupancyPercent(48, 48)).toBe(100);
    expect(occupancyPercent(60, 48)).toBe(100);
    expect(occupancyPercent(0, 6)).toBe(0);
    expect(occupancyPercent(3, 0)).toBeNull();
    expect(occupancyPercent(-1, 6)).toBeNull();
  });
});
