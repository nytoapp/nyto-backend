import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { OtpChannel } from "@prisma/client";
import { env, testCodeFor } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import { prisma } from "./prisma";

const CODE_LENGTH = 6;

export type OtpIssueResult = {
  /** The plaintext code. Callers deliver it and must never persist or log it. */
  code: string;
  expiresAt: Date;
  /** Seconds until a resend is permitted. */
  resendAfterSeconds: number;
  /** True when a fixed development test code was used instead of a random one. */
  isTestCode: boolean;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateCode(): string {
  // randomInt is CSPRNG-backed; Math.random is not acceptable for OTPs.
  return randomInt(0, 10 ** CODE_LENGTH)
    .toString()
    .padStart(CODE_LENGTH, "0");
}

/** Keyed hash so a database leak does not reveal in-flight codes. */
function hashCode(channel: OtpChannel, destination: string, code: string): string {
  return createHmac("sha256", env.OTP_PEPPER)
    .update(`${channel}:${destination}:${code}`)
    .digest("hex");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Creates a challenge, or reuses the live one when the caller is resending.
 *
 * Enforces a per-destination resend cooldown and a rolling hourly send cap so
 * repeated taps and scripted abuse cannot burn SMS credit.
 */
export async function issueOtpChallenge(
  channel: OtpChannel,
  destination: string,
): Promise<OtpIssueResult> {
  const now = new Date();

  const active = await prisma.otpChallenge.findFirst({
    where: {
      channel,
      destination,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (active) {
    const nextSendAt = new Date(
      active.lastSentAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000,
    );
    if (nextSendAt > now) {
      throw new AppError(
        `Please wait ${Math.ceil((nextSendAt.getTime() - now.getTime()) / 1000)}s before requesting another code`,
        429,
      );
    }
  }

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const sendsThisHour = await prisma.otpChallenge.aggregate({
    where: { channel, destination, createdAt: { gte: oneHourAgo } },
    _sum: { sendCount: true },
  });
  if ((sendsThisHour._sum.sendCount ?? 0) >= env.OTP_MAX_SENDS_PER_HOUR) {
    throw new AppError(
      "Too many codes requested. Try again in an hour.",
      429,
    );
  }

  const testCode = testCodeFor(destination);
  const code = testCode ?? generateCode();
  const expiresAt = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000);
  const codeHash = hashCode(channel, destination, code);

  if (active) {
    // Resend replaces the code so an intercepted earlier code stops working.
    await prisma.otpChallenge.update({
      where: { id: active.id },
      data: {
        codeHash,
        expiresAt,
        lastSentAt: now,
        attempts: 0,
        sendCount: { increment: 1 },
      },
    });
  } else {
    await prisma.otpChallenge.create({
      data: {
        channel,
        destination,
        codeHash,
        expiresAt,
        lastSentAt: now,
        maxAttempts: env.OTP_MAX_ATTEMPTS,
      },
    });
  }

  return {
    code,
    expiresAt,
    resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    isTestCode: Boolean(testCode),
  };
}

/**
 * Consumes a challenge. Throws a 401 for wrong/expired codes and a 429 once
 * the attempt budget is exhausted. Success marks the challenge consumed so a
 * code can never be replayed.
 */
export async function consumeOtpChallenge(
  channel: OtpChannel,
  destination: string,
  code: string,
): Promise<void> {
  const now = new Date();

  const challenge = await prisma.otpChallenge.findFirst({
    where: { channel, destination, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    throw new AppError("Request a new code to continue", 401);
  }

  if (challenge.expiresAt <= now) {
    throw new AppError("That code expired. Request a new one.", 401);
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    throw new AppError(
      "Too many incorrect attempts. Request a new code.",
      429,
    );
  }

  const expected = challenge.codeHash;
  const actual = hashCode(channel, destination, code.trim());

  if (!constantTimeEquals(expected, actual)) {
    const updated = await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    const remaining = Math.max(updated.maxAttempts - updated.attempts, 0);
    throw new AppError(
      remaining > 0
        ? `Incorrect code. ${remaining} ${remaining === 1 ? "try" : "tries"} left.`
        : "Too many incorrect attempts. Request a new code.",
      remaining > 0 ? 401 : 429,
    );
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: now },
  });
}

/** Housekeeping for expired/consumed rows. Safe to call periodically. */
export async function pruneOtpChallenges(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { count } = await prisma.otpChallenge.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] },
  });
  return count;
}

export const __testing = { hashCode, generateCode, CODE_LENGTH };
