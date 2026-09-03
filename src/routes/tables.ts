import { Router } from "express";
import {
  BookingStatus,
  GenderPreference,
  PriceTier,
  TableStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { seatsHoldingCapacity } from "../lib/bookingSeats";
import { isBookingOpen } from "../lib/bookingWindow";
import {
  LAUNCH_CITY,
  areasForFilter,
} from "../lib/hyderabadAreas";

export const tablesRouter = Router();

function formatTable(
  table: {
    id: string;
    startsAt: Date;
    bookingOpensAt: Date;
    priceTier: PriceTier;
    seatPrice: number;
    capacity: number;
    genderPreference: GenderPreference;
    status: TableStatus;
    venue: {
      name: string;
      address: string;
      city: string;
      area: string | null;
    };
    bookings: { seatsBooked: number; status: BookingStatus; createdAt: Date }[];
  },
  now = new Date(),
) {
  const seatsTaken = seatsHoldingCapacity(table.bookings);
  const bookable = isBookingOpen(table.bookingOpensAt, table.startsAt, now);
  const selectedArea =
    table.venue.area?.trim() ||
    table.venue.address.split(",")[0]?.trim() ||
    table.venue.city;

  const weekday = table.startsAt.toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "Asia/Kolkata",
  });
  const dateLabel = table.startsAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const timeLabel = table.startsAt
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    })
    .toLowerCase();

  return {
    id: table.id,
    weekday,
    dateLabel,
    timeLabel,
    startsAt: table.startsAt.toISOString(),
    bookingOpensAt: table.bookingOpensAt.toISOString(),
    bookable,
    seatPrice: table.seatPrice,
    priceTier: table.priceTier,
    slot:
      table.priceTier === PriceTier.DAYTIME
        ? "DAYTIME_LUNCH"
        : "EVENING_DINNER",
    area: selectedArea,
    venueName: table.venue.name,
    city: table.venue.city,
    womenOnly: table.genderPreference === GenderPreference.WOMEN_ONLY,
    capacity: table.capacity,
    seatsTaken: Math.min(seatsTaken, table.capacity),
    seatsLeft: Math.max(table.capacity - seatsTaken, 0),
    status: table.status,
  };
}

tablesRouter.get("/", async (req, res, next) => {
  try {
    const filter = String(req.query.filter ?? "this_week");
    const city =
      typeof req.query.city === "string" && req.query.city.trim()
        ? req.query.city.trim()
        : LAUNCH_CITY;
    const areaRaw =
      typeof req.query.area === "string" ? req.query.area.trim() : "ALL";
    const includeNearby =
      req.query.nearby === "0" || req.query.nearby === "false" ? false : true;

    const areaList = includeNearby
      ? areasForFilter(areaRaw)
      : areaRaw && areaRaw !== "ALL"
        ? [areaRaw]
        : null;

    const now = new Date();
    const tables = await prisma.supperTable.findMany({
      where: {
        status: { in: [TableStatus.OPEN, TableStatus.MATCHING] },
        startsAt: { gte: now },
        ...(filter === "daytime" ? { priceTier: PriceTier.DAYTIME } : {}),
        ...(filter === "evening" ? { priceTier: PriceTier.EVENING } : {}),
        ...(filter === "women_only"
          ? { genderPreference: GenderPreference.WOMEN_ONLY }
          : {}),
        venue: {
          isActive: true,
          city: { equals: city, mode: "insensitive" },
          ...(areaList ? { area: { in: areaList } } : {}),
        },
      },
      include: {
        venue: true,
        bookings: {
          select: { seatsBooked: true, status: true, createdAt: true },
        },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
    });

    const nextUnlock = tables
      .filter((t) => t.bookingOpensAt > now)
      .map((t) => t.bookingOpensAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    res.json({
      ok: true,
      city,
      area: areaRaw || "ALL",
      nextBookingOpensAt: nextUnlock?.toISOString() ?? null,
      tables: tables.map((t) => formatTable(t, now)),
    });
  } catch (err) {
    next(err);
  }
});

tablesRouter.get("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const table = await prisma.supperTable.findUnique({
      where: { id },
      include: {
        venue: true,
        menu: true,
        bookings: {
          select: { seatsBooked: true, status: true, createdAt: true },
        },
        members: true,
      },
    });

    if (!table) {
      res.status(404).json({ error: "Table not found" });
      return;
    }

    const formatted = formatTable(table);
    res.json({
      ok: true,
      table: {
        ...formatted,
        icebreakers: table.icebreakers,
        menu: table.menu
          ? {
              id: table.menu.id,
              name: table.menu.name,
              description: table.menu.description,
              dietaryType: table.menu.dietaryType,
            }
          : null,
        venue: table.venue,
      },
    });
  } catch (err) {
    next(err);
  }
});
