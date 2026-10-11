import {
  BookingStatus,
  PaymentStatus,
  TableStatus,
} from "@prisma/client";
import { prisma } from "./prisma";
import { AppError } from "../middleware/errorHandler";
import { seatsHoldingCapacity } from "./bookingSeats";
import { issueProviderRefund } from "./paymentRefund";

async function refreshTableOpenStatus(tableId: string): Promise<void> {
  const table = await prisma.supperTable.findUnique({
    where: { id: tableId },
    include: {
      bookings: {
        select: { seatsBooked: true, status: true, createdAt: true },
      },
    },
  });
  if (!table) return;
  if (
    table.status !== TableStatus.MATCHING &&
    table.status !== TableStatus.OPEN
  ) {
    return;
  }

  const taken = seatsHoldingCapacity(
    table.bookings.filter(
      (b) =>
        b.status === BookingStatus.CONFIRMED ||
        b.status === BookingStatus.ATTENDED ||
        b.status === BookingStatus.PENDING_PAYMENT,
    ),
  );

  const nextStatus =
    taken >= table.capacity ? TableStatus.MATCHING : TableStatus.OPEN;
  if (nextStatus !== table.status) {
    await prisma.supperTable.update({
      where: { id: tableId },
      data: { status: nextStatus },
    });
  }
}

function adminCancelReason(reason?: string): string {
  const trimmed = reason?.trim();
  return trimmed ? `NYTO: ${trimmed.slice(0, 220)}` : "NYTO";
}

async function markPaymentOnCancel(
  paymentId: string,
  status: "REFUNDED" | "FAILED",
): Promise<void> {
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status:
        status === "REFUNDED"
          ? PaymentStatus.REFUNDED
          : PaymentStatus.FAILED,
      ...(status === "REFUNDED" ? { refundedAt: new Date() } : {}),
    },
  });
}

export async function cancelBookingAsUser(
  bookingId: string,
  userId: string,
): Promise<unknown> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { table: true, payment: true },
  });
  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.userId !== userId) throw new AppError("Forbidden", 403);

  if (
    booking.status === BookingStatus.CANCELLED ||
    booking.status === BookingStatus.ATTENDED ||
    booking.status === BookingStatus.NO_SHOW
  ) {
    throw new AppError("Booking cannot be cancelled");
  }

  if (
    booking.status === BookingStatus.CONFIRMED &&
    booking.table.startsAt <= new Date()
  ) {
    throw new AppError("Cannot cancel after the table has started");
  }

  if (booking.payment?.status === PaymentStatus.CAPTURED) {
    await issueProviderRefund(booking.payment);
  }

  return prisma
    .$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: "USER",
        },
        include: {
          table: { include: { venue: true } },
          payment: true,
        },
      });

      if (booking.payment?.status === PaymentStatus.CAPTURED) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: {
            status: PaymentStatus.REFUNDED,
            refundedAt: new Date(),
          },
        });
      } else if (booking.payment?.status === PaymentStatus.PENDING) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: { status: PaymentStatus.FAILED },
        });
      }

      await tx.tableMember.deleteMany({
        where: { tableId: booking.tableId, userId: booking.userId },
      });

      return updated;
    })
    .then(async (updated) => {
      await refreshTableOpenStatus(booking.tableId);
      return updated;
    });
}

export async function cancelBookingAsAdmin(
  bookingId: string,
  reason?: string,
): Promise<unknown> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.status === BookingStatus.CANCELLED) {
    throw new AppError("Booking already cancelled");
  }
  if (booking.status === BookingStatus.ATTENDED) {
    throw new AppError("Cannot cancel an attended booking");
  }

  if (booking.payment?.status === PaymentStatus.CAPTURED) {
    await issueProviderRefund(booking.payment);
  }

  return prisma
    .$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: adminCancelReason(reason),
        },
        include: {
          table: { include: { venue: true } },
          payment: true,
          user: {
            select: { id: true, fullName: true, phone: true, email: true },
          },
        },
      });

      if (booking.payment?.status === PaymentStatus.CAPTURED) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: {
            status: PaymentStatus.REFUNDED,
            refundedAt: new Date(),
          },
        });
      } else if (booking.payment?.status === PaymentStatus.PENDING) {
        await tx.payment.update({
          where: { id: booking.payment.id },
          data: { status: PaymentStatus.FAILED },
        });
      }

      await tx.tableMember.deleteMany({
        where: { tableId: booking.tableId, userId: booking.userId },
      });

      return updated;
    })
    .then(async (updated) => {
      await refreshTableOpenStatus(booking.tableId);
      return updated;
    });
}

/**
 * Cancel a supper table and cascade: cancel open bookings + refund captured
 * payments. Blocks if guests have already checked in.
 */
export async function cancelTableAsAdmin(
  tableId: string,
  reason?: string,
): Promise<{
  table: unknown;
  cancelledBookings: number;
  refundedPayments: number;
}> {
  const table = await prisma.supperTable.findUnique({
    where: { id: tableId },
    include: {
      bookings: {
        where: {
          status: {
            in: [
              BookingStatus.PENDING_PAYMENT,
              BookingStatus.CONFIRMED,
              BookingStatus.ATTENDED,
            ],
          },
        },
        include: { payment: true },
      },
    },
  });
  if (!table) throw new AppError("Table not found", 404);
  if (table.status === TableStatus.CANCELLED) {
    throw new AppError("Session already cancelled", 409);
  }
  if (table.status === TableStatus.COMPLETED) {
    throw new AppError("Cannot cancel a completed session", 409);
  }

  if (table.bookings.some((b) => b.status === BookingStatus.ATTENDED)) {
    throw new AppError(
      "Cannot cancel a session with checked-in guests",
      409,
    );
  }

  const cancellable = table.bookings.filter(
    (b) =>
      b.status === BookingStatus.PENDING_PAYMENT ||
      b.status === BookingStatus.CONFIRMED,
  );

  let refundedPayments = 0;
  for (const booking of cancellable) {
    const hadCapture = booking.payment?.status === PaymentStatus.CAPTURED;
    await cancelBookingAsAdmin(booking.id, reason);
    if (hadCapture) refundedPayments += 1;
  }

  const updated = await prisma.supperTable.update({
    where: { id: tableId },
    data: { status: TableStatus.CANCELLED },
    include: {
      venue: { select: { id: true, name: true, city: true, area: true } },
      menu: true,
    },
  });

  return {
    table: updated,
    cancelledBookings: cancellable.length,
    refundedPayments,
  };
}

/** Refund a captured payment (PSP + ledger). Cancels the booking when still open. */
export async function refundPaymentAsAdmin(
  paymentId: string,
  reason?: string,
): Promise<unknown> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      booking: {
        include: {
          table: { include: { venue: true } },
          user: {
            select: { id: true, fullName: true, phone: true, email: true },
          },
        },
      },
    },
  });
  if (!payment) throw new AppError("Payment not found", 404);

  if (payment.status === PaymentStatus.REFUNDED) {
    return payment;
  }
  if (payment.status !== PaymentStatus.CAPTURED) {
    throw new AppError("Only captured payments can be refunded", 409);
  }

  const booking = payment.booking;
  const bookingOpen =
    booking.status !== BookingStatus.CANCELLED &&
    booking.status !== BookingStatus.ATTENDED;

  if (bookingOpen) {
    await cancelBookingAsAdmin(booking.id, reason ?? "Refund");
  } else {
    await issueProviderRefund(payment);
    await markPaymentOnCancel(payment.id, "REFUNDED");
  }

  return prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      booking: {
        include: {
          table: { include: { venue: true } },
          user: {
            select: { id: true, fullName: true, phone: true, email: true },
          },
        },
      },
    },
  });
}

export async function checkInByCode(input: {
  venueId: string;
  checkInCode: string;
}): Promise<{ alreadyCheckedIn: boolean; booking: unknown }> {
  const code = input.checkInCode.trim().toUpperCase();
  const booking = await prisma.booking.findUnique({
    where: { checkInCode: code },
    include: {
      table: { include: { venue: true } },
      user: {
        select: { id: true, firstName: true, fullName: true, phone: true },
      },
      payment: true,
    },
  });

  if (!booking) throw new AppError("Invalid check-in code", 404);
  if (booking.table.venueId !== input.venueId) {
    throw new AppError("Booking is not for this venue", 403);
  }
  if (booking.status === BookingStatus.CANCELLED) {
    throw new AppError("Booking was cancelled");
  }
  if (
    booking.status !== BookingStatus.CONFIRMED &&
    booking.status !== BookingStatus.ATTENDED
  ) {
    throw new AppError("Booking is not paid / confirmed");
  }
  if (booking.status === BookingStatus.ATTENDED && booking.checkedInAt) {
    return { alreadyCheckedIn: true, booking };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.ATTENDED,
        checkedInAt: new Date(),
      },
      include: {
        table: { include: { venue: true } },
        user: {
          select: { id: true, firstName: true, fullName: true, phone: true },
        },
        payment: true,
      },
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
        attended: true,
        attendedAt: new Date(),
      },
      update: {
        attended: true,
        attendedAt: new Date(),
      },
    });

    return next;
  });

  return { alreadyCheckedIn: false, booking: updated };
}
