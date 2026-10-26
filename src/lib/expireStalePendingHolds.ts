import {
  BookingStatus,
  PaymentStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "./prisma";
import { PENDING_PAYMENT_TTL_MS } from "./bookingSeats";

type Db = Prisma.TransactionClient | typeof prisma;

export const HOLD_EXPIRED_REASON = "HOLD_EXPIRED";

export type ExpireStalePendingOpts = {
  /** Limit to one table (booking create / table lock path). */
  tableId?: string;
  /** Limit to one venue (door / nights list). */
  venueId?: string;
  /** Limit to one guest (GET /bookings/me). */
  userId?: string;
  /** Limit to specific booking ids (detail / pay / capture). */
  bookingIds?: string[];
  now?: Date;
  /** Use the open transaction when inventoring under a table lock. */
  tx?: Prisma.TransactionClient;
};

/**
 * Persist soft seat TTL: mark expired PENDING_PAYMENT rows CANCELLED and
 * fail any still-PENDING ledger payments. Idempotent.
 *
 * Capacity / gender helpers already ignore expired holds in memory; this
 * keeps guest/admin lists honest when bookings are read or seats are taken.
 */
export async function expireStalePendingHolds(
  opts: ExpireStalePendingOpts = {},
): Promise<{ expiredCount: number }> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - PENDING_PAYMENT_TTL_MS);
  const db: Db = opts.tx ?? prisma;

  const where: Prisma.BookingWhereInput = {
    status: BookingStatus.PENDING_PAYMENT,
    createdAt: { lt: cutoff },
  };
  if (opts.tableId) where.tableId = opts.tableId;
  if (opts.venueId) where.table = { venueId: opts.venueId };
  if (opts.userId) where.userId = opts.userId;
  if (opts.bookingIds?.length) where.id = { in: opts.bookingIds };

  const stale = await db.booking.findMany({
    where,
    select: { id: true },
  });
  if (stale.length === 0) return { expiredCount: 0 };

  const ids = stale.map((b) => b.id);
  const cancelled = await db.booking.updateMany({
    where: {
      id: { in: ids },
      status: BookingStatus.PENDING_PAYMENT,
    },
    data: {
      status: BookingStatus.CANCELLED,
      cancelledAt: now,
      cancelReason: HOLD_EXPIRED_REASON,
    },
  });

  if (cancelled.count > 0) {
    await db.payment.updateMany({
      where: {
        bookingId: { in: ids },
        status: PaymentStatus.PENDING,
      },
      data: { status: PaymentStatus.FAILED },
    });
  }

  return { expiredCount: cancelled.count };
}
