import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "./errorHandler";

export type AuthPayload = {
  userId: string;
};

export type AuthedRequest = Request & {
  userId?: string;
};

export function signToken(userId: string): string {
  return jwt.sign({ userId } satisfies AuthPayload, env.JWT_SECRET, {
    expiresIn: "30d",
  });
}

export function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError("Unauthorized", 401));
  }

  try {
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    req.userId = payload.userId;
    return next();
  } catch {
    return next(new AppError("Invalid or expired token", 401));
  }
}
