import { istCalendarDate, istWeekdayShort } from "./bookingWindow";

/**
 * Instant is a filtered view — not a table type.
 * A table is instant when it is happening today (IST) on Sat/Sun,
 * still has open seats, booking is open, and the event has not started.
 */
export function isInstantTable(
  startsAt: Date,
  seatsLeft: number,
  bookable: boolean,
  now = new Date(),
): boolean {
  if (seatsLeft <= 0 || !bookable) return false;
  if (now >= startsAt) return false;

  const eventDay = istCalendarDate(startsAt);
  const today = istCalendarDate(now);
  if (eventDay !== today) return false;

  const weekday = istWeekdayShort(startsAt);
  return weekday === "Sat" || weekday === "Sun";
}
