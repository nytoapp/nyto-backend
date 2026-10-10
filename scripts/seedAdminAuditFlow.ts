/**
 * Seeds a guest booking + captured payment so admin Overview/Payments
 * reflect a real book → pay path. Safe to re-run.
 *
 * Usage: npx tsx scripts/seedAdminAuditFlow.ts
 */
import {
  AuthProvider,
  BookingStatus,
  BookingType,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  TableStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { captureBookingPayment } from "../src/lib/captureBookingPayment";

async function main() {
  const phone = "+916302008513";
  const user = await prisma.user.upsert({
    where: { phone },
    create: {
      phone,
      authProvider: AuthProvider.PHONE,
      role: UserRole.USER,
      firstName: "Sai",
      fullName: "Sai Reddy",
      gender: "male",
    },
    update: {
      firstName: "Sai",
      fullName: "Sai Reddy",
      gender: "male",
    },
  });

  const table = await prisma.supperTable.findFirst({
    where: {
      status: { in: [TableStatus.OPEN, TableStatus.MATCHING] },
      startsAt: { gt: new Date() },
      venue: { isActive: true },
    },
    include: { venue: true },
    orderBy: { startsAt: "asc" },
  });

  if (!table) {
    throw new Error("No upcoming open table found. Create a session in admin first.");
  }

  // Clear stale pending holds for this user on this table so re-runs work.
  await prisma.booking.deleteMany({
    where: {
      userId: user.id,
      tableId: table.id,
      status: BookingStatus.PENDING_PAYMENT,
    },
  });

  const pending = await prisma.booking.create({
    data: {
      userId: user.id,
      tableId: table.id,
      bookingType: BookingType.SOLO,
      seatsBooked: 1,
      status: BookingStatus.PENDING_PAYMENT,
    },
  });

  const captured = await captureBookingPayment({
    bookingId: pending.id,
    userId: user.id,
    provider: PaymentProvider.STUB,
    providerRef: `audit_capture_${Date.now()}`,
    method: PaymentMethod.UPI,
  });

  // Also leave one pending booking (no payment row) for ops attention.
  const openTable = await prisma.supperTable.findFirst({
    where: {
      id: { not: table.id },
      status: TableStatus.OPEN,
      startsAt: { gt: new Date() },
      venue: { isActive: true },
    },
    orderBy: { startsAt: "asc" },
  });

  let pendingOnlyId: string | null = null;
  if (openTable) {
    const hold = await prisma.booking.create({
      data: {
        userId: user.id,
        tableId: openTable.id,
        bookingType: BookingType.SOLO,
        seatsBooked: 1,
        status: BookingStatus.PENDING_PAYMENT,
      },
    });
    pendingOnlyId = hold.id;
  }

  const payments = await prisma.payment.count({
    where: { status: PaymentStatus.CAPTURED },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        guest: user.fullName,
        venue: table.venue.name,
        capturedBookingId: captured.booking.id,
        checkInCode: captured.checkInCode,
        pendingBookingId: pendingOnlyId,
        capturedPaymentsInDb: payments,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
