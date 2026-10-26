import {
  BookingStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  TableStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "./prisma";
import {
  isPendingHoldExpired,
  seatsHoldingCapacity,
} from "./bookingSeats";
import { generateCheckInCode } from "./checkInCode";
import { expireStalePendingHolds } from "./expireStalePendingHolds";
import { moneyFor } from "./pricing";
import { lockSupperTableForInventory } from "./tableInventoryLock";
import { AppError } from "../middleware/errorHandler";

type Tx = Prisma.TransactionClient;

async function uniqueCheckInCode(tx: Tx): Promise<string> {
  let checkInCode = generateCheckInCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await tx.booking.findUnique({
      where: { checkInCode },
      select: { id: true },
    });
    if (!clash) return checkInCode;
    checkInCode = generateCheckInCode();
  }
  return checkInCode;
}

/**
 * Mark a PENDING_PAYMENT booking as paid after provider confirmation.
 * Idempotent if already CONFIRMED with the same providerRef.
 */
export async function captureBookingPayment(opts: {
  bookingId: string;
  userId: string;
  provider: PaymentProvider;
  providerRef: string;
  method: PaymentMethod;
}) {
  const booking = await prisma.booking.findUnique({
    where: { id: opts.bookingId },
    include: { table: true, payment: true },
  });
  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.userId !== opts.userId) throw new AppError("Forbidden", 403);

  if (booking.status === BookingStatus.CONFIRMED) {
    if (
      booking.payment?.providerRef === opts.providerRef ||
      booking.paymentRef === opts.providerRef
    ) {
      return {
        booking: await prisma.booking.findUniqueOrThrow({
          where: { id: booking.id },
          include: {
            table: { include: { venue: true, menu: true } },
            payment: true,
          },
        }),
        pricing: moneyFor(booking.table.seatPrice, booking.seatsBooked),
        checkInCode: booking.checkInCode,
        alreadyCaptured: true as const,
      };
    }
    throw new AppError("Booking is already paid");
  }

  if (booking.status !== BookingStatus.PENDING_PAYMENT) {
    throw new AppError("Booking is not awaiting payment");
  }

  if (isPendingHoldExpired(booking.createdAt)) {
    await expireStalePendingHolds({ bookingIds: [booking.id] });
    throw new AppError(
      "Payment hold expired — create a new booking to reserve seats",
      409,
    );
  }

  if (
    booking.table.status !== TableStatus.OPEN &&
    booking.table.status !== TableStatus.MATCHING
  ) {
    throw new AppError("This table is not open for booking", 409);
  }

  const money = moneyFor(booking.table.seatPrice, booking.seatsBooked);

  const updated = await prisma.$transaction(async (tx) => {
    try {
      await lockSupperTableForInventory(tx, booking.tableId);
    } catch (err) {
      if (err instanceof Error && err.message === "TABLE_LOCK_MISS") {
        throw new AppError("Table not found", 404);
      }
      throw err;
    }

    const fresh = await tx.booking.findUnique({
      where: { id: booking.id },
      include: { table: true },
    });
    if (!fresh) throw new AppError("Booking not found", 404);
    if (fresh.status !== BookingStatus.PENDING_PAYMENT) {
      throw new AppError(
        "Booking is no longer awaiting payment — refresh and try again",
        409,
      );
    }
    if (isPendingHoldExpired(fresh.createdAt)) {
      await expireStalePendingHolds({ bookingIds: [booking.id], tx });
      throw new AppError(
        "Payment hold expired — create a new booking to reserve seats",
        409,
      );
    }
    if (
      fresh.table.status !== TableStatus.OPEN &&
      fresh.table.status !== TableStatus.MATCHING
    ) {
      throw new AppError("This table is not open for booking", 409);
    }

    const peers = await tx.booking.findMany({
      where: {
        tableId: booking.tableId,
        id: { not: booking.id },
      },
      select: { seatsBooked: true, status: true, createdAt: true },
    });
    const taken = seatsHoldingCapacity(peers);
    if (taken + fresh.seatsBooked > fresh.table.capacity) {
      throw new AppError("Not enough seats left on this table", 409);
    }

    const checkInCode = await uniqueCheckInCode(tx);

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CONFIRMED,
        amountPaid: money.total,
        paidAt: new Date(),
        paymentRef: opts.providerRef,
        checkInCode,
      },
    });

    await tx.payment.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        amount: money.total,
        currency: "INR",
        status: PaymentStatus.CAPTURED,
        method: opts.method,
        provider: opts.provider,
        providerRef: opts.providerRef,
        capturedAt: new Date(),
      },
      update: {
        amount: money.total,
        status: PaymentStatus.CAPTURED,
        method: opts.method,
        provider: opts.provider,
        providerRef: opts.providerRef,
        capturedAt: new Date(),
      },
    });

    const memberUser = await tx.user.findUnique({
      where: { id: booking.userId },
      select: { tableOneLiner: true },
    });

    await tx.tableMember.upsert({
      where: {
        tableId_userId: {
          tableId: booking.tableId,
          userId: booking.userId,
        },
      },
      create: {
        tableId: booking.tableId,
        userId: booking.userId,
        oneLineDescription: memberUser?.tableOneLiner ?? null,
      },
      update: {
        oneLineDescription: memberUser?.tableOneLiner ?? undefined,
      },
    });

    const confirmedSeats = await tx.booking.aggregate({
      where: {
        tableId: booking.tableId,
        status: {
          in: [BookingStatus.CONFIRMED, BookingStatus.ATTENDED],
        },
      },
      _sum: { seatsBooked: true },
    });

    const confirmedTaken = confirmedSeats._sum.seatsBooked ?? 0;
    if (confirmedTaken >= fresh.table.capacity) {
      await tx.supperTable.update({
        where: { id: booking.tableId },
        data: { status: TableStatus.MATCHING },
      });
    }

    return tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: {
        table: { include: { venue: true, menu: true } },
        payment: true,
      },
    });
  });

  return {
    booking: updated,
    pricing: money,
    checkInCode: updated.checkInCode,
    alreadyCaptured: false as const,
  };
}
