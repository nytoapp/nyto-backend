/**
 * Underfill policy (supper-club style — resolves the Instant vs Cancel confusion):
 *
 * 1) FILL WINDOW — from 24h before start until start:
 *    If paid seats < MIN_PAID_SEATS_TO_RUN and seats remain → surface in Instant
 *    so more guests can book (same Instant lane in the NYTO app).
 *
 * 2) CANCEL — venue (or admin) may cancel when paid seats are still below
 *    MIN_PAID_SEATS_TO_RUN and nobody has checked in. Paid guests are refunded.
 *
 * Instant weekend-same-day (Sat/Sun today) stays as before; underfill is an
 * additional Instant boost for any day within the fill window.
 */

export const MIN_PAID_SEATS_TO_RUN = 3;
export const UNDERFILL_INSTANT_HOURS = 24;

export type UnderfillBookingRow = {
  seatsBooked: number;
  status: string;
};

/** Confirmed / attended paid seats only (not pending payment holds). */
export function paidSeatsForRun(bookings: UnderfillBookingRow[]): number {
  return bookings
    .filter((b) => {
      const s = String(b.status).toUpperCase();
      return s === "CONFIRMED" || s === "ATTENDED";
    })
    .reduce((sum, b) => sum + b.seatsBooked, 0);
}

export function isBelowMinToRun(paidSeats: number): boolean {
  return paidSeats < MIN_PAID_SEATS_TO_RUN;
}

/** True when the night is in the last 24h and still below min paid seats. */
export function isInUnderfillFillWindow(
  startsAt: Date,
  paidSeats: number,
  seatsLeft: number,
  bookable: boolean,
  now = new Date(),
): boolean {
  if (!bookable || seatsLeft <= 0) return false;
  if (now >= startsAt) return false;
  if (!isBelowMinToRun(paidSeats)) return false;
  const hoursLeft = (startsAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  return hoursLeft > 0 && hoursLeft <= UNDERFILL_INSTANT_HOURS;
}

/** Venue may cancel + refund when underfilled and no one has checked in. */
export function venueMayCancelUnderfill(input: {
  paidSeats: number;
  hasAttended: boolean;
}): boolean {
  if (input.hasAttended) return false;
  return isBelowMinToRun(input.paidSeats);
}
