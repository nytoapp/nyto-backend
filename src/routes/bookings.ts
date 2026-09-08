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
import { cancelBookingAsUser } from "../lib/bookingLifecycle";
import { captureBookingPayment } from "../lib/captureBookingPayment";
import { moneyFor } from "../lib/pricing";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  paymentMode,
  verifyRazorpayPaymentSignature,
} from "../lib/razorpay";
import { env } from "../config/env";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";
import {
  assertBookingAllowed,
  classifyGender,
} from "../lib/tableBookingRules";
import { assertSeatingMatch } from "../lib/matching";

export const bookingsRouter = Router();

const createSchema = z.object({
  tableId: z.string().min(1),
  bookingType: z.enum(["SOLO", "GROUP", "COUPLE"]),
  seatsBooked: z.number().int().min(1).max(3),
});

const paySchema = z.object({
  method: z.enum(["UPI", "CARD"]),
});

const razorpayConfirmSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

bookingsRouter.use(requireAuth);

async function assertPayableBooking(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { table: true, payment: true },
  });
  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.userId !== userId) throw new AppError("Forbidden", 403);
  if (booking.status !== BookingStatus.PENDING_PAYMENT) {
    throw new AppError("Booking is not awaiting payment");
  }
  if (Date.now() - booking.createdAt.getTime() > PENDING_PAYMENT_TTL_MS) {
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
  return booking;
}

bookingsRouter.get("/payment-config", async (_req, res) => {
  const mode = paymentMode();
  res.json({
    ok: true,
    mode,
    keyId: mode === "razorpay" ? env.RAZORPAY_KEY_ID : null,
  });
});

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
              user: {
                select: {
                  gender: true,
                  dateOfBirth: true,
                  interests: true,
                  socialEnergy: true,
                  conversationStyle: true,
                },
              },
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
        select: {
          gender: true,
          dateOfBirth: true,
          interests: true,
          socialEnergy: true,
          conversationStyle: true,
        },
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
        assertSeatingMatch({
          tableType: table.tableType,
          me: {
            dateOfBirth: user?.dateOfBirth,
            interests: user?.interests,
            socialEnergy: user?.socialEnergy,
            conversationStyle: user?.conversationStyle,
          },
          peers: table.bookings
            .filter((b) => isHoldingStatus(b.status))
            .map((b) => ({
              dateOfBirth: b.user.dateOfBirth,
              interests: b.user.interests,
              socialEnergy: b.user.socialEnergy,
              conversationStyle: b.user.conversationStyle,
            })),
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

/** Create Razorpay order for checkout (Test or Live keys). */
bookingsRouter.post(
  "/:id/razorpay/order",
  async (req: AuthedRequest, res, next) => {
    try {
      if (!isRazorpayConfigured()) {
        throw new AppError(
          "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
          503,
        );
      }

      const id = String(req.params.id);
      const booking = await assertPayableBooking(id, req.userId!);
      const money = moneyFor(booking.table.seatPrice, booking.seatsBooked);

      const order = await createRazorpayOrder({
        amountInr: money.total,
        receipt: booking.id,
        notes: {
          bookingId: booking.id,
          userId: booking.userId,
          tableId: booking.tableId,
        },
      });

      await prisma.payment.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          amount: money.total,
          currency: "INR",
          status: PaymentStatus.PENDING,
          method: PaymentMethod.UNKNOWN,
          provider: PaymentProvider.RAZORPAY,
          providerRef: order.id,
        },
        update: {
          amount: money.total,
          status: PaymentStatus.PENDING,
          provider: PaymentProvider.RAZORPAY,
          providerRef: order.id,
          capturedAt: null,
        },
      });

      res.json({
        ok: true,
        mode: "razorpay",
        keyId: env.RAZORPAY_KEY_ID,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        bookingId: booking.id,
        pricing: money,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** Verify Razorpay checkout success — never trust the client alone. */
bookingsRouter.post(
  "/:id/razorpay/confirm",
  validateBody(razorpayConfirmSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      if (!isRazorpayConfigured()) {
        throw new AppError("Razorpay is not configured", 503);
      }

      const id = String(req.params.id);
      const body = req.body as z.infer<typeof razorpayConfirmSchema>;

      const booking = await prisma.booking.findUnique({
        where: { id },
        include: { payment: true },
      });
      if (!booking) throw new AppError("Booking not found", 404);
      if (booking.userId !== req.userId) throw new AppError("Forbidden", 403);

      if (
        booking.payment?.providerRef &&
        booking.payment.providerRef !== body.razorpay_order_id &&
        booking.status === BookingStatus.PENDING_PAYMENT
      ) {
        throw new AppError("Order mismatch — create a new payment order", 409);
      }

      const valid = verifyRazorpayPaymentSignature({
        orderId: body.razorpay_order_id,
        paymentId: body.razorpay_payment_id,
        signature: body.razorpay_signature,
      });
      if (!valid) throw new AppError("Invalid payment signature", 400);

      const captured = await captureBookingPayment({
        bookingId: id,
        userId: req.userId!,
        provider: PaymentProvider.RAZORPAY,
        providerRef: body.razorpay_payment_id,
        method: PaymentMethod.UNKNOWN,
      });

      res.json({
        ok: true,
        booking: captured.booking,
        pricing: captured.pricing,
        checkInCode: captured.checkInCode,
        paymentRef: body.razorpay_payment_id,
        alreadyCaptured: captured.alreadyCaptured,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Dev stub payment — only when Razorpay keys are missing.
 * Never available once Razorpay is configured.
 */
bookingsRouter.post(
  "/:id/pay",
  validateBody(paySchema),
  async (req: AuthedRequest, res, next) => {
    try {
      if (isRazorpayConfigured()) {
        throw new AppError(
          "Use Razorpay checkout (/razorpay/order + /razorpay/confirm)",
          400,
        );
      }

      const id = String(req.params.id);
      await assertPayableBooking(id, req.userId!);

      const method = (req.body as z.infer<typeof paySchema>).method;
      const providerRef = `nyto_stub_${method.toLowerCase()}_${Date.now()}`;

      const captured = await captureBookingPayment({
        bookingId: id,
        userId: req.userId!,
        provider: PaymentProvider.STUB,
        providerRef,
        method: method as PaymentMethod,
      });

      res.json({
        ok: true,
        mode: "stub",
        booking: captured.booking,
        pricing: captured.pricing,
        paymentRef: providerRef,
        checkInCode: captured.checkInCode,
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
