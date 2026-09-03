import {
  BookingStatus,
  PaymentStatus,
  TableStatus,
} from "@prisma/client";
import { prisma } from "./prisma";
import { AppError } from "../middleware/errorHandler";
import { seatsHoldingCapacity } from "./bookingSeats";

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

  return prisma.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: "Cancelled by guest",
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
    }

    await tx.tableMember.deleteMany({
      where: { tableId: booking.tableId, userId: booking.userId },
    });

    return updated;
  }).then(async (updated) => {
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

  return prisma.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason?.trim() || "Cancelled by admin",
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
    }

    await tx.tableMember.deleteMany({
      where: { tableId: booking.tableId, userId: booking.userId },
    });

    return updated;
  }).then(async (updated) => {
    await refreshTableOpenStatus(booking.tableId);
    return updated;
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
