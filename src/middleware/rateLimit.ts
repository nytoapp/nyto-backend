import rateLimit, { type Options } from "express-rate-limit";
import { env } from "../config/env";

/**
 * Per-IP guards in front of the per-destination limits enforced by the OTP
 * service. These stop scripted abuse before it reaches the database.
 */
const shared: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Skip in tests so suites are not throttled by earlier cases.
  skip: () => env.NODE_ENV === "test",
  message: { error: "Too many requests. Try again shortly." },
};

/** Requesting a code costs money — keep this tight in production. */
export const otpRequestLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  // Dev: don't block clone/onboarding testing. Prod: 10 / 15 min per IP.
  limit: env.NODE_ENV === "production" ? 10 : 200,
});

/** Verification is cheap but brute-forceable. */
export const otpVerifyLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 30,
});

/** Social sign-in and refresh: generous, but not unbounded. */
export const authProviderLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 60,
});
