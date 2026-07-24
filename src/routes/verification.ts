import { Router } from "express";
import { IdDocumentType, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";

export const verificationRouter = Router();

verificationRouter.use(requireAuth);

const idSchema = z.object({
  documentType: z.enum(["PAN", "AADHAAR", "DRIVING_LICENCE", "PASSPORT"]),
  documentUrl: z.string().min(1).default("local://id-upload"),
});

const selfieSchema = z.object({
  selfieUrl: z.string().min(1).default("local://selfie-capture"),
});

verificationRouter.post(
  "/id",
  validateBody(idSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof idSchema>;

      const record = await prisma.identityVerification.create({
        data: {
          userId: req.userId!,
          documentType: body.documentType as IdDocumentType,
          documentUrl: body.documentUrl,
          selfieUrl: "",
          status: VerificationStatus.SUBMITTED,
        },
      });

      await prisma.user.update({
        where: { id: req.userId },
        data: { verificationStatus: VerificationStatus.SUBMITTED },
      });

      res.status(201).json({ ok: true, verification: record });
    } catch (err) {
      next(err);
    }
  },
);

verificationRouter.post(
  "/selfie",
  validateBody(selfieSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof selfieSchema>;
      const latest = await prisma.identityVerification.findFirst({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
      });
      if (!latest) {
        throw new AppError("Submit ID photo before selfie", 400);
      }

      const updated = await prisma.identityVerification.update({
        where: { id: latest.id },
        data: {
          selfieUrl: body.selfieUrl,
          status: VerificationStatus.APPROVED,
          reviewedAt: new Date(),
          notes: "Auto-approved in development stub",
        },
      });

      await prisma.user.update({
        where: { id: req.userId },
        data: { verificationStatus: VerificationStatus.APPROVED },
      });

      res.json({ ok: true, verification: updated });
    } catch (err) {
      next(err);
    }
  },
);
