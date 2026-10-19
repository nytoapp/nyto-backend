import {
  BookingStatus,
  HostApplicationStatus,
  PaymentStatus,
  TableStatus,
} from "@prisma/client";

/** Upcoming inventory window for Overview (Asia/Kolkata wall-clock via Date). */
export const OVERVIEW_UPCOMING_DAYS = 30;

/** Nights that are still operable inventory (not cancelled / finished). */
export const ELIGIBLE_NIGHT_STATUSES: TableStatus[] = [
  TableStatus.OPEN,
  TableStatus.MATCHING,
  TableStatus.AWAITING_REVIEW,
  TableStatus.APPROVED,
  TableStatus.REVEALED,
];

/** Seats counted as sold (paid / checked-in). Excludes unpaid holds. */
export const SEATS_SOLD_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.ATTENDED,
];

export function overviewWindowEnd(
  now: Date,
  days = OVERVIEW_UPCOMING_DAYS,
): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export type OverviewMetricIds =
  | "upcoming_nights"
  | "confirmed_bookings_upcoming"
  | "seats_sold_upcoming"
  | "payments_pending"
  | "payments_failed"
  | "host_applications_pending"
  | "captured_amount"
  | "pending_amount"
  | "refunded_amount";

/**
 * Metric contract (Overview + shared semantics).
 *
 * upcoming_nights — count SupperTable where status ∈ ELIGIBLE_NIGHT_STATUSES,
 *   startsAt > now AND startsAt < now+30d. Unit: nights. Window: upcoming 30d IST.
 *
 * confirmed_bookings_upcoming — count Booking status=CONFIRMED on those nights.
 *   Unit: bookings (not seats/guests). Window: night start in upcoming 30d.
 *
 * seats_sold_upcoming — sum seatsBooked for CONFIRMED|ATTENDED on those nights
 *   over sum(capacity) of those nights. Unit: seats. Excludes PENDING_PAYMENT holds.
 *
 * payments_pending — count Payment status=PENDING (ledger records, not bookings).
 * payments_failed — count Payment status=FAILED (attention).
 * host_applications_pending — count HostApplication status=PENDING.
 *
 * captured_amount — sum Payment.amount where CAPTURED (INR paise-as-rupees Int).
 * pending_amount — sum where PENDING.
 * refunded_amount — sum where REFUNDED (status mutates off CAPTURED; no double-subtract).
 */
export const METRIC_CONTRACT: Record<
  OverviewMetricIds,
  { label: string; entity: string; unit: string }
> = {
  upcoming_nights: {
    label: "Upcoming nights",
    entity: "SupperTable",
    unit: "nights",
  },
  confirmed_bookings_upcoming: {
    label: "Confirmed bookings",
    entity: "Booking",
    unit: "bookings",
  },
  seats_sold_upcoming: {
    label: "Seats sold",
    entity: "Booking.seatsBooked / SupperTable.capacity",
    unit: "seats",
  },
  payments_pending: {
    label: "Payments pending",
    entity: "Payment",
    unit: "payment records",
  },
  payments_failed: {
    label: "Failed payments",
    entity: "Payment",
    unit: "payment records",
  },
  host_applications_pending: {
    label: "Applications awaiting review",
    entity: "HostApplication",
    unit: "applications",
  },
  captured_amount: {
    label: "Captured amount",
    entity: "Payment",
    unit: "INR",
  },
  pending_amount: {
    label: "Pending amount",
    entity: "Payment",
    unit: "INR",
  },
  refunded_amount: {
    label: "Refunded amount",
    entity: "Payment",
    unit: "INR",
  },
};

export function occupancyPercent(sold: number, capacity: number): number | null {
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  if (!Number.isFinite(sold) || sold < 0) return null;
  return Math.min(100, Math.round((sold / capacity) * 100));
}

export { HostApplicationStatus, PaymentStatus, BookingStatus, TableStatus };
