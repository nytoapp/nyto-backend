import { Router } from "express";
import {
  DietaryPreference,
  GenderPreference,
  PriceTier,
  TableStatus,
  UserRole,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { seatsHoldingCapacity } from "../lib/bookingSeats";
import { checkInByCode } from "../lib/bookingLifecycle";
import { defaultBookingOpensAt } from "../lib/bookingWindow";
import {
  requireAuth,
  requireRoles,
  requireVenueAccess,
  type AuthedRequest,
} from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";

export const venueRouter = Router();
venueRouter.use(requireAuth, requireRoles(UserRole.VENUE_STAFF, UserRole.ADMIN));

venueRouter.get("/access-check", requireVenueAccess("query", "venueId"), (
  req: AuthedRequest,
  res,
) => {
  res.json({
    ok: true,
    surface: "venue",
    userId: req.userId,
    role: req.role,
    venueId: String(req.query.venueId),
    venueIds: req.venueIds ?? [],
  });
});

/** Venues this staff member (or admin) can manage. */
venueRouter.get("/me/venues", async (req: AuthedRequest, res, next) => {
  try {
    if (req.role === UserRole.ADMIN) {
      const venues = await prisma.venue.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      });
      return res.json({ ok: true, venues });
    }

    const memberships = await prisma.venueStaff.findMany({
      where: { userId: req.userId, isActive: true },
      include: { venue: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      ok: true,
      venues: memberships.map((m) => ({
        ...m.venue,
        staffRole: m.staffRole,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const tableCreateSchema = z.object({
  menuId: z.string().min(1).optional(),
  startsAt: z.string().datetime(),
  bookingOpensAt: z.string().datetime().optional(),
  priceTier: z.enum(["DAYTIME", "EVENING"]),
  seatPrice: z.number().int().min(0),
  capacity: z.number().int().min(2).max(12).optional(),
  genderPreference: z.enum(["BALANCED", "WOMEN_ONLY"]).optional(),
  icebreakers: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
});

const tablePatchSchema = z.object({
  menuId: z.string().min(1).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  bookingOpensAt: z.string().datetime().optional(),
  priceTier: z.enum(["DAYTIME", "EVENING"]).optional(),
  seatPrice: z.number().int().min(0).optional(),
  capacity: z.number().int().min(2).max(12).optional(),
  genderPreference: z.enum(["BALANCED", "WOMEN_ONLY"]).optional(),
  icebreakers: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  /** Venue may open/cancel upcoming inventory only — not destroy paid nights casually. */
  status: z.enum(["OPEN", "CANCELLED"]).optional(),
});

const menuCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  dietaryType: z.enum(["VEGETARIAN", "NON_VEGETARIAN", "VEGAN"]),
  costPerHead: z.number().int().min(0),
});

const checkInSchema = z.object({
  checkInCode: z.string().trim().min(4).max(16),
});

venueRouter.get(
  "/:venueId/menus",
  requireVenueAccess("params", "venueId"),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const menus = await prisma.venueMenu.findMany({
        where: { venueId },
        orderBy: { createdAt: "desc" },
      });
      res.json({ ok: true, menus });
    } catch (err) {
      next(err);
    }
  },
);

venueRouter.post(
  "/:venueId/menus",
  requireVenueAccess("params", "venueId"),
  validateBody(menuCreateSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof menuCreateSchema>;
      const menu = await prisma.venueMenu.create({
        data: {
          venueId,
          name: body.name,
          description: body.description,
          dietaryType: body.dietaryType as DietaryPreference,
          costPerHead: body.costPerHead,
        },
      });
      res.status(201).json({ ok: true, menu });
    } catch (err) {
      next(err);
    }
  },
);

venueRouter.get(
  "/:venueId/tables",
  requireVenueAccess("params", "venueId"),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const tables = await prisma.supperTable.findMany({
        where: { venueId },
        include: {
          menu: true,
          bookings: {
            select: { seatsBooked: true, status: true, createdAt: true },
          },
        },
        orderBy: { startsAt: "asc" },
      });
      res.json({
        ok: true,
        tables: tables.map((t) => {
          const seatsTaken = seatsHoldingCapacity(t.bookings);
          return {
            id: t.id,
            venueId: t.venueId,
            startsAt: t.startsAt,
            priceTier: t.priceTier,
            seatPrice: t.seatPrice,
            capacity: t.capacity,
            status: t.status,
            genderPreference: t.genderPreference,
            menu: t.menu,
            seatsTaken,
            seatsLeft: Math.max(t.capacity - seatsTaken, 0),
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

venueRouter.post(
  "/:venueId/tables",
  requireVenueAccess("params", "venueId"),
  validateBody(tableCreateSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof tableCreateSchema>;

      if (body.menuId) {
        const menu = await prisma.venueMenu.findFirst({
          where: { id: body.menuId, venueId },
        });
        if (!menu) throw new AppError("Menu not found for this venue", 404);
      }

      const startsAt = new Date(body.startsAt);
      const table = await prisma.supperTable.create({
        data: {
          venueId,
          menuId: body.menuId,
          startsAt,
          bookingOpensAt: body.bookingOpensAt
            ? new Date(body.bookingOpensAt)
            : defaultBookingOpensAt(startsAt),
          priceTier: body.priceTier as PriceTier,
          seatPrice: body.seatPrice,
          capacity: body.capacity ?? 6,
          genderPreference:
            (body.genderPreference as GenderPreference) ??
            GenderPreference.BALANCED,
          icebreakers: body.icebreakers ?? [],
          status: TableStatus.OPEN,
        },
      });
      res.status(201).json({ ok: true, table });
    } catch (err) {
      next(err);
    }
  },
);

venueRouter.patch(
  "/:venueId/tables/:tableId",
  requireVenueAccess("params", "venueId"),
  validateBody(tablePatchSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const tableId = String(req.params.tableId);
      const body = req.body as z.infer<typeof tablePatchSchema>;

      const existing = await prisma.supperTable.findFirst({
        where: { id: tableId, venueId },
        include: {
          bookings: {
            where: {
              status: { in: ["CONFIRMED", "ATTENDED", "PENDING_PAYMENT"] },
            },
            select: { id: true, status: true },
          },
        },
      });
      if (!existing) throw new AppError("Table not found", 404);

      if (body.status === "CANCELLED") {
        const hasPaid = existing.bookings.some(
          (b) => b.status === "CONFIRMED" || b.status === "ATTENDED",
        );
        if (hasPaid) {
          throw new AppError(
            "Cannot cancel a table with paid bookings — contact NYTO admin",
            409,
          );
        }
      }

      if (body.menuId) {
        const menu = await prisma.venueMenu.findFirst({
          where: { id: body.menuId, venueId },
        });
        if (!menu) throw new AppError("Menu not found for this venue", 404);
      }

      const startsAt = body.startsAt ? new Date(body.startsAt) : undefined;
      let bookingOpensAt = body.bookingOpensAt
        ? new Date(body.bookingOpensAt)
        : undefined;
      if (startsAt && !body.bookingOpensAt) {
        bookingOpensAt = defaultBookingOpensAt(startsAt);
      }

      const table = await prisma.supperTable.update({
        where: { id: tableId },
        data: {
          menuId: body.menuId === undefined ? undefined : body.menuId,
          startsAt,
          bookingOpensAt,
          priceTier: body.priceTier as PriceTier | undefined,
          seatPrice: body.seatPrice,
          capacity: body.capacity,
          genderPreference: body.genderPreference as GenderPreference | undefined,
          icebreakers: body.icebreakers,
          status: body.status as TableStatus | undefined,
        },
      });
      res.json({ ok: true, table });
    } catch (err) {
      next(err);
    }
  },
);

/** Paid / confirmed guests for this venue (door list). */
venueRouter.get(
  "/:venueId/bookings",
  requireVenueAccess("params", "venueId"),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const bookings = await prisma.booking.findMany({
        where: {
          table: { venueId },
          status: { in: ["CONFIRMED", "ATTENDED", "NO_SHOW"] },
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              fullName: true,
              phone: true,
            },
          },
          table: {
            select: {
              id: true,
              startsAt: true,
              status: true,
              seatPrice: true,
            },
          },
          payment: true,
        },
        orderBy: { table: { startsAt: "asc" } },
        take: 200,
      });

      res.json({
        ok: true,
        bookings: bookings.map((b) => ({
          id: b.id,
          status: b.status,
          seatsBooked: b.seatsBooked,
          checkInCode: b.checkInCode,
          checkedInAt: b.checkedInAt,
          amountPaid: b.amountPaid,
          paidAt: b.paidAt,
          user: b.user,
          table: b.table,
          payment: b.payment
            ? {
                id: b.payment.id,
                status: b.payment.status,
                amount: b.payment.amount,
                method: b.payment.method,
              }
            : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

venueRouter.post(
  "/:venueId/check-in",
  requireVenueAccess("params", "venueId"),
  validateBody(checkInSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof checkInSchema>;
      const result = await checkInByCode({
        venueId,
        checkInCode: body.checkInCode,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);
