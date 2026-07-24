import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { issueOtp, normalizePhone, verifyOtp } from "../lib/otp";
import { requireAuth, signToken, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";

export const authRouter = Router();

const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  phone: z.string().min(10, "Phone number is required"),
});

const otpRequestSchema = z.object({
  phone: z.string().min(10, "Phone number is required"),
});

const otpVerifySchema = z.object({
  phone: z.string().min(10, "Phone number is required"),
  code: z.string().min(4, "OTP code is required"),
});

function parseDob(value: string): Date {
  // Accept ISO or dd-mm-yyyy
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return new Date(iso);

  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) throw new AppError("dateOfBirth must be ISO or dd-mm-yyyy");

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AppError("Invalid date of birth");
  }
  return date;
}

function ageFromDob(dob: Date): number {
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

function publicUser(user: {
  id: string;
  phone: string | null;
  email: string | null;
  fullName: string;
  dateOfBirth: Date;
  verificationStatus: string;
  attendanceCount: number;
  currentStreak: number;
  authProvider: string;
}) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    fullName: user.fullName,
    dateOfBirth: user.dateOfBirth.toISOString().slice(0, 10),
    verificationStatus: user.verificationStatus,
    attendanceCount: user.attendanceCount,
    currentStreak: user.currentStreak,
    authProvider: user.authProvider,
  };
}

authRouter.post(
  "/register",
  validateBody(registerSchema),
  async (req, res, next) => {
    try {
      const { fullName, dateOfBirth, phone } = req.body as z.infer<
        typeof registerSchema
      >;
      const dob = parseDob(dateOfBirth);
      if (ageFromDob(dob) < 18) {
        throw new AppError("You must be 18 or older");
      }

      const normalized = normalizePhone(phone);
      const existing = await prisma.user.findUnique({
        where: { phone: normalized },
      });

      let user;
      if (existing) {
        user = await prisma.user.update({
          where: { id: existing.id },
          data: {
            fullName,
            dateOfBirth: dob,
            isAgeVerified: true,
            authProvider: "PHONE",
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            fullName,
            dateOfBirth: dob,
            phone: normalized,
            authProvider: "PHONE",
            isAgeVerified: true,
          },
        });
      }

      const code = issueOtp(normalized);
      console.log(`[otp] ${normalized} → ${code}`);

      res.status(201).json({
        ok: true,
        user: publicUser(user),
        otpSent: true,
        // Dev convenience only — never expose in production responses.
        ...(process.env.NODE_ENV !== "production" ? { devOtp: code } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/otp/request",
  validateBody(otpRequestSchema),
  async (req, res, next) => {
    try {
      const { phone } = req.body as z.infer<typeof otpRequestSchema>;
      const normalized = normalizePhone(phone);
      const user = await prisma.user.findUnique({ where: { phone: normalized } });
      if (!user) throw new AppError("No account for this phone. Register first.", 404);

      const code = issueOtp(normalized);
      console.log(`[otp] ${normalized} → ${code}`);

      res.json({
        ok: true,
        otpSent: true,
        ...(process.env.NODE_ENV !== "production" ? { devOtp: code } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/otp/verify",
  validateBody(otpVerifySchema),
  async (req, res, next) => {
    try {
      const { phone, code } = req.body as z.infer<typeof otpVerifySchema>;
      const normalized = normalizePhone(phone);

      if (!verifyOtp(normalized, code)) {
        throw new AppError("Invalid or expired OTP", 401);
      }

      const user = await prisma.user.findUnique({ where: { phone: normalized } });
      if (!user) throw new AppError("User not found", 404);

      const token = signToken(user.id);
      res.json({ ok: true, token, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new AppError("User not found", 404);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});
