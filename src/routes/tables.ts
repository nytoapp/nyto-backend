import { Router } from "express";
import {
  BookingStatus,
  GenderPreference,
  NytoTableType,
  PriceTier,
  TablePaymentType,
  TableStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { isHoldingStatus, seatsHoldingCapacity } from "../lib/bookingSeats";
import { isBookingOpen, istCalendarDate } from "../lib/bookingWindow";
import { isInstantTable } from "../lib/instantTable";
import {
  LAUNCH_CITY,
  areasForFilter,
} from "../lib/hyderabadAreas";
import {
  classifyGender,
  defaultVibeCopy,
  matchingTransparency,
} from "../lib/tableBookingRules";
import { parseTableType } from "../lib/tableType";

export const tablesRouter = Router();

const bookingSelect = {
  seatsBooked: true,
  status: true,
  createdAt: true,
  bookingType: true,
  user: { select: { gender: true } },
} as const;

type BookingRow = {
  seatsBooked: number;
  status: BookingStatus;
  createdAt: Date;
  bookingType?: string;
  user?: { gender: string | null } | null;
};

function fillCounts(bookings: BookingRow[]) {
  let women = 0;
  let men = 0;
  let other = 0;
  let coupleUnits = 0;
  for (const b of bookings) {
    if (!isHoldingStatus(b.status)) continue;
    if (b.bookingType === "COUPLE") {
      coupleUnits += Math.floor(b.seatsBooked / 2);
      continue;
    }
    const bucket = classifyGender(b.user?.gender);
    if (bucket === "WOMAN") women += b.seatsBooked;
    else if (bucket === "MAN") men += b.seatsBooked;
    else other += b.seatsBooked;
  }
  return { women, men, other, coupleUnits };
}

function formatTable(
  table: {
    id: string;
    startsAt: Date;
    bookingOpensAt: Date;
    priceTier: PriceTier;
    seatPrice: number;
    capacity: number;
    tableType: NytoTableType;
    paymentType: TablePaymentType;
    vibeCopy: string | null;
    inclusions: string[];
    genderPreference: GenderPreference;
    status: TableStatus;
    venue: {
      name: string;
      address: string;
      city: string;
      area: string | null;
    };
    bookings: BookingRow[];
  },
  now = new Date(),
) {
  const seatsTaken = seatsHoldingCapacity(table.bookings);
  const seatsLeft = Math.max(table.capacity - seatsTaken, 0);
  const bookable = isBookingOpen(table.bookingOpensAt, table.startsAt, now);
  const instant = isInstantTable(
    table.startsAt,
    seatsLeft,
    bookable,
    now,
  );
  const selectedArea =
    table.venue.area?.trim() ||
    table.venue.address.split(",")[0]?.trim() ||
    table.venue.city;
  const fill = fillCounts(table.bookings);

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
    instant,
    seatPrice: table.seatPrice,
    priceTier: table.priceTier,
    tableType: table.tableType,
    paymentType: table.paymentType,
    vibeCopy: table.vibeCopy?.trim() || defaultVibeCopy(table.tableType),
    inclusions: table.inclusions,
    matchingLine: matchingTransparency(table.tableType),
    womenConfirmed: fill.women,
    menConfirmed: fill.men,
    couplesConfirmed: fill.coupleUnits,
    slot:
      table.priceTier === PriceTier.DAYTIME
        ? "DAYTIME_LUNCH"
        : "EVENING_DINNER",
    area: selectedArea,
    venueName: table.venue.name,
    city: table.venue.city,
    womenOnly:
      table.tableType === NytoTableType.WOMEN_LED ||
      table.genderPreference === GenderPreference.WOMEN_ONLY,
    capacity: table.capacity,
    seatsTaken: Math.min(seatsTaken, table.capacity),
    seatsLeft,
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
    const priceMinRaw =
      typeof req.query.priceMin === "string"
        ? Number.parseInt(req.query.priceMin, 10)
        : NaN;
    const priceMaxRaw =
      typeof req.query.priceMax === "string"
        ? Number.parseInt(req.query.priceMax, 10)
        : NaN;
    const priceMin = Number.isFinite(priceMinRaw) ? priceMinRaw : undefined;
    const priceMax = Number.isFinite(priceMaxRaw) ? priceMaxRaw : undefined;
    const dayFilter =
      typeof req.query.day === "string" && req.query.day.trim()
        ? req.query.day.trim()
        : undefined;
    const tableType =
      parseTableType(req.query.tableType) ??
      (filter === "women_only" ? NytoTableType.WOMEN_LED : undefined);
    const paymentTypeRaw =
      typeof req.query.paymentType === "string"
        ? req.query.paymentType.trim()
        : "";
    const paymentType =
      paymentTypeRaw === "ALL_INCLUSIVE" || paymentTypeRaw === "PAY_OWN_BILL"
        ? paymentTypeRaw
        : undefined;

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
        ...(tableType ? { tableType } : {}),
        ...(paymentType ? { paymentType } : {}),
        ...(priceMin != null ? { seatPrice: { gte: priceMin } } : {}),
        ...(priceMax != null
          ? {
              seatPrice: {
                ...(priceMin != null ? { gte: priceMin } : {}),
                lte: priceMax,
              },
            }
          : {}),
        venue: {
          isActive: true,
          city: { equals: city, mode: "insensitive" },
          ...(areaList ? { area: { in: areaList } } : {}),
        },
      },
      include: {
        venue: true,
        bookings: { select: bookingSelect },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
    });

    const dayScoped = dayFilter
      ? tables.filter((t) => istCalendarDate(t.startsAt) === dayFilter)
      : tables;

    const nextUnlock = dayScoped
      .filter((t) => t.bookingOpensAt > now)
      .map((t) => t.bookingOpensAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    res.json({
      ok: true,
      city,
      area: areaRaw || "ALL",
      nextBookingOpensAt: nextUnlock?.toISOString() ?? null,
      tables: dayScoped.map((t) => formatTable(t, now)),
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
        bookings: { select: bookingSelect },
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
