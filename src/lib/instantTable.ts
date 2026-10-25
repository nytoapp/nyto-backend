import { istCalendarDate, istWeekdayShort } from "./bookingWindow";
import { isInUnderfillFillWindow } from "./tableUnderfill";

/**
 * Instant is a filtered view — not a table type.
 *
 * A table is Instant when either:
 * A) Classic: happening today (IST) on Sat/Sun, open seats, bookable, not started
 * B) Underfill boost: starts within 24h, paid seats < 3, still has seats to book
 *    (so thin tables land in Instant for last-chance fill — then venue may cancel)
 */
export function isInstantTable(
  startsAt: Date,
  seatsLeft: number,
  bookable: boolean,
  now = new Date(),
  paidSeats = 0,
): boolean {
  if (seatsLeft <= 0 || !bookable) return false;
  if (now >= startsAt) return false;

  const eventDay = istCalendarDate(startsAt);
  const today = istCalendarDate(now);
  if (eventDay === today) {
    const weekday = istWeekdayShort(startsAt);
    if (weekday === "Sat" || weekday === "Sun") return true;
  }

  return isInUnderfillFillWindow(
    startsAt,
    paidSeats,
    seatsLeft,
    bookable,
    now,
  );
}
