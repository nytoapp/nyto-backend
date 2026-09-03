import { Router } from "express";
import {
  BookingStatus,
  BookingType,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  TableStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  PENDING_PAYMENT_TTL_MS,
  isHoldingStatus,
  seatsHoldingCapacity,
} from "../lib/bookingSeats";
import { generateCheckInCode } from "../lib/checkInCode";
import { cancelBookingAsUser } from "../lib/bookingLifecycle";
import { moneyFor } from "../lib/pricing";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";
import {
  assertBookingAllowed,
  classifyGender,
} from "../lib/tableBookingRules";

export const bookingsRouter = Router();

const createSchema = z.object({
  tableId: z.string().min(1),
  bookingType: z.enum(["SOLO", "GROUP", "COUPLE"]),
  seatsBooked: z.number().int().min(1).max(3),
});

const paySchema = z.object({
  method: z.enum(["UPI", "CARD"]),
});

bookingsRouter.use(requireAuth);

bookingsRouter.get("/me", async (req: AuthedRequest, res, next) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { userId: req.userId },
      include: {
        table: { include: { venue: true } },
        payment: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, bookings });
  } catch (err) {
    next(err);
  }
});

bookingsRouter.post(
  "/",
  validateBody(createSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof createSchema>;

      const table = await prisma.supperTable.findUnique({
        where: { id: body.tableId },
        include: {
          bookings: {
            select: {
              seatsBooked: true,
              status: true,
              createdAt: true,
              bookingType: true,
              user: { select: { gender: true } },
            },
          },
        },
      });
      if (!table) throw new AppError("Table not found", 404);
      if (
        table.status !== TableStatus.OPEN &&
        table.status !== TableStatus.MATCHING
      ) {
        throw new AppError("This table is not open for booking");
      }
      if (table.startsAt <= new Date()) {
        throw new AppError("This table has already started");
      }
      if (new Date() < table.bookingOpensAt) {
        throw new AppError(
          `Booking opens ${table.bookingOpensAt.toISOString()}`,
          403,
        );
      }

      const seatsTaken = seatsHoldingCapacity(table.bookings);
      const seatsLeft = Math.max(table.capacity - seatsTaken, 0);
      let womenHolding = 0;
      let menHolding = 0;
      for (const b of table.bookings) {
        if (!isHoldingStatus(b.status)) continue;
        const bucket = classifyGender(b.user.gender);
        if (bucket === "WOMAN") womenHolding += b.seatsBooked;
        if (bucket === "MAN") menHolding += b.seatsBooked;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.userId! },
        select: { gender: true },
      });

      try {
        assertBookingAllowed({
          tableType: table.tableType,
          bookingType: body.bookingType,
          seatsBooked: body.seatsBooked,
          seatsLeft,
          userGender: user?.gender,
          womenHolding,
          menHolding,
        });
      } catch (err) {
        throw new AppError(
          err instanceof Error ? err.message : "Booking not allowed",
          400,
        );
      }

      const money = moneyFor(table.seatPrice, body.seatsBooked);

      const booking = await prisma.booking.create({
        data: {
          userId: req.userId!,
          tableId: table.id,
          bookingType: body.bookingType as BookingType,
          seatsBooked: body.seatsBooked,
          status: BookingStatus.PENDING_PAYMENT,
        },
        include: {
          table: { include: { venue: true } },
        },
      });

      res.status(201).json({
        ok: true,
        booking,
        pricing: {
          seatPrice: table.seatPrice,
          seatsBooked: body.seatsBooked,
          ...money,
        },
        holdExpiresInMs: PENDING_PAYMENT_TTL_MS,
      });
    } catch (err) {
      next(err);
    }
  },
);

bookingsRouter.post(
  "/:id/pay",
  validateBody(paySchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const booking = await prisma.booking.findUnique({
        where: { id },
        include: { table: true, payment: true },
      });
      if (!booking) throw new AppError("Booking not found", 404);
      if (booking.userId !== req.userId) {
        throw new AppError("Forbidden", 403);
      }
      if (booking.status !== BookingStatus.PENDING_PAYMENT) {
        throw new AppError("Booking is not awaiting payment");
      }
      if (
        Date.now() - booking.createdAt.getTime() >
        PENDING_PAYMENT_TTL_MS
      ) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: "Payment hold expired",
          },
        });
        throw new AppError("Payment hold expired — create a new booking", 409);
      }

      const money = moneyFor(booking.table.seatPrice, booking.seatsBooked);
      const method = (req.body as z.infer<typeof paySchema>).method;
      const providerRef = `nyto_stub_${method.toLowerCase()}_${Date.now()}`;

      const updated = await prisma.$transaction(async (tx) => {
        // Re-check capacity under lock of this transaction's read.
        const peers = await tx.booking.findMany({
          where: {
            tableId: booking.tableId,
            id: { not: booking.id },
          },
          select: { seatsBooked: true, status: true, createdAt: true },
        });
        const taken = seatsHoldingCapacity(peers);
        if (taken + booking.seatsBooked > booking.table.capacity) {
          throw new AppError("Not enough seats left on this table", 409);
        }

        let checkInCode = generateCheckInCode();
        for (let attempt = 0; attempt < 5; attempt++) {
          const clash = await tx.booking.findUnique({
            where: { checkInCode },
            select: { id: true },
          });
          if (!clash) break;
          checkInCode = generateCheckInCode();
        }

        const paid = await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CONFIRMED,
            amountPaid: money.total,
            paidAt: new Date(),
            paymentRef: providerRef,
            checkInCode,
          },
          include: {
            table: { include: { venue: true, menu: true } },
            payment: true,
          },
        });

        await tx.payment.upsert({
          where: { bookingId: booking.id },
          create: {
            bookingId: booking.id,
            amount: money.total,
            currency: "INR",
            status: PaymentStatus.CAPTURED,
            method: method as PaymentMethod,
            provider: PaymentProvider.STUB,
            providerRef,
            capturedAt: new Date(),
          },
          update: {
            amount: money.total,
            status: PaymentStatus.CAPTURED,
            method: method as PaymentMethod,
            provider: PaymentProvider.STUB,
            providerRef,
            capturedAt: new Date(),
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
            oneLineDescription: null,
          },
          update: {},
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
        if (confirmedTaken >= booking.table.capacity) {
          await tx.supperTable.update({
            where: { id: booking.tableId },
            data: { status: TableStatus.MATCHING },
          });
        }

        return tx.booking.findUniqueOrThrow({
          where: { id: paid.id },
          include: {
            table: { include: { venue: true, menu: true } },
            payment: true,
          },
        });
      });

      res.json({
        ok: true,
        booking: updated,
        pricing: money,
        paymentRef: providerRef,
        checkInCode: updated.checkInCode,
      });
    } catch (err) {
      next(err);
    }
  },
);

bookingsRouter.post("/:id/cancel", async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const booking = await cancelBookingAsUser(id, req.userId!);
    res.json({ ok: true, booking });
  } catch (err) {
    next(err);
  }
});

bookingsRouter.get("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        table: { include: { venue: true, menu: true } },
        payment: true,
      },
    });
    if (!booking) throw new AppError("Booking not found", 404);
    if (booking.userId !== req.userId) throw new AppError("Forbidden", 403);

    const money = moneyFor(booking.table.seatPrice, booking.seatsBooked);
    res.json({
      ok: true,
      booking,
      pricing: money,
      /** Door proof — only returned to the booking owner. */
      checkInCode: booking.checkInCode,
    });
  } catch (err) {
    next(err);
  }
});
