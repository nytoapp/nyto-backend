import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { AppError } from "./errorHandler";

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ");
      return next(new AppError(message || "Invalid request body", 400));
    }
    req.body = parsed.data;
    return next();
  };
}
