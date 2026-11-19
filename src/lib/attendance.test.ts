import { describe, expect, it } from "vitest";
import { attendanceSnapshot } from "./attendance";

const t = (iso: string) => new Date(iso);

describe("attendanceSnapshot", () => {
  it("counts one dinner when a booking is checked in", () => {
    expect(
      attendanceSnapshot([
        { status: "ATTENDED", tableId: "a", startsAt: t("2026-11-01T14:30:00.000Z") },
      ]),
    ).toEqual({ attendanceCount: 1, currentStreak: 1 });
  });

  it("counts seats on the same table as one dinner", () => {
    expect(
      attendanceSnapshot([
        { status: "ATTENDED", tableId: "a", startsAt: t("2026-11-01T14:30:00.000Z") },
        { status: "ATTENDED", tableId: "a", startsAt: t("2026-11-01T14:30:00.000Z") },
      ]),
    ).toEqual({ attendanceCount: 1, currentStreak: 1 });
  });

  it("walks the newest dinners and stops at a no-show", () => {
    expect(
      attendanceSnapshot([
        { status: "ATTENDED", tableId: "old", startsAt: t("2026-10-01T14:30:00.000Z") },
        { status: "NO_SHOW", tableId: "mid", startsAt: t("2026-10-15T14:30:00.000Z") },
        { status: "ATTENDED", tableId: "new", startsAt: t("2026-11-01T14:30:00.000Z") },
        { status: "ATTENDED", tableId: "newer", startsAt: t("2026-11-08T14:30:00.000Z") },
      ]),
    ).toEqual({ attendanceCount: 3, currentStreak: 2 });
  });

  it("breaks the streak when the latest dinner is a no-show", () => {
    expect(
      attendanceSnapshot([
        { status: "ATTENDED", tableId: "old", startsAt: t("2026-10-01T14:30:00.000Z") },
        { status: "NO_SHOW", tableId: "new", startsAt: t("2026-11-01T14:30:00.000Z") },
      ]),
    ).toEqual({ attendanceCount: 1, currentStreak: 0 });
  });

  it("keeps a late check-in on a no-show as attended", () => {
    expect(
      attendanceSnapshot([
        { status: "NO_SHOW", tableId: "a", startsAt: t("2026-11-01T14:30:00.000Z") },
        { status: "ATTENDED", tableId: "a", startsAt: t("2026-11-01T14:30:00.000Z") },
      ]),
    ).toEqual({ attendanceCount: 1, currentStreak: 1 });
  });
});
