import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(1).default("dev-secret-change-me"),
  CORS_ORIGIN: z.string().default("*"),
});

export const env = envSchema.parse(process.env);
