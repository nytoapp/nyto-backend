import { BookingStatus } from "@prisma/client";

export type AttendanceRow = {
  status: BookingStatus | string;
  tableId: string;
  startsAt: Date;
};

export type AttendanceSnapshot = {
  /** Distinct dinners this guest actually showed up for. */
  attendanceCount: number;
  /** Consecutive attended dinners, newest first. A no-show breaks it. */
  currentStreak: number;
};

/**
 * One dinner per table. Attended wins if any seat on that table was checked in.
 * Streak walks from the latest dinner backward and stops at the first no-show.
 */
export function attendanceSnapshot(
  rows: AttendanceRow[],
): AttendanceSnapshot {
  const byTable = new Map<
    string,
    { startsAt: Date; attended: boolean; noShow: boolean }
  >();

  for (const row of rows) {
    const current = byTable.get(row.tableId) ?? {
      startsAt: row.startsAt,
      attended: false,
      noShow: false,
    };
    if (row.startsAt.getTime() > current.startsAt.getTime()) {
      current.startsAt = row.startsAt;
    }
    if (row.status === BookingStatus.ATTENDED) current.attended = true;
    if (row.status === BookingStatus.NO_SHOW) current.noShow = true;
    byTable.set(row.tableId, current);
  }

  const dinners = [...byTable.values()].sort(
    (a, b) => b.startsAt.getTime() - a.startsAt.getTime(),
  );

  let currentStreak = 0;
  for (const dinner of dinners) {
    if (dinner.attended) {
      currentStreak += 1;
      continue;
    }
    if (dinner.noShow) break;
    break;
  }

  return {
    attendanceCount: dinners.filter((d) => d.attended).length,
    currentStreak,
  };
}
