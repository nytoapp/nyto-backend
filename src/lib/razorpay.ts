import crypto from "crypto";
import Razorpay from "razorpay";
import { env } from "../config/env";

export function isRazorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export function paymentMode(): "razorpay" | "stub" {
  return isRazorpayConfigured() ? "razorpay" : "stub";
}

let client: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  if (!isRazorpayConfigured()) {
    throw new Error("Razorpay is not configured");
  }
  if (!client) {
    client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID!,
      key_secret: env.RAZORPAY_KEY_SECRET!,
    });
  }
  return client;
}

/** Amount in INR rupees → paise for Razorpay. */
export function inrToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export async function createRazorpayOrder(opts: {
  amountInr: number;
  receipt: string;
  notes?: Record<string, string>;
}) {
  const rz = getRazorpay();
  const order = await rz.orders.create({
    amount: inrToPaise(opts.amountInr),
    currency: "INR",
    receipt: opts.receipt.slice(0, 40),
    notes: opts.notes,
  });
  return order;
}

/**
 * Razorpay checkout success payload signature:
 * HMAC_SHA256(orderId + "|" + paymentId, key_secret)
 */
export function verifyRazorpayPaymentSignature(opts: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const body = `${opts.orderId}|${opts.paymentId}`;
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(opts.signature, "utf8"),
    );
  } catch {
    return false;
  }
}
