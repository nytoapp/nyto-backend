import { Router } from "express";
import {
  BookingStatus,
  GenderPreference,
  PriceTier,
  TableStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";

export const tablesRouter = Router();

function formatTable(table: {
  id: string;
  startsAt: Date;
  priceTier: PriceTier;
  seatPrice: number;
  capacity: number;
  genderPreference: GenderPreference;
  status: TableStatus;
  venue: { name: string; address: string; city: string };
  bookings: { seatsBooked: number; status: BookingStatus }[];
}) {
  const seatsTaken = table.bookings
    .filter((b) =>
      b.status === BookingStatus.CONFIRMED ||
      b.status === BookingStatus.ATTENDED ||
      b.status === BookingStatus.PENDING_PAYMENT
    )
    .reduce((sum, b) => sum + b.seatsBooked, 0);

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

  const area = table.venue.address.split(",")[0]?.trim() || table.venue.city;

  return {
    id: table.id,
    weekday,
    dateLabel,
    timeLabel,
    startsAt: table.startsAt.toISOString(),
    seatPrice: table.seatPrice,
    priceTier: table.priceTier,
    slot: table.priceTier === PriceTier.DAYTIME ? "DAYTIME_LUNCH" : "EVENING_DINNER",
    area,
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

    const now = new Date();
    const where: {
      status: { in: TableStatus[] };
      startsAt: { gte: Date };
      priceTier?: PriceTier;
      genderPreference?: GenderPreference;
    } = {
      status: { in: [TableStatus.OPEN, TableStatus.MATCHING] },
      startsAt: { gte: now },
    };

    if (filter === "daytime") where.priceTier = PriceTier.DAYTIME;
    if (filter === "evening") where.priceTier = PriceTier.EVENING;
    if (filter === "women_only") {
      where.genderPreference = GenderPreference.WOMEN_ONLY;
    }

    const tables = await prisma.supperTable.findMany({
      where,
      include: {
        venue: true,
        bookings: {
          select: { seatsBooked: true, status: true },
        },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
    });

    res.json({
      ok: true,
      tables: tables.map(formatTable),
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
        bookings: { select: { seatsBooked: true, status: true } },
        members: true,
      },
    });

    if (!table) {
      res.status(404).json({ error: "Table not found" });
      return;
    }

    res.json({
      ok: true,
      table: {
        ...formatTable(table),
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
