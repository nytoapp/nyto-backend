import { BookingStatus } from "@prisma/client";

/** Pending holds older than this no longer reserve seats. */
export const PENDING_PAYMENT_TTL_MS = 20 * 60 * 1000;

const HOLDING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.ATTENDED,
  BookingStatus.PENDING_PAYMENT,
];

export type SeatBookingRow = {
  seatsBooked: number;
  status: BookingStatus;
  createdAt?: Date;
};

/** Seats that currently block capacity (paid / attended / fresh unpaid holds). */
export function seatsHoldingCapacity(
  bookings: SeatBookingRow[],
  now = new Date(),
): number {
  const cutoff = now.getTime() - PENDING_PAYMENT_TTL_MS;
  return bookings
    .filter((b) => {
      if (
        b.status === BookingStatus.CONFIRMED ||
        b.status === BookingStatus.ATTENDED
      ) {
        return true;
      }
      if (b.status !== BookingStatus.PENDING_PAYMENT) return false;
      if (!b.createdAt) return true;
      return b.createdAt.getTime() >= cutoff;
    })
    .reduce((sum, b) => sum + b.seatsBooked, 0);
}

export function isHoldingStatus(status: BookingStatus): boolean {
  return HOLDING_STATUSES.includes(status);
}

/**
 * Same TTL semantics as seatsHoldingCapacity — use for gender mix / matching
 * so expired pending holds do not skew Singles caps.
 */
export function isActivelyHoldingSeat(
  booking: SeatBookingRow,
  now = new Date(),
): boolean {
  if (
    booking.status === BookingStatus.CONFIRMED ||
    booking.status === BookingStatus.ATTENDED
  ) {
    return true;
  }
  if (booking.status !== BookingStatus.PENDING_PAYMENT) return false;
  if (!booking.createdAt) return true;
  return booking.createdAt.getTime() >= now.getTime() - PENDING_PAYMENT_TTL_MS;
}

/** True when a PENDING_PAYMENT hold has passed its seat TTL. */
export function isPendingHoldExpired(
  createdAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!createdAt) return false;
  return createdAt.getTime() < now.getTime() - PENDING_PAYMENT_TTL_MS;
}
