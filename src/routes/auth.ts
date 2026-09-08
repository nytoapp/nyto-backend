import { Router, type Request, type Response } from "express";
import { OtpChannel } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { sendEmailOtp } from "../lib/email";
import { verifyAppleIdToken } from "../lib/apple";
import { verifyFacebookAccessToken } from "../lib/facebook";
import { verifyGoogleIdToken } from "../lib/google";
import {
  ageFromDob,
  findOrCreateAppleUser,
  findOrCreateEmailUser,
  findOrCreateFacebookUser,
  findOrCreateGoogleUser,
  findOrCreatePhoneUser,
  parseDob,
  publicUser,
} from "../lib/identity";
import { consumeOtpChallenge, issueOtpChallenge, normalizeEmail } from "../lib/otp";
import { maskEmail, maskPhone, normalizePhoneNumber } from "../lib/phone";
import { sendOtpSms } from "../lib/sms";
import {
  issueSession,
  revokeSessionByRefreshToken,
  rotateSession,
  touchSession,
} from "../lib/tokens";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  authProviderLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
} from "../middleware/rateLimit";
import { validateBody } from "../middleware/validate";

export const authRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────

const emailSchema = z.string().trim().toLowerCase().email("Valid email required");
const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, "Enter the code from your message");

const emailOtpRequestSchema = z.object({ email: emailSchema });
const emailOtpVerifySchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
});

const phoneSchema = z
  .string()
  .trim()
  .min(8, "Phone number is required")
  .max(20, "Phone number is too long");

const phoneOtpRequestSchema = z.object({ phone: phoneSchema });
const phoneOtpVerifySchema = z.object({
  phone: phoneSchema,
  code: otpCodeSchema,
});

const idTokenSchema = z.object({
  idToken: z.string().min(20, "Provider token is required"),
});
const facebookAuthSchema = z.object({
  accessToken: z.string().min(20, "Facebook access token is required"),
});
const refreshSchema = z.object({
  refreshToken: z.string().min(20, "Refresh token is required"),
});

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(40).optional(),
  phone: phoneSchema.optional(),
  gender: z.enum(["man", "woman", "nonbinary", "skip"]).optional(),
  dateOfBirth: z.string().min(1).optional(),
  socialEnergy: z.enum(["introverted", "ambiverted", "extroverted"]).optional(),
  conversationStyle: z.enum(["calm", "mixed", "lively"]).optional(),
  tableOneLiner: z.string().trim().min(2).max(80).optional(),
  datingIntent: z.enum(["women", "men", "open"]).optional(),
  interests: z.array(z.string().trim().min(1)).max(20).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────

type SessionUser = Parameters<typeof publicUser>[0];

/** Single place that turns a resolved identity into a client session. */
async function respondWithSession(
  req: Request,
  res: Response,
  user: SessionUser,
): Promise<void> {
  const tokens = await issueSession(user.id, {
    userAgent: req.headers["user-agent"],
  });
  res.json({
    ok: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.accessTokenExpiresIn,
    user: publicUser(user),
  });
}

// ── Phone OTP ─────────────────────────────────────────────────────────────

authRouter.post(
  "/phone/otp/request",
  otpRequestLimiter,
  validateBody(phoneOtpRequestSchema),
  async (req, res, next) => {
    try {
      const { phone } = req.body as z.infer<typeof phoneOtpRequestSchema>;
      const normalized = normalizePhoneNumber(phone);

      const challenge = await issueOtpChallenge(OtpChannel.SMS, normalized.e164);

      // Test destinations short-circuit delivery; real numbers always send.
      if (!challenge.isTestCode) {
        await sendOtpSms(normalized.e164, normalized.callingCode, challenge.code);
      }

      res.json({
        ok: true,
        otpSent: true,
        phone: normalized.e164,
        maskedPhone: maskPhone(normalized.e164),
        expiresAt: challenge.expiresAt.toISOString(),
        resendAfterSeconds: challenge.resendAfterSeconds,
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/phone/otp/verify",
  otpVerifyLimiter,
  validateBody(phoneOtpVerifySchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const { phone, code } = req.body as z.infer<typeof phoneOtpVerifySchema>;
      const normalized = normalizePhoneNumber(phone);

      await consumeOtpChallenge(OtpChannel.SMS, normalized.e164, code);

      const user = await findOrCreatePhoneUser(normalized.e164);
      await respondWithSession(req, res, user);
    } catch (err) {
      next(err);
    }
  },
);

// ── Email OTP ─────────────────────────────────────────────────────────────

authRouter.post(
  "/email/otp/request",
  otpRequestLimiter,
  validateBody(emailOtpRequestSchema),
  async (req, res, next) => {
    try {
      const { email } = req.body as z.infer<typeof emailOtpRequestSchema>;
      const normalized = normalizeEmail(email);

      if (!env.RESEND_API_KEY && env.NODE_ENV === "production") {
        throw new AppError("Email sign-in is not configured", 503);
      }

      const challenge = await issueOtpChallenge(OtpChannel.EMAIL, normalized);
      if (!challenge.isTestCode) {
        await sendEmailOtp(normalized, challenge.code);
      }

      res.json({
        ok: true,
        otpSent: true,
        email: normalized,
        maskedEmail: maskEmail(normalized),
        expiresAt: challenge.expiresAt.toISOString(),
        resendAfterSeconds: challenge.resendAfterSeconds,
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/email/otp/verify",
  otpVerifyLimiter,
  validateBody(emailOtpVerifySchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const { email, code } = req.body as z.infer<typeof emailOtpVerifySchema>;
      const normalized = normalizeEmail(email);

      await consumeOtpChallenge(OtpChannel.EMAIL, normalized, code);

      const user = await findOrCreateEmailUser(normalized);
      await respondWithSession(req, res, user);
    } catch (err) {
      next(err);
    }
  },
);

// ── Social providers ──────────────────────────────────────────────────────

authRouter.post(
  "/google",
  authProviderLimiter,
  validateBody(idTokenSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const { idToken } = req.body as z.infer<typeof idTokenSchema>;
      const identity = await verifyGoogleIdToken(idToken);
      const user = await findOrCreateGoogleUser(identity);
      await respondWithSession(req, res, user);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/apple",
  authProviderLimiter,
  validateBody(idTokenSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const { idToken } = req.body as z.infer<typeof idTokenSchema>;
      const identity = await verifyAppleIdToken(idToken);
      const user = await findOrCreateAppleUser(identity);
      await respondWithSession(req, res, user);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/facebook",
  authProviderLimiter,
  validateBody(facebookAuthSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const { accessToken } = req.body as z.infer<typeof facebookAuthSchema>;
      const identity = await verifyFacebookAccessToken(accessToken);
      const user = await findOrCreateFacebookUser(identity);
      await respondWithSession(req, res, user);
    } catch (err) {
      next(err);
    }
  },
);

// ── Session lifecycle ─────────────────────────────────────────────────────

authRouter.post(
  "/refresh",
  authProviderLimiter,
  validateBody(refreshSchema),
  async (req, res, next) => {
    try {
      const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
      const tokens = await rotateSession(refreshToken, {
        userAgent: req.headers["user-agent"],
      });
      res.json({
        ok: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.accessTokenExpiresIn,
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/logout",
  validateBody(refreshSchema),
  async (req, res, next) => {
    try {
      const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
      await revokeSessionByRefreshToken(refreshToken);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── Current user ──────────────────────────────────────────────────────────

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: {
        venueStaff: {
          where: { isActive: true },
          select: {
            venueId: true,
            staffRole: true,
            venue: { select: { id: true, name: true, city: true } },
          },
        },
      },
    });
    if (!user) throw new AppError("User not found", 404);
    if (req.sessionId) await touchSession(req.sessionId);
    res.json({
      ok: true,
      user: publicUser(user),
      venueMemberships: user.venueStaff.map((m) => ({
        venueId: m.venueId,
        staffRole: m.staffRole,
        venueName: m.venue.name,
        city: m.venue.city,
      })),
    });
  } catch (err) {
    next(err);
  }
});

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
        socialEnergy?: string;
        conversationStyle?: string;
        tableOneLiner?: string;
        datingIntent?: string;
        interests?: string[];
      } = {};

      if (body.firstName) {
        data.firstName = body.firstName;
        data.fullName = body.firstName;
      }
      if (body.gender) data.gender = body.gender;
      if (body.socialEnergy) data.socialEnergy = body.socialEnergy;
      if (body.conversationStyle) data.conversationStyle = body.conversationStyle;
      if (body.tableOneLiner) data.tableOneLiner = body.tableOneLiner;
      if (body.datingIntent) data.datingIntent = body.datingIntent;
      if (body.interests) data.interests = body.interests;
      if (body.dateOfBirth) {
        const dob = parseDob(body.dateOfBirth);
        if (ageFromDob(dob) < 18) throw new AppError("You must be 18 or older");
        data.dateOfBirth = dob;
        data.isAgeVerified = true;
      }

      // A phone number is an identity key: only accept one already verified
      // by OTP on this account, never a raw value from the client.
      if (body.phone) {
        const normalized = normalizePhoneNumber(body.phone);
        const current = await prisma.user.findUnique({
          where: { id: req.userId },
          select: { phone: true },
        });
        if (current?.phone !== normalized.e164) {
          throw new AppError(
            "Verify this number with a code before adding it",
            403,
          );
        }
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

authRouter.delete("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) throw new AppError("Unauthorized", 401);

    await prisma.$transaction(async (tx) => {
      await tx.connectionSignal.deleteMany({
        where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
      });
      await tx.chatMessage.deleteMany({ where: { senderId: userId } });
      await tx.directMessage.deleteMany({ where: { senderId: userId } });
      await tx.directThread.deleteMany({
        where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
      });
      await tx.userBlock.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      });
      await tx.tableMember.deleteMany({ where: { userId } });
      await tx.bookingGroupMember.deleteMany({ where: { userId } });
      await tx.booking.deleteMany({ where: { userId } });
      await tx.venueStaff.deleteMany({ where: { userId } });
      await tx.authSession.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});
