import { Router } from "express";
import {
  DietaryPreference,
  GenderPreference,
  PriceTier,
  TableStatus,
  UserRole,
  VenueStaffRole,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { seatsHoldingCapacity } from "../lib/bookingSeats";
import {
  requireAuth,
  requireRoles,
  type AuthedRequest,
} from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";
import { cancelBookingAsAdmin } from "../lib/bookingLifecycle";
import { defaultBookingOpensAt } from "../lib/bookingWindow";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRoles(UserRole.ADMIN));

adminRouter.get("/access-check", (req: AuthedRequest, res) => {
  res.json({
    ok: true,
    surface: "admin",
    userId: req.userId,
    role: req.role,
  });
});

const venueCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(240),
  city: z.string().trim().min(1).max(80),
  area: z.string().trim().min(1).max(80).optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  isActive: z.boolean().optional(),
});

const venuePatchSchema = venueCreateSchema.partial();

const menuCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  dietaryType: z.enum(["VEGETARIAN", "NON_VEGETARIAN", "VEGAN"]),
  costPerHead: z.number().int().min(0),
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
  status: z.enum(["OPEN", "CANCELLED"]).optional(),
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
  status: z
    .enum([
      "OPEN",
      "MATCHING",
      "AWAITING_REVIEW",
      "APPROVED",
      "REVEALED",
      "COMPLETED",
      "CANCELLED",
    ])
    .optional(),
});

const staffAssignSchema = z.object({
  userId: z.string().min(1),
  staffRole: z.enum(["OWNER", "MANAGER", "STAFF"]).optional(),
});

adminRouter.get("/venues", async (_req, res, next) => {
  try {
    const venues = await prisma.venue.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { tables: true, staff: true, menus: true } },
      },
    });
    res.json({ ok: true, venues });
  } catch (err) {
    next(err);
  }
});

adminRouter.post(
  "/venues",
  validateBody(venueCreateSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof venueCreateSchema>;
      const venue = await prisma.venue.create({ data: body });
      res.status(201).json({ ok: true, venue });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.patch(
  "/venues/:venueId",
  validateBody(venuePatchSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof venuePatchSchema>;
      const venue = await prisma.venue.update({
        where: { id: venueId },
        data: body,
      });
      res.json({ ok: true, venue });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.post(
  "/venues/:venueId/staff",
  validateBody(staffAssignSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof staffAssignSchema>;

      const [venue, user] = await Promise.all([
        prisma.venue.findUnique({ where: { id: venueId } }),
        prisma.user.findUnique({ where: { id: body.userId } }),
      ]);
      if (!venue) throw new AppError("Venue not found", 404);
      if (!user) throw new AppError("User not found", 404);

      const staff = await prisma.$transaction(async (tx) => {
        if (user.role === UserRole.USER) {
          await tx.user.update({
            where: { id: user.id },
            data: { role: UserRole.VENUE_STAFF },
          });
        }
        return tx.venueStaff.upsert({
          where: {
            userId_venueId: { userId: user.id, venueId },
          },
          create: {
            userId: user.id,
            venueId,
            staffRole: (body.staffRole as VenueStaffRole) ?? VenueStaffRole.STAFF,
            isActive: true,
          },
          update: {
            staffRole: (body.staffRole as VenueStaffRole) ?? undefined,
            isActive: true,
          },
        });
      });

      res.status(201).json({ ok: true, staff });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get("/venues/:venueId/menus", async (req, res, next) => {
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
});

adminRouter.post(
  "/venues/:venueId/menus",
  validateBody(menuCreateSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof menuCreateSchema>;
      const venue = await prisma.venue.findUnique({ where: { id: venueId } });
      if (!venue) throw new AppError("Venue not found", 404);

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

adminRouter.get("/venues/:venueId/tables", async (req, res, next) => {
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
      tables: tables.map((t) => ({
        ...t,
        seatsTaken: seatsHoldingCapacity(t.bookings),
        seatsLeft: Math.max(t.capacity - seatsHoldingCapacity(t.bookings), 0),
        bookings: undefined,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post(
  "/venues/:venueId/tables",
  validateBody(tableCreateSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof tableCreateSchema>;
      const venue = await prisma.venue.findUnique({ where: { id: venueId } });
      if (!venue) throw new AppError("Venue not found", 404);

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
          status: (body.status as TableStatus) ?? TableStatus.OPEN,
        },
      });
      res.status(201).json({ ok: true, table });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.patch(
  "/tables/:tableId",
  validateBody(tablePatchSchema),
  async (req, res, next) => {
    try {
      const tableId = String(req.params.tableId);
      const body = req.body as z.infer<typeof tablePatchSchema>;
      const existing = await prisma.supperTable.findUnique({
        where: { id: tableId },
      });
      if (!existing) throw new AppError("Table not found", 404);

      if (body.menuId) {
        const menu = await prisma.venueMenu.findFirst({
          where: { id: body.menuId, venueId: existing.venueId },
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

adminRouter.get("/bookings", async (req, res, next) => {
  try {
    const venueId =
      typeof req.query.venueId === "string" ? req.query.venueId : undefined;
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;

    const bookings = await prisma.booking.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(venueId ? { table: { venueId } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            fullName: true,
            phone: true,
            email: true,
          },
        },
        table: { include: { venue: true } },
        payment: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ ok: true, bookings });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/payments", async (_req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      include: {
        booking: {
          include: {
            table: { include: { venue: { select: { id: true, name: true } } } },
            user: { select: { id: true, fullName: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ ok: true, payments });
  } catch (err) {
    next(err);
  }
});

const adminCancelSchema = z.object({
  reason: z.string().trim().min(1).max(240).optional(),
});

adminRouter.post(
  "/bookings/:bookingId/cancel",
  validateBody(adminCancelSchema),
  async (req, res, next) => {
    try {
      const bookingId = String(req.params.bookingId);
      const body = req.body as z.infer<typeof adminCancelSchema>;
      const booking = await cancelBookingAsAdmin(bookingId, body.reason);
      res.json({ ok: true, booking });
    } catch (err) {
      next(err);
    }
  },
);
