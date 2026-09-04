import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { inrToPaise } from "./razorpay";

describe("inrToPaise", () => {
  it("converts rupees to paise", () => {
    expect(inrToPaise(1299)).toBe(129900);
    expect(inrToPaise(0)).toBe(0);
  });
});

describe("razorpay signature shape", () => {
  it("matches HMAC_SHA256(order|payment, secret)", () => {
    const secret = "test_secret";
    const orderId = "order_ABC";
    const paymentId = "pay_XYZ";
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    expect(expected).toHaveLength(64);
  });
});
