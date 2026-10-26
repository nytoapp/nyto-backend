/**
 * DB integration — requires PostgreSQL + DATABASE_URL.
 * Skips cleanly when the DB is unreachable.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  AuthProvider,
  BookingStatus,
  BookingType,
  NytoTableType,
  PriceTier,
  TablePaymentType,
  TableStatus,
  UserRole,
  VenueHostedBy,
} from "@prisma/client";
import { prisma } from "./prisma";
import { seatsHoldingCapacity } from "./bookingSeats";
import { lockSupperTableForInventory } from "./tableInventoryLock";

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

describe("table inventory lock (integration)", () => {
  const ids = {
    venueId: "",
    tableId: "",
    userA: "",
    userB: "",
  };

  afterAll(async () => {
    if (!ids.tableId) {
      await prisma.$disconnect();
      return;
    }
    await prisma.booking.deleteMany({ where: { tableId: ids.tableId } });
    await prisma.supperTable.deleteMany({ where: { id: ids.tableId } });
    if (ids.venueId) {
      await prisma.venue.deleteMany({ where: { id: ids.venueId } });
    }
    const userIds = [ids.userA, ids.userB].filter(Boolean);
    if (userIds.length) {
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("allows only one concurrent hold for the last seat", async () => {
    if (!(await dbReachable())) {
      console.warn("Skipping inventory lock integration — DB unreachable");
      return;
    }

    const stamp = Date.now();
    const venue = await prisma.venue.create({
      data: {
        name: `Lock Test Venue ${stamp}`,
        address: "Test",
        city: "Hyderabad",
        area: "Ameerpet",
        hostedBy: VenueHostedBy.NYTO,
      },
    });
    ids.venueId = venue.id;

    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const table = await prisma.supperTable.create({
      data: {
        venueId: venue.id,
        startsAt,
        bookingOpensAt: new Date(Date.now() - 60_000),
        priceTier: PriceTier.EVENING,
        seatPrice: 999,
        capacity: 1,
        tableType: NytoTableType.WEEKLY,
        paymentType: TablePaymentType.ALL_INCLUSIVE,
        status: TableStatus.OPEN,
        inclusions: ["Test"],
      },
    });
    ids.tableId = table.id;

    const userA = await prisma.user.create({
      data: {
        email: `lock-a-${stamp}@nyto.test`,
        role: UserRole.USER,
        authProvider: AuthProvider.EMAIL,
        fullName: "Lock A",
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `lock-b-${stamp}@nyto.test`,
        role: UserRole.USER,
        authProvider: AuthProvider.EMAIL,
        fullName: "Lock B",
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;

    async function tryHold(userId: string): Promise<"ok" | "full"> {
      try {
        await prisma.$transaction(async (tx) => {
          await lockSupperTableForInventory(tx, table.id);
          const peers = await tx.booking.findMany({
            where: { tableId: table.id },
            select: { seatsBooked: true, status: true, createdAt: true },
          });
          const taken = seatsHoldingCapacity(peers);
          if (taken + 1 > 1) {
            throw new Error("FULL");
          }
          await tx.booking.create({
            data: {
              userId,
              tableId: table.id,
              bookingType: BookingType.SOLO,
              seatsBooked: 1,
              status: BookingStatus.PENDING_PAYMENT,
            },
          });
        });
        return "ok";
      } catch (err) {
        if (err instanceof Error && err.message === "FULL") return "full";
        throw err;
      }
    }

    const results = await Promise.all([tryHold(userA.id), tryHold(userB.id)]);
    const okCount = results.filter((r) => r === "ok").length;
    const fullCount = results.filter((r) => r === "full").length;

    expect(okCount).toBe(1);
    expect(fullCount).toBe(1);

    const holds = await prisma.booking.count({
      where: {
        tableId: table.id,
        status: BookingStatus.PENDING_PAYMENT,
      },
    });
    expect(holds).toBe(1);
  });
});
