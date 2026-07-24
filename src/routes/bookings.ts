import { Router } from "express";
import {
  BookingStatus,
  BookingType,
  TableStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";

export const bookingsRouter = Router();

const GST_RATE = 0.05;

const createSchema = z.object({
  tableId: z.string().min(1),
  bookingType: z.enum(["SOLO", "GROUP"]),
  seatsBooked: z.number().int().min(1).max(3),
});

const paySchema = z.object({
  method: z.enum(["UPI", "CARD"]),
});

function moneyFor(seatPrice: number, seats: number) {
  const seatSubtotal = seatPrice * seats;
  const gst = Math.round(seatSubtotal * GST_RATE);
  return {
    seatSubtotal,
    gst,
    total: seatSubtotal + gst,
  };
}

bookingsRouter.use(requireAuth);

bookingsRouter.get("/me", async (req: AuthedRequest, res, next) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { userId: req.userId },
      include: {
        table: { include: { venue: true } },
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

      if (body.bookingType === "SOLO" && body.seatsBooked !== 1) {
        throw new AppError("Solo booking must be 1 seat");
      }
      if (body.bookingType === "GROUP" && (body.seatsBooked < 2 || body.seatsBooked > 3)) {
        throw new AppError("Group booking must be 2 or 3 seats");
      }

      const table = await prisma.supperTable.findUnique({
        where: { id: body.tableId },
        include: {
          bookings: { select: { seatsBooked: true, status: true } },
        },
      });
      if (!table) throw new AppError("Table not found", 404);
      if (
        table.status !== TableStatus.OPEN &&
        table.status !== TableStatus.MATCHING
      ) {
        throw new AppError("This table is not open for booking");
      }

      const seatsTaken = table.bookings
        .filter((b) =>
          b.status === BookingStatus.CONFIRMED ||
          b.status === BookingStatus.ATTENDED ||
          b.status === BookingStatus.PENDING_PAYMENT
        )
        .reduce((sum, b) => sum + b.seatsBooked, 0);

      if (seatsTaken + body.seatsBooked > table.capacity) {
        throw new AppError("Not enough seats left on this table");
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
        include: { table: true },
      });
      if (!booking) throw new AppError("Booking not found", 404);
      if (booking.userId !== req.userId) {
        throw new AppError("Forbidden", 403);
      }
      if (booking.status !== BookingStatus.PENDING_PAYMENT) {
        throw new AppError("Booking is not awaiting payment");
      }

      const money = moneyFor(booking.table.seatPrice, booking.seatsBooked);
      const method = (req.body as z.infer<typeof paySchema>).method;
      const paymentRef = `nyto_${method.toLowerCase()}_${Date.now()}`;

      const updated = await prisma.$transaction(async (tx) => {
        const paid = await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CONFIRMED,
            amountPaid: money.total,
            paidAt: new Date(),
            paymentRef,
          },
          include: {
            table: { include: { venue: true, menu: true } },
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

        const taken = confirmedSeats._sum.seatsBooked ?? 0;
        if (taken >= booking.table.capacity) {
          await tx.supperTable.update({
            where: { id: booking.tableId },
            data: { status: TableStatus.MATCHING },
          });
        }

        return paid;
      });

      res.json({
        ok: true,
        booking: updated,
        pricing: money,
        paymentRef,
      });
    } catch (err) {
      next(err);
    }
  },
);

bookingsRouter.get("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { table: { include: { venue: true, menu: true } } },
    });
    if (!booking) throw new AppError("Booking not found", 404);
    if (booking.userId !== req.userId) throw new AppError("Forbidden", 403);

    const money = moneyFor(booking.table.seatPrice, booking.seatsBooked);
    res.json({ ok: true, booking, pricing: money });
  } catch (err) {
    next(err);
  }
});
