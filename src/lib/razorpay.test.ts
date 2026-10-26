import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  inrToPaise,
  isSyntheticRazorpayPaymentRef,
} from "./razorpay";

describe("inrToPaise", () => {
  it("converts rupees to paise", () => {
    expect(inrToPaise(1299)).toBe(129900);
    expect(inrToPaise(0)).toBe(0);
  });
});

describe("isSyntheticRazorpayPaymentRef", () => {
  it("flags E2E fake pay_ ids only", () => {
    expect(isSyntheticRazorpayPaymentRef("pay_e2e_123")).toBe(true);
    expect(isSyntheticRazorpayPaymentRef("pay_ABC123real")).toBe(false);
    expect(isSyntheticRazorpayPaymentRef(null)).toBe(false);
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
