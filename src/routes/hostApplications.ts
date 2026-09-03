import { Router } from "express";
import { HostApplicationStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";

export const hostApplicationsRouter = Router();

const applySchema = z.object({
  contactName: z.string().trim().min(1).max(80),
  contactPhone: z.string().trim().min(8).max(20).optional(),
  contactEmail: z.string().trim().email().max(120).optional(),
  venueName: z.string().trim().min(1).max(120),
  venueType: z.string().trim().min(1).max(60).optional(),
  address: z.string().trim().min(3).max(240),
  city: z.string().trim().min(1).max(80).default("Hyderabad"),
  area: z.string().trim().min(1).max(80).optional(),
  businessDetails: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
});

hostApplicationsRouter.use(requireAuth);

/** Current user's applications (newest first). */
hostApplicationsRouter.get("/me", async (req: AuthedRequest, res, next) => {
  try {
    const applications = await prisma.hostApplication.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        venue: { select: { id: true, name: true, city: true, area: true } },
      },
    });
    res.json({ ok: true, applications });
  } catch (err) {
    next(err);
  }
});

/**
 * Submit a host/venue application.
 * CRITICAL: never elevates role — admin approval does that.
 */
hostApplicationsRouter.post(
  "/",
  validateBody(applySchema),
  async (req: AuthedRequest, res, next) => {
    try {
      if (req.role === UserRole.ADMIN) {
        throw new AppError("Admins manage venues from the admin portal");
      }

      const pending = await prisma.hostApplication.findFirst({
        where: {
          userId: req.userId!,
          status: HostApplicationStatus.PENDING,
        },
      });
      if (pending) {
        throw new AppError(
          "You already have a pending host application",
          409,
        );
      }

      const body = req.body as z.infer<typeof applySchema>;
      const application = await prisma.hostApplication.create({
        data: {
          userId: req.userId!,
          status: HostApplicationStatus.PENDING,
          contactName: body.contactName,
          contactPhone: body.contactPhone,
          contactEmail: body.contactEmail,
          venueName: body.venueName,
          venueType: body.venueType,
          address: body.address,
          city: body.city || "Hyderabad",
          area: body.area,
          businessDetails: body.businessDetails,
          notes: body.notes,
        },
      });

      res.status(201).json({
        ok: true,
        application,
        message:
          "Application received. NYTO will review before venue portal access.",
      });
    } catch (err) {
      next(err);
    }
  },
);
