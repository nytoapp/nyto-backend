import { Router } from "express";
import {
  AuthProvider,
  DietaryPreference,
  GenderPreference,
  HostApplicationStatus,
  NytoTableType,
  PriceTier,
  TablePaymentType,
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
import { genderPreferenceForTableType } from "../lib/tableType";
import {
  approveHostApplication,
  rejectHostApplication,
} from "../lib/hostApplications";
import { findOrCreateEmailUser } from "../lib/identity";
import { normalizeEmail } from "../lib/otp";

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

adminRouter.get("/overview", async (_req, res, next) => {
  try {
    const [
      activeVenues,
      sessions,
      confirmed,
      pendingPayment,
      pendingHosts,
    ] = await Promise.all([
      prisma.venue.count({ where: { isActive: true } }),
      prisma.supperTable.count({
        where: { status: { not: TableStatus.CANCELLED } },
      }),
      prisma.booking.count({ where: { status: "CONFIRMED" } }),
      prisma.booking.count({ where: { status: "PENDING_PAYMENT" } }),
      prisma.hostApplication.count({
        where: { status: HostApplicationStatus.PENDING },
      }),
    ]);

    const attention: { id: string; label: string; href: string }[] = [];
    if (pendingPayment > 0) {
      attention.push({
        id: "pending-payments",
        label: `${pendingPayment} pending payment${pendingPayment === 1 ? "" : "s"}`,
        href: "/bookings",
      });
    }
    if (pendingHosts > 0) {
      attention.push({
        id: "pending-hosts",
        label: `${pendingHosts} host application${pendingHosts === 1 ? "" : "s"}`,
        href: "/host-applications",
      });
    }

    const [recentBookings, recentPayments] = await Promise.all([
      prisma.booking.findMany({
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
        take: 6,
      }),
      prisma.payment.findMany({
        include: {
          booking: {
            include: {
              table: {
                include: { venue: { select: { id: true, name: true } } },
              },
              user: { select: { id: true, fullName: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
    ]);

    res.json({
      ok: true,
      stats: { activeVenues, sessions, confirmed, pendingPayment },
      attention,
      recentBookings,
      recentPayments,
    });
  } catch (err) {
    next(err);
  }
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

const menuPatchSchema = menuCreateSchema.partial();

const tableCreateSchema = z.object({
  menuId: z.string().min(1).optional(),
  startsAt: z.string().datetime(),
  bookingOpensAt: z.string().datetime().optional(),
  priceTier: z.enum(["DAYTIME", "EVENING"]),
  seatPrice: z.number().int().min(0),
  capacity: z.number().int().min(2).max(12).optional(),
  genderPreference: z.enum(["BALANCED", "WOMEN_ONLY"]).optional(),
  tableType: z.enum(["WEEKLY", "WOMEN_LED", "COUPLES", "SINGLES"]).optional(),
  paymentType: z.enum(["ALL_INCLUSIVE", "PAY_OWN_BILL"]).optional(),
  vibeCopy: z.string().trim().max(180).optional(),
  inclusions: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
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
  tableType: z.enum(["WEEKLY", "WOMEN_LED", "COUPLES", "SINGLES"]).optional(),
  paymentType: z.enum(["ALL_INCLUSIVE", "PAY_OWN_BILL"]).optional(),
  vibeCopy: z.string().trim().max(180).nullable().optional(),
  inclusions: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
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

const staffAssignSchema = z
  .object({
    userId: z.string().min(1).optional(),
    email: z.string().trim().email().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    staffRole: z.enum(["OWNER", "MANAGER", "STAFF"]).optional(),
  })
  .refine((body) => Boolean(body.userId || body.email), {
    message: "userId or email is required",
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

adminRouter.get("/venues/:venueId", async (req, res, next) => {
  try {
    const venueId = String(req.params.venueId);
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      include: {
        _count: { select: { tables: true, staff: true, menus: true } },
      },
    });
    if (!venue) throw new AppError("Venue not found", 404);
    res.json({ ok: true, venue });
  } catch (err) {
    next(err);
  }
});

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

adminRouter.get("/venues/:venueId/staff", async (req, res, next) => {
  try {
    const venueId = String(req.params.venueId);
    const venue = await prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new AppError("Venue not found", 404);

    const staff = await prisma.venueStaff.findMany({
      where: { venueId, isActive: true },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    res.json({ ok: true, staff });
  } catch (err) {
    next(err);
  }
});

adminRouter.post(
  "/venues/:venueId/staff",
  validateBody(staffAssignSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof staffAssignSchema>;

      const venue = await prisma.venue.findUnique({ where: { id: venueId } });
      if (!venue) throw new AppError("Venue not found", 404);

      let user = body.userId
        ? await prisma.user.findUnique({ where: { id: body.userId } })
        : null;

      if (!user && body.email) {
        const email = normalizeEmail(body.email);
        user = await findOrCreateEmailUser(email);
        if (body.name?.trim()) {
          const name = body.name.trim();
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              fullName: name,
              firstName: name.split(/\s+/)[0] || name,
            },
          });
        }
      }

      if (!user) throw new AppError("User not found", 404);
      if (user.role === UserRole.ADMIN) {
        throw new AppError("Cannot assign platform admins as venue staff", 400);
      }

      const staff = await prisma.$transaction(async (tx) => {
        if (user!.role === UserRole.USER) {
          await tx.user.update({
            where: { id: user!.id },
            data: { role: UserRole.VENUE_STAFF },
          });
        }
        return tx.venueStaff.upsert({
          where: {
            userId_venueId: { userId: user!.id, venueId },
          },
          create: {
            userId: user!.id,
            venueId,
            staffRole: (body.staffRole as VenueStaffRole) ?? VenueStaffRole.STAFF,
            isActive: true,
          },
          update: {
            staffRole: (body.staffRole as VenueStaffRole) ?? undefined,
            isActive: true,
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                fullName: true,
                email: true,
                phone: true,
                role: true,
              },
            },
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

adminRouter.patch(
  "/menus/:menuId",
  validateBody(menuPatchSchema),
  async (req, res, next) => {
    try {
      const menuId = String(req.params.menuId);
      const body = req.body as z.infer<typeof menuPatchSchema>;
      const existing = await prisma.venueMenu.findUnique({ where: { id: menuId } });
      if (!existing) throw new AppError("Experience not found", 404);

      const menu = await prisma.venueMenu.update({
        where: { id: menuId },
        data: {
          name: body.name,
          description: body.description,
          dietaryType: body.dietaryType as DietaryPreference | undefined,
          costPerHead: body.costPerHead,
        },
      });
      res.json({ ok: true, menu });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.delete("/menus/:menuId", async (req, res, next) => {
  try {
    const menuId = String(req.params.menuId);
    const existing = await prisma.venueMenu.findUnique({ where: { id: menuId } });
    if (!existing) throw new AppError("Experience not found", 404);

    const inUse = await prisma.supperTable.count({ where: { menuId } });
    if (inUse > 0) {
      throw new AppError(
        "This experience is linked to sessions. Reassign those nights first.",
        409,
      );
    }

    await prisma.venueMenu.delete({ where: { id: menuId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

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
      const tableType = (body.tableType as NytoTableType) ?? NytoTableType.WEEKLY;
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
          tableType,
          paymentType:
            (body.paymentType as TablePaymentType) ??
            TablePaymentType.ALL_INCLUSIVE,
          vibeCopy: body.vibeCopy,
          inclusions: body.inclusions ?? [],
          genderPreference:
            (body.genderPreference as GenderPreference) ??
            genderPreferenceForTableType(tableType),
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

adminRouter.get("/tables", async (req, res, next) => {
  try {
    const venueId =
      typeof req.query.venueId === "string" ? req.query.venueId : undefined;
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;

    const tables = await prisma.supperTable.findMany({
      where: {
        ...(venueId ? { venueId } : {}),
        ...(status && status !== "FULL"
          ? { status: status as TableStatus }
          : {}),
      },
      include: {
        menu: true,
        venue: { select: { id: true, name: true, city: true, area: true } },
        bookings: {
          select: { seatsBooked: true, status: true, createdAt: true },
        },
      },
      orderBy: { startsAt: "asc" },
      take: 200,
    });

    let mapped = tables.map((t) => {
      const seatsTaken = seatsHoldingCapacity(t.bookings);
      const seatsLeft = Math.max(t.capacity - seatsTaken, 0);
      const { bookings: _bookings, ...rest } = t;
      return {
        ...rest,
        seatsTaken,
        seatsLeft,
      };
    });

    if (status === "FULL") {
      mapped = mapped.filter(
        (t) => t.status !== TableStatus.CANCELLED && t.seatsLeft === 0,
      );
    } else if (status === "OPEN") {
      mapped = mapped.filter(
        (t) => t.status === TableStatus.OPEN && t.seatsLeft > 0,
      );
    }

    res.json({ ok: true, tables: mapped });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/tables/:tableId/bookings", async (req, res, next) => {
  try {
    const tableId = String(req.params.tableId);
    const table = await prisma.supperTable.findUnique({
      where: { id: tableId },
      include: {
        venue: { select: { id: true, name: true, city: true, area: true } },
        menu: { select: { id: true, name: true } },
      },
    });
    if (!table) throw new AppError("Table not found", 404);

    const bookings = await prisma.booking.findMany({
      where: { tableId },
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
        payment: true,
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      ok: true,
      table: {
        id: table.id,
        startsAt: table.startsAt,
        capacity: table.capacity,
        status: table.status,
        seatPrice: table.seatPrice,
        venue: table.venue,
        menu: table.menu,
      },
      bookings,
    });
  } catch (err) {
    next(err);
  }
});

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
          tableType: body.tableType as NytoTableType | undefined,
          paymentType: body.paymentType as TablePaymentType | undefined,
          vibeCopy: body.vibeCopy === undefined ? undefined : body.vibeCopy,
          inclusions: body.inclusions,
          genderPreference:
            (body.genderPreference as GenderPreference | undefined) ??
            (body.tableType
              ? genderPreferenceForTableType(body.tableType as NytoTableType)
              : undefined),
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

adminRouter.get("/host-applications", async (req, res, next) => {
  try {
    const statusRaw =
      typeof req.query.status === "string" ? req.query.status : "PENDING";
    const status =
      statusRaw === "ALL"
        ? undefined
        : (statusRaw as HostApplicationStatus);
    const applications = await prisma.hostApplication.findMany({
      where: status ? { status } : {},
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            fullName: true,
            phone: true,
            email: true,
            role: true,
          },
        },
        venue: {
          select: { id: true, name: true, city: true, area: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ ok: true, applications });
  } catch (err) {
    next(err);
  }
});

const hostApproveSchema = z.object({
  venueId: z.string().min(1).optional(),
});

adminRouter.post(
  "/host-applications/:id/approve",
  validateBody(hostApproveSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const body = req.body as z.infer<typeof hostApproveSchema>;
      const application = await approveHostApplication({
        applicationId: id,
        adminUserId: req.userId!,
        venueId: body.venueId,
      });
      res.json({ ok: true, application });
    } catch (err) {
      next(err);
    }
  },
);

const hostRejectSchema = z.object({
  reason: z.string().trim().min(1).max(240).optional(),
});

adminRouter.post(
  "/host-applications/:id/reject",
  validateBody(hostRejectSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const body = req.body as z.infer<typeof hostRejectSchema>;
      const application = await rejectHostApplication({
        applicationId: id,
        adminUserId: req.userId!,
        reason: body.reason,
      });
      res.json({ ok: true, application });
    } catch (err) {
      next(err);
    }
  },
);

adminRouter.get("/guests", async (req, res, next) => {
  try {
    const q =
      typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

    const users = await prisma.user.findMany({
      where: {
        role: { in: [UserRole.USER, UserRole.VENUE_STAFF] },
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: "insensitive" } },
                { firstName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      include: {
        _count: { select: { bookings: true } },
        bookings: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: {
            table: { include: { venue: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    res.json({
      ok: true,
      guests: users.map((u) => ({
        id: u.id,
        name: u.fullName || u.firstName || "Guest",
        phone: u.phone,
        email: u.email,
        bookings: u._count.bookings,
        lastVenue: u.bookings[0]?.table.venue.name ?? null,
        status: u._count.bookings > 0 ? "ACTIVE" : "NEW",
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/team", async (_req, res, next) => {
  try {
    const members = await prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: {
        id: true,
        firstName: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      ok: true,
      members: members.map((m) => ({
        id: m.id,
        name: m.fullName || m.firstName || "Admin",
        email: m.email,
        role: m.role,
        status: "ACTIVE" as const,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const teamInviteSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
});

adminRouter.post(
  "/team/invite",
  validateBody(teamInviteSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof teamInviteSchema>;
      const email = normalizeEmail(body.email);
      const name = body.name.trim();
      const firstName = name.split(/\s+/)[0] || name;

      const existing = await prisma.user.findUnique({ where: { email } });
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: {
              role: UserRole.ADMIN,
              fullName: name,
              firstName,
            },
          })
        : await prisma.user.create({
            data: {
              email,
              authProvider: AuthProvider.EMAIL,
              role: UserRole.ADMIN,
              fullName: name,
              firstName,
            },
          });

      res.status(201).json({
        ok: true,
        member: {
          id: user.id,
          name: user.fullName || user.firstName || "Admin",
          email: user.email,
          role: user.role,
          status: existing ? ("ACTIVE" as const) : ("INVITED" as const),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
