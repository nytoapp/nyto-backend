import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const csv = (fallback = "") =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() ? value.trim() : undefined));

/**
 * `+91:123456,+14155550100:654321` — destinations that skip real SMS delivery
 * and accept a fixed code. Ignored entirely when NODE_ENV=production.
 */
const testDestinations = z
  .string()
  .default("")
  .transform((value) => {
    const map = new Map<string, string>();
    for (const pair of value.split(",")) {
      const [destination, code] = pair.split(":").map((part) => part?.trim());
      if (destination && code && /^\d{4,8}$/.test(code)) {
        map.set(destination, code);
      }
    }
    return map;
  });

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  CORS_ORIGIN: z.string().default("*"),

  // ── Tokens ──────────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(1).default("dev-secret-change-me"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().min(1).max(1440).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().min(1).max(365).default(60),

  // ── OTP ─────────────────────────────────────────────────────────────────
  /** Separate from JWT_SECRET so rotating one does not invalidate the other. */
  OTP_PEPPER: z.string().min(1).default("dev-otp-pepper-change-me"),
  OTP_TTL_SECONDS: z.coerce.number().min(60).max(900).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().min(3).max(10).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().min(15).max(300).default(30),
  /** Max codes delivered to one destination per rolling hour. */
  OTP_MAX_SENDS_PER_HOUR: z.coerce.number().min(1).max(20).default(5),
  OTP_TEST_DESTINATIONS: testDestinations,

  // ── SMS transports ──────────────────────────────────────────────────────
  /** Country calling codes routed to MSG91, e.g. "91". Others go to Twilio. */
  MSG91_COUNTRY_CODES: csv("91"),
  MSG91_AUTH_KEY: optionalString,
  /** DLT-approved flow/template id. */
  MSG91_TEMPLATE_ID: optionalString,
  MSG91_SENDER_ID: optionalString,

  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  /** Either a Twilio number in E.164 or a Messaging Service SID (MG...). */
  TWILIO_FROM: optionalString,

  /**
   * Android SMS Retriever app hash appended to the SMS body so the OS can
   * hand the code straight to the app. Optional; omit to use User Consent API.
   */
  ANDROID_SMS_APP_HASH: optionalString,

  // ── Email OTP ───────────────────────────────────────────────────────────
  RESEND_API_KEY: optionalString,
  RESEND_FROM_EMAIL: optionalString.pipe(z.string().email().optional()),

  // ── Social providers ────────────────────────────────────────────────────
  /** Google OAuth client IDs (Web + Android + iOS), comma-separated. */
  GOOGLE_CLIENT_IDS: csv(""),
  /** Apple: iOS bundle ID(s) / Services ID(s), comma-separated. */
  APPLE_CLIENT_IDS: csv("com.nyto.nytoApp"),
  FACEBOOK_APP_ID: optionalString,
  FACEBOOK_APP_SECRET: optionalString,

  // ── Product config ──────────────────────────────────────────────────────
  TABLE_EVENT_DURATION_HOURS: z.coerce.number().min(1).default(4),
  TABLE_CHAT_GRACE_PERIOD_HOURS: z.coerce.number().min(0).default(72),

  // ── Payments (Razorpay) ─────────────────────────────────────────────────
  /** Test or live Key Id from Razorpay Dashboard → API Keys. */
  RAZORPAY_KEY_ID: optionalString,
  /** Never ship to the mobile app — server only. */
  RAZORPAY_KEY_SECRET: optionalString,
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === "production";

/** Test destinations are a development affordance and must never apply in production. */
export function testCodeFor(destination: string): string | undefined {
  if (isProduction) return undefined;
  return env.OTP_TEST_DESTINATIONS.get(destination);
}

if (isProduction) {
  const insecure: string[] = [];
  if (env.JWT_SECRET === "dev-secret-change-me") insecure.push("JWT_SECRET");
  if (env.OTP_PEPPER === "dev-otp-pepper-change-me") insecure.push("OTP_PEPPER");
  if (insecure.length > 0) {
    throw new Error(
      `Refusing to start in production with default secrets: ${insecure.join(", ")}`,
    );
  }
}
