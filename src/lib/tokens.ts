import { createHash, randomBytes, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import { prisma } from "./prisma";

export type AccessTokenPayload = {
  userId: string;
  /** Session id, so a revoked session can be rejected before its access token expires. */
  sid: string;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: Date;
};

const REFRESH_TOKEN_BYTES = 48;

function accessTokenTtlSeconds(): number {
  return env.ACCESS_TOKEN_TTL_MINUTES * 60;
}

function refreshTokenTtlMs(): number {
  return env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** Refresh tokens are opaque secrets, so a plain SHA-256 lookup hash is enough. */
function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: accessTokenTtlSeconds(),
    issuer: "nyto",
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: "nyto",
    }) as Partial<AccessTokenPayload>;
    if (!decoded.userId || !decoded.sid) {
      throw new AppError("Invalid or expired token", 401);
    }
    return { userId: decoded.userId, sid: decoded.sid };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Invalid or expired token", 401);
  }
}

/** Creates a fresh session for a successful login. */
export async function issueSession(
  userId: string,
  meta: { userAgent?: string } = {},
): Promise<IssuedTokens> {
  const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  const refreshTokenExpiresAt = new Date(Date.now() + refreshTokenTtlMs());

  const session = await prisma.authSession.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
      userAgent: meta.userAgent?.slice(0, 255),
    },
  });

  return {
    accessToken: signAccessToken({ userId, sid: session.id }),
    refreshToken,
    accessTokenExpiresIn: accessTokenTtlSeconds(),
    refreshTokenExpiresAt,
  };
}

/**
 * Rotates a refresh token: the presented token is consumed and replaced.
 *
 * Reuse of an already-rotated token is treated as theft and revokes every
 * session for that user.
 */
export async function rotateSession(
  refreshToken: string,
  meta: { userAgent?: string } = {},
): Promise<IssuedTokens> {
  const hash = hashRefreshToken(refreshToken);
  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hash },
  });

  if (!session) {
    throw new AppError("Session expired. Sign in again.", 401);
  }

  if (session.revokedAt || session.replacedById) {
    await prisma.authSession.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError("Session expired. Sign in again.", 401);
  }

  if (session.expiresAt <= new Date()) {
    throw new AppError("Session expired. Sign in again.", 401);
  }

  const nextToken = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
  const refreshTokenExpiresAt = new Date(Date.now() + refreshTokenTtlMs());

  const next = await prisma.$transaction(async (tx) => {
    const created = await tx.authSession.create({
      data: {
        userId: session.userId,
        refreshTokenHash: hashRefreshToken(nextToken),
        expiresAt: refreshTokenExpiresAt,
        userAgent: meta.userAgent?.slice(0, 255) ?? session.userAgent,
      },
    });
    await tx.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: created.id },
    });
    return created;
  });

  return {
    accessToken: signAccessToken({ userId: session.userId, sid: next.id }),
    refreshToken: nextToken,
    accessTokenExpiresIn: accessTokenTtlSeconds(),
    refreshTokenExpiresAt,
  };
}

export async function revokeSessionByRefreshToken(
  refreshToken: string,
): Promise<void> {
  await prisma.authSession.updateMany({
    where: { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function isSessionActive(sessionId: string): Promise<boolean> {
  const session = await prisma.authSession.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!session) return false;
  return !session.revokedAt && session.expiresAt > new Date();
}

export async function touchSession(sessionId: string): Promise<void> {
  await prisma.authSession
    .update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

export const __testing = { hashRefreshToken, timingSafeEqual };
