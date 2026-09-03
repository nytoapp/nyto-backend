/**
 * Default booking unlock windows (Asia/Kolkata).
 * - Sat/Sun nights → Thursday 09:00 IST of that week
 * - Weekday nights → 3 days before at 09:00 IST
 * Admin/venue may override by setting bookingOpensAt explicitly later.
 */

export function istCalendarDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function istWeekdayShort(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "Asia/Kolkata",
  });
}

/** 09:00 Asia/Kolkata on YYYY-MM-DD + dayOffset → UTC Date */
export function istNineAmOn(isoDate: string, dayOffset = 0): Date {
  const [y, m, day] = isoDate.split("-").map(Number);
  // 09:00 IST = 03:30 UTC
  return new Date(Date.UTC(y!, m! - 1, day! + dayOffset, 3, 30, 0));
}

export function defaultBookingOpensAt(startsAt: Date): Date {
  const dateStr = istCalendarDate(startsAt);
  const weekday = istWeekdayShort(startsAt);

  if (weekday === "Sat") {
    return istNineAmOn(dateStr, -2); // Thursday
  }
  if (weekday === "Sun") {
    return istNineAmOn(dateStr, -3); // Thursday
  }
  return istNineAmOn(dateStr, -3); // 3 days before, 09:00 IST
}

export function isBookingOpen(
  bookingOpensAt: Date,
  startsAt: Date,
  now = new Date(),
): boolean {
  return now >= bookingOpensAt && now < startsAt;
}
