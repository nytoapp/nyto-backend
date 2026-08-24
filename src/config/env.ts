import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(1).default("dev-secret-change-me"),
  CORS_ORIGIN: z.string().default("*"),
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : undefined)),
  RESEND_FROM_EMAIL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : undefined))
    .pipe(z.string().email().optional()),
  // Google Sign-In: Web OAuth client ID(s), comma-separated.
  GOOGLE_CLIENT_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  /** Hours after table starts that the dinner is considered "in progress". */
  TABLE_EVENT_DURATION_HOURS: z.coerce.number().min(1).default(4),
  /** Hours after the event ends before table group chat becomes read-only. */
  TABLE_CHAT_GRACE_PERIOD_HOURS: z.coerce.number().min(0).default(72),
});

export const env = envSchema.parse(process.env);
