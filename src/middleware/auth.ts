import type { NextFunction, Request, Response } from "express";
import { isSessionActive, verifyAccessToken } from "../lib/tokens";
import { AppError } from "./errorHandler";

export type AuthedRequest = Request & {
  userId?: string;
  sessionId?: string;
};

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token || undefined;
}

export async function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
) {
  const token = bearerToken(req);
  if (!token) return next(new AppError("Unauthorized", 401));

  try {
    const payload = verifyAccessToken(token);
    // Revoking a session must take effect immediately, not at token expiry.
    if (!(await isSessionActive(payload.sid))) {
      return next(new AppError("Session expired. Sign in again.", 401));
    }
    req.userId = payload.userId;
    req.sessionId = payload.sid;
    return next();
  } catch (err) {
    return next(err instanceof AppError ? err : new AppError("Unauthorized", 401));
  }
}
