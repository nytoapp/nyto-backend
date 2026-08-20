import { Router } from "express";
import { AuthProvider } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  generateOtpCode,
  issueOtp,
  normalizeEmail,
  normalizePhone,
  storeOtp,
  verifyOtp,
} from "../lib/otp";
import { env } from "../config/env";
import { sendEmailOtp } from "../lib/email";
import { verifyGoogleIdToken } from "../lib/google";
import { requireAuth, signToken, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";

export const authRouter = Router();

const emailSchema = z.string().trim().toLowerCase().email("Valid email required");

const emailOtpRequestSchema = z.object({
  email: emailSchema,
});

const emailOtpVerifySchema = z.object({
  email: emailSchema,
  code: z.string().min(4, "OTP code is required"),
});

const googleAuthSchema = z.object({
  idToken: z.string().min(20, "Google ID token is required"),
});

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

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(40).optional(),
  phone: z.string().min(8).max(20).optional(),
  gender: z.enum(["man", "woman", "nonbinary", "skip"]).optional(),
  dateOfBirth: z.string().min(1).optional(),
  interests: z.array(z.string().trim().min(1)).max(20).optional(),
});

function parseDob(value: string): Date {
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

function otpDevPayload(code: string) {
  const showDevOtp = process.env.NODE_ENV !== "production" && !env.RESEND_API_KEY;
  return showDevOtp ? { devOtp: code } : {};
}

function publicUser(user: {
  id: string;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  fullName: string;
  dateOfBirth: Date | null;
  gender: string | null;
  interests: string[];
  verificationStatus: string;
  attendanceCount: number;
  currentStreak: number;
  authProvider: string;
  isAgeVerified: boolean;
}) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    firstName: user.firstName,
    fullName: user.fullName,
    dateOfBirth: user.dateOfBirth
      ? user.dateOfBirth.toISOString().slice(0, 10)
      : null,
    gender: user.gender,
    interests: user.interests,
    verificationStatus: user.verificationStatus,
    isAgeVerified: user.isAgeVerified,
    attendanceCount: user.attendanceCount,
    currentStreak: user.currentStreak,
    authProvider: user.authProvider,
  };
}

async function findOrCreateEmailUser(email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  const hint = email.split("@")[0] ?? "Guest";
  return prisma.user.create({
    data: {
      email,
      authProvider: AuthProvider.EMAIL,
      firstName: hint,
      fullName: hint,
    },
  });
}

async function findOrCreateGoogleUser(input: {
  googleId: string;
  email: string | null;
  name: string;
  givenName: string;
}) {
  const byGoogle = await prisma.user.findUnique({
    where: { googleId: input.googleId },
  });
  if (byGoogle) return byGoogle;

  if (input.email) {
    const byEmail = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (byEmail) {
      return prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: input.googleId,
          firstName: byEmail.firstName || input.givenName,
          fullName: byEmail.fullName || input.name,
        },
      });
    }
  }

  return prisma.user.create({
    data: {
      googleId: input.googleId,
      email: input.email,
      authProvider: AuthProvider.GOOGLE,
      firstName: input.givenName,
      fullName: input.name,
    },
  });
}

// ── Email OTP (primary app path) ──────────────────────────────────────────

authRouter.post(
  "/email/otp/request",
  validateBody(emailOtpRequestSchema),
  async (req, res, next) => {
    try {
      const { email } = req.body as z.infer<typeof emailOtpRequestSchema>;
      const normalized = normalizeEmail(email);
      const key = `email:${normalized}`;
      const code = env.RESEND_API_KEY ? generateOtpCode() : issueOtp(key);
      if (env.RESEND_API_KEY) {
        storeOtp(key, code);
      }
      console.log(`[otp] ${normalized} → ${code}`);

      await sendEmailOtp(normalized, code);

      res.json({
        ok: true,
        otpSent: true,
        email: normalized,
        ...otpDevPayload(code),
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/email/otp/verify",
  validateBody(emailOtpVerifySchema),
  async (req, res, next) => {
    try {
      const { email, code } = req.body as z.infer<typeof emailOtpVerifySchema>;
      const normalized = normalizeEmail(email);

      if (!verifyOtp(`email:${normalized}`, code)) {
        throw new AppError("Invalid or expired OTP", 401);
      }

      const user = await findOrCreateEmailUser(normalized);
      const token = signToken(user.id);
      res.json({ ok: true, token, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/google",
  validateBody(googleAuthSchema),
  async (req, res, next) => {
    try {
      const { idToken } = req.body as z.infer<typeof googleAuthSchema>;
      const google = await verifyGoogleIdToken(idToken);
      const user = await findOrCreateGoogleUser(google);
      const token = signToken(user.id);
      res.json({ ok: true, token, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.patch(
  "/me",
  requireAuth,
  validateBody(profileSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof profileSchema>;
      const data: {
        firstName?: string;
        fullName?: string;
        phone?: string;
        gender?: string;
        dateOfBirth?: Date;
        isAgeVerified?: boolean;
        interests?: string[];
      } = {};

      if (body.firstName) {
        data.firstName = body.firstName;
        data.fullName = body.firstName;
      }
      if (body.phone) data.phone = normalizePhone(body.phone);
      if (body.gender) data.gender = body.gender;
      if (body.interests) data.interests = body.interests;
      if (body.dateOfBirth) {
        const dob = parseDob(body.dateOfBirth);
        if (ageFromDob(dob) < 18) {
          throw new AppError("You must be 18 or older");
        }
        data.dateOfBirth = dob;
        data.isAgeVerified = true;
      }

      if (body.phone) {
        const taken = await prisma.user.findFirst({
          where: { phone: data.phone, NOT: { id: req.userId } },
        });
        if (taken) throw new AppError("Phone already in use", 409);
      }

      const user = await prisma.user.update({
        where: { id: req.userId },
        data,
      });
      res.json({ ok: true, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

// ── Phone OTP (legacy — kept until SMS is dropped) ────────────────────────

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
            firstName: fullName.split(" ")[0],
            dateOfBirth: dob,
            isAgeVerified: true,
            authProvider: AuthProvider.PHONE,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            fullName,
            firstName: fullName.split(" ")[0],
            dateOfBirth: dob,
            phone: normalized,
            authProvider: AuthProvider.PHONE,
            isAgeVerified: true,
          },
        });
      }

      const code = issueOtp(`phone:${normalized}`);
      console.log(`[otp] ${normalized} → ${code}`);

      res.status(201).json({
        ok: true,
        user: publicUser(user),
        otpSent: true,
        ...otpDevPayload(code),
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

      const code = issueOtp(`phone:${normalized}`);
      console.log(`[otp] ${normalized} → ${code}`);

      res.json({
        ok: true,
        otpSent: true,
        ...otpDevPayload(code),
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

      if (!verifyOtp(`phone:${normalized}`, code)) {
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

authRouter.delete("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) throw new AppError("Unauthorized", 401);

    await prisma.$transaction(async (tx) => {
      await tx.connectionSignal.deleteMany({
        where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
      });
      await tx.chatMessage.deleteMany({ where: { senderId: userId } });
      await tx.tableMember.deleteMany({ where: { userId } });
      await tx.bookingGroupMember.deleteMany({ where: { userId } });
      await tx.booking.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});
