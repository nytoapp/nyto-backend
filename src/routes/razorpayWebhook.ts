import { Router } from "express";
import crypto from "crypto";
import {
  BookingStatus,
  PaymentMethod,
  PaymentProvider,
} from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { captureBookingPayment } from "../lib/captureBookingPayment";
import { AppError } from "../middleware/errorHandler";

type RequestWithRawBody = { rawBody?: string };

/**
 * Razorpay webhook — reconciles `payment.captured` when the client
 * never reached /razorpay/confirm (timeouts, killed app).
 *
 * Configure webhook URL: POST /bookings/razorpay/webhook
 * Optional secret: RAZORPAY_WEBHOOK_SECRET (falls back to KEY_SECRET).
 */
export const razorpayWebhookRouter = Router();

function webhookSecret(): string | undefined {
  return (
    process.env.RAZORPAY_WEBHOOK_SECRET?.trim() ||
    env.RAZORPAY_KEY_SECRET ||
    undefined
  );
}

function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = webhookSecret();
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    return false;
  }
}

razorpayWebhookRouter.post("/", async (req, res, next) => {
  try {
    const signature = String(req.headers["x-razorpay-signature"] ?? "");
    const raw =
      (req as RequestWithRawBody).rawBody ??
      (typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {}));

    if (!signature || !verifyWebhookSignature(raw, signature)) {
      throw new AppError("Invalid webhook signature", 400);
    }

    const event =
      typeof req.body === "object" && req.body
        ? (req.body as {
            event?: string;
            payload?: {
              payment?: {
                entity?: {
                  id?: string;
                  order_id?: string;
                  method?: string;
                  status?: string;
                };
              };
            };
          })
        : {};

    if (event.event !== "payment.captured") {
      res.json({ ok: true, ignored: true, event: event.event ?? null });
      return;
    }

    const entity = event.payload?.payment?.entity;
    const paymentId = entity?.id;
    const orderId = entity?.order_id;
    if (!paymentId || !orderId) {
      throw new AppError("Malformed payment.captured payload", 400);
    }

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ providerRef: orderId }, { providerRef: paymentId }],
      },
      include: { booking: true },
    });

    if (!payment?.booking) {
      // Unknown order — acknowledge so Razorpay does not retry forever.
      res.json({ ok: true, matched: false });
      return;
    }

    if (payment.booking.status === BookingStatus.CONFIRMED) {
      res.json({ ok: true, alreadyCaptured: true });
      return;
    }

    const methodRaw = (entity.method ?? "").toLowerCase();
    const method =
      methodRaw === "upi"
        ? PaymentMethod.UPI
        : methodRaw === "card"
          ? PaymentMethod.CARD
          : PaymentMethod.UNKNOWN;

    const captured = await captureBookingPayment({
      bookingId: payment.bookingId,
      userId: payment.booking.userId,
      provider: PaymentProvider.RAZORPAY,
      providerRef: paymentId,
      method,
    });

    res.json({
      ok: true,
      matched: true,
      bookingId: payment.bookingId,
      alreadyCaptured: captured.alreadyCaptured,
    });
  } catch (err) {
    next(err);
  }
});
