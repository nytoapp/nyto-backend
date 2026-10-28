import { Router } from "express";
import {
  DietaryPreference,
  GenderPreference,
  MenuPublishStatus,
  NytoTableType,
  PriceTier,
  SupportCategory,
  SupportSource,
  SupportStatus,
  TablePaymentType,
  TableStatus,
  UserRole,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { seatsHoldingCapacity } from "../lib/bookingSeats";
import {
  cancelTableAsAdmin,
  checkInByCode,
} from "../lib/bookingLifecycle";
import { defaultBookingOpensAt } from "../lib/bookingWindow";
import { genderPreferenceForTableType } from "../lib/tableType";
import {
  paidSeatsForRun,
  venueMayCancelUnderfill,
} from "../lib/tableUnderfill";
import {
  requireAuth,
  requireRoles,
  requireVenueAccess,
  type AuthedRequest,
} from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { validateBody } from "../middleware/validate";
import { assertVenuePortalCanPublish } from "../lib/venueHostedBy";
import { expireStalePendingHolds } from "../lib/expireStalePendingHolds";

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
  tableType: z.enum(["WEEKLY", "WOMEN_LED", "COUPLES", "SINGLES"]).optional(),
  paymentType: z.enum(["ALL_INCLUSIVE", "PAY_OWN_BILL"]).optional(),
  vibeCopy: z.string().trim().max(180).optional(),
  inclusions: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
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
  tableType: z.enum(["WEEKLY", "WOMEN_LED", "COUPLES", "SINGLES"]).optional(),
  paymentType: z.enum(["ALL_INCLUSIVE", "PAY_OWN_BILL"]).optional(),
  vibeCopy: z.string().trim().max(180).nullable().optional(),
  inclusions: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  icebreakers: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  /** Venue may open/cancel upcoming inventory only — not destroy paid nights casually. */
  status: z.enum(["OPEN", "CANCELLED"]).optional(),
});

const tableTypeEnum = z.enum(["WEEKLY", "WOMEN_LED", "COUPLES", "SINGLES"]);

const menuCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  dietaryType: z.enum(["VEGETARIAN", "NON_VEGETARIAN", "VEGAN"]),
  costPerHead: z.number().int().min(0),
  publishStatus: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  categories: z.array(tableTypeEnum).max(4).optional(),
});

const menuPatchSchema = menuCreateSchema.partial();

const supportCreateSchema = z.object({
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
      const venue = await prisma.venue.findUnique({ where: { id: venueId } });
      if (!venue) throw new AppError("Venue not found", 404);
      assertVenuePortalCanPublish(venue);

      const menu = await prisma.venueMenu.create({
        data: {
          venueId,
          name: body.name,
          description: body.description,
          dietaryType: body.dietaryType as DietaryPreference,
          costPerHead: body.costPerHead,
          publishStatus:
            (body.publishStatus as MenuPublishStatus | undefined) ??
            MenuPublishStatus.DRAFT,
          categories: (body.categories as NytoTableType[] | undefined) ?? [],
        },
      });
      res.status(201).json({ ok: true, menu });
    } catch (err) {
      next(err);
    }
  },
);

venueRouter.patch(
  "/:venueId/menus/:menuId",
  requireVenueAccess("params", "venueId"),
  validateBody(menuPatchSchema),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const menuId = String(req.params.menuId);
      const body = req.body as z.infer<typeof menuPatchSchema>;
      const venue = await prisma.venue.findUnique({ where: { id: venueId } });
      if (!venue) throw new AppError("Venue not found", 404);
      assertVenuePortalCanPublish(venue);

      const existing = await prisma.venueMenu.findFirst({
        where: { id: menuId, venueId },
      });
      if (!existing) throw new AppError("Menu not found", 404);

      const menu = await prisma.venueMenu.update({
        where: { id: menuId },
        data: {
          name: body.name,
          description: body.description,
          dietaryType: body.dietaryType as DietaryPreference | undefined,
          costPerHead: body.costPerHead,
          publishStatus: body.publishStatus as MenuPublishStatus | undefined,
          categories: body.categories as NytoTableType[] | undefined,
        },
      });
      res.json({ ok: true, menu });
    } catch (err) {
      next(err);
    }
  },
);

venueRouter.get(
  "/:venueId/support",
  requireVenueAccess("params", "venueId"),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const tickets = await prisma.supportTicket.findMany({
        where: { venueId, source: SupportSource.VENUE },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json({ ok: true, tickets });
    } catch (err) {
      next(err);
    }
  },
);

venueRouter.post(
  "/:venueId/support",
  requireVenueAccess("params", "venueId"),
  validateBody(supportCreateSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      const body = req.body as z.infer<typeof supportCreateSchema>;
      const ticket = await prisma.supportTicket.create({
        data: {
          source: SupportSource.VENUE,
          venueId,
          staffUserId: req.userId!,
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

venueRouter.get(
  "/:venueId/tables",
  requireVenueAccess("params", "venueId"),
  async (req, res, next) => {
    try {
      const venueId = String(req.params.venueId);
      await expireStalePendingHolds({ venueId });
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
          const paidSeats = paidSeatsForRun(t.bookings);
          return {
            id: t.id,
            venueId: t.venueId,
            startsAt: t.startsAt,
            priceTier: t.priceTier,
            seatPrice: t.seatPrice,
            capacity: t.capacity,
            status: t.status,
            genderPreference: t.genderPreference,
            tableType: t.tableType,
            paymentType: t.paymentType,
            vibeCopy: t.vibeCopy,
            inclusions: t.inclusions ?? [],
            menu: t.menu
              ? {
                  id: t.menu.id,
                  name: t.menu.name,
                  description: t.menu.description,
                  dietaryType: t.menu.dietaryType,
                }
              : null,
            seatsTaken,
            seatsLeft: Math.max(t.capacity - seatsTaken, 0),
            paidSeats,
            /** Below min-to-run (3) — Instant fill boost + venue may cancel/refund. */
            underfilled: paidSeats < 3,
            minSeatsToRun: 3,
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
      const venue = await prisma.venue.findUnique({ where: { id: venueId } });
      if (!venue) throw new AppError("Venue not found", 404);
      assertVenuePortalCanPublish(venue);

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

      await expireStalePendingHolds({ tableId });

      const existing = await prisma.supperTable.findFirst({
        where: { id: tableId, venueId },
        include: {
          bookings: {
            where: {
              status: { in: ["CONFIRMED", "ATTENDED", "PENDING_PAYMENT"] },
            },
            select: { id: true, status: true, seatsBooked: true },
          },
        },
      });
      if (!existing) throw new AppError("Table not found", 404);

      if (body.status === "CANCELLED") {
        const paidSeats = paidSeatsForRun(existing.bookings);
        const hasAttended = existing.bookings.some(
          (b) => b.status === "ATTENDED",
        );
        const hasPaid = existing.bookings.some(
          (b) => b.status === "CONFIRMED" || b.status === "ATTENDED",
        );

        /**
         * Underfill cancel: paid seats < 3 → venue may cancel + refund
         * (same path as admin). Otherwise paid nights stay admin-only.
         */
        if (hasPaid) {
          if (
            !venueMayCancelUnderfill({
              paidSeats,
              hasAttended,
            })
          ) {
            throw new AppError(
              "Cannot cancel — table has 3+ paid seats (or guests checked in). Contact NYTO admin.",
              409,
            );
          }
          const result = await cancelTableAsAdmin(
            tableId,
            "Venue cancelled — fewer than 3 paid seats (underfill)",
          );
          return res.json({
            ok: true,
            table: result.table,
            underfillCancel: true,
            cancelledBookings: result.cancelledBookings,
            refundedPayments: result.refundedPayments,
          });
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
              tableType: true,
              paymentType: true,
              vibeCopy: true,
              capacity: true,
              menu: { select: { id: true, name: true } },
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
          table: {
            id: b.table.id,
            startsAt: b.table.startsAt,
            status: b.table.status,
            seatPrice: b.table.seatPrice,
            tableType: b.table.tableType,
            paymentType: b.table.paymentType,
            vibeCopy: b.table.vibeCopy,
            capacity: b.table.capacity,
            menuName: b.table.menu?.name ?? null,
            menuId: b.table.menu?.id ?? null,
          },
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
