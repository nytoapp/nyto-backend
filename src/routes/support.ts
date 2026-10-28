import { Router } from "express";
import {
  SupportCategory,
  SupportSource,
  SupportStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";

export const supportRouter = Router();

const createSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  category: z.enum([
    "DOOR",
    "BOOKING",
    "NIGHT",
    "PAYMENT",
    "FEEDBACK",
    "OTHER",
  ]),
  message: z.string().trim().min(1).max(2000),
  bookingId: z.string().min(1).optional(),
  venueId: z.string().min(1).optional(),
});

supportRouter.use(requireAuth);

supportRouter.get("/me", async (req: AuthedRequest, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.userId!, source: SupportSource.GUEST },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        venue: { select: { id: true, name: true, area: true, city: true } },
      },
    });
    res.json({ ok: true, tickets });
  } catch (err) {
    next(err);
  }
});

supportRouter.post(
  "/",
  validateBody(createSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof createSchema>;
      let venueId = body.venueId ?? null;
      let bookingId = body.bookingId ?? null;

      if (bookingId) {
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          include: { table: { select: { venueId: true } } },
        });
        if (!booking || booking.userId !== req.userId) {
          throw new AppError("Booking not found", 404);
        }
        venueId = booking.table.venueId;
      } else if (venueId) {
        const venue = await prisma.venue.findUnique({ where: { id: venueId } });
        if (!venue) throw new AppError("Venue not found", 404);
      }

      const ticket = await prisma.supportTicket.create({
        data: {
          source: SupportSource.GUEST,
          userId: req.userId!,
          venueId,
          bookingId,
          subject: body.subject,
          category: body.category as SupportCategory,
          message: body.message,
          status: SupportStatus.OPEN,
        },
      });
      res.status(201).json({ ok: true, ticket });
    } catch (err) {
      next(err);
    }
  },
);
