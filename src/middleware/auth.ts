import type { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { canAccessVenue, roleAllowed } from "../lib/rbac";
import { isSessionActive, verifyAccessToken } from "../lib/tokens";
import { AppError } from "./errorHandler";

export type AuthedRequest = Request & {
  userId?: string;
  sessionId?: string;
  /** Loaded from DB on every authenticated request — never from the client. */
  role?: UserRole;
  /** Active venue ids this user staffs (empty for plain users / admins without membership). */
  venueIds?: string[];
};

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token || undefined;
}

/**
 * Verifies JWT + active session, then attaches platform role and venue tenancy
 * from the database so demotions take effect immediately.
 */
export async function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
) {
  const token = bearerToken(req);
  if (!token) return next(new AppError("Unauthorized", 401));

  try {
    const payload = verifyAccessToken(token);
    if (!(await isSessionActive(payload.sid))) {
      return next(new AppError("Session expired. Sign in again.", 401));
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        role: true,
        venueStaff: {
          where: { isActive: true },
          select: { venueId: true },
        },
      },
    });
    if (!user) return next(new AppError("Unauthorized", 401));

    req.userId = user.id;
    req.sessionId = payload.sid;
    req.role = user.role;
    req.venueIds = user.venueStaff.map((m) => m.venueId);
    return next();
  } catch (err) {
    return next(err instanceof AppError ? err : new AppError("Unauthorized", 401));
  }
}

/** Gate a route to one or more platform roles. ADMIN always passes. */
export function requireRoles(...allowed: UserRole[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.userId || !req.role) {
      return next(new AppError("Unauthorized", 401));
    }
    if (!roleAllowed(req.role, allowed)) {
      return next(new AppError("Forbidden", 403));
    }
    return next();
  };
}

/**
 * Require access to a venue id from params or query.
 * Never authorizes from a body-supplied role/venue claim alone.
 */
export function requireVenueAccess(
  source: "params" | "query" = "params",
  key = "venueId",
) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.userId || !req.role) {
      return next(new AppError("Unauthorized", 401));
    }

    const raw =
      source === "params"
        ? req.params[key]
        : typeof req.query[key] === "string"
          ? (req.query[key] as string)
          : undefined;
    const venueId = typeof raw === "string" ? raw.trim() : "";
    if (!venueId) {
      return next(new AppError("venueId is required", 400));
    }

    if (!canAccessVenue(req.role, req.venueIds ?? [], venueId)) {
      return next(new AppError("Forbidden", 403));
    }

    return next();
  };
}
