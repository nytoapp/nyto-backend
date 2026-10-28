import { BookingStatus, TableStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { AppError } from "../middleware/errorHandler";
import { parseLegacyMenuDescription } from "./menuMeta";

/** Product: mates unlock ~24h before the night starts. */
export const REVEAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isRevealEligible(startsAt: Date, now = new Date()): boolean {
  return startsAt.getTime() - now.getTime() <= REVEAL_WINDOW_MS;
}

function courseLines(description: string | null | undefined): string[] {
  const parsed = parseLegacyMenuDescription(description);
  if (parsed.body.trim()) {
    return parsed.body
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

/**
 * Guest reveal payload for a paid booking. Lazily marks the table REVEALED
 * once inside the 24h window.
 */
export async function getBookingReveal(input: {
  bookingId: string;
  userId: string;
}) {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      table: {
        include: {
          venue: true,
          menu: true,
          bookings: {
            where: {
              status: {
                in: [
                  BookingStatus.CONFIRMED,
                  BookingStatus.ATTENDED,
                  BookingStatus.NO_SHOW,
                ],
              },
            },
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  fullName: true,
                  gender: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.userId !== input.userId) throw new AppError("Forbidden", 403);
  if (
    booking.status !== BookingStatus.CONFIRMED &&
    booking.status !== BookingStatus.ATTENDED &&
    booking.status !== BookingStatus.NO_SHOW
  ) {
    throw new AppError("Reveal is only for paid seats", 409);
  }

  const eligible = isRevealEligible(booking.table.startsAt);
  let table = booking.table;

  if (
    eligible &&
    table.status !== TableStatus.CANCELLED &&
    table.status !== TableStatus.COMPLETED &&
    (!table.revealedAt || table.status !== TableStatus.REVEALED)
  ) {
    table = await prisma.supperTable.update({
      where: { id: table.id },
      data: {
        status: TableStatus.REVEALED,
        revealedAt: table.revealedAt ?? new Date(),
      },
      include: {
        venue: true,
        menu: true,
        bookings: {
          where: {
            status: {
              in: [
                BookingStatus.CONFIRMED,
                BookingStatus.ATTENDED,
                BookingStatus.NO_SHOW,
              ],
            },
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                fullName: true,
                gender: true,
              },
            },
          },
        },
      },
    });
  }

  const mates = eligible
    ? table.bookings
        .filter((b) => b.userId !== input.userId)
        .map((b) => {
          const first =
            b.user.firstName?.trim() ||
            b.user.fullName?.trim().split(/\s+/)[0] ||
            "Guest";
          const area = table.venue.area?.trim() || table.venue.city;
          return {
            label: `${first} · ${area}`,
            userId: b.user.id,
          };
        })
    : [];

  const menuCourses = courseLines(table.menu?.description);
  const msUntil = Math.max(table.startsAt.getTime() - Date.now(), 0);

  return {
    revealed: eligible,
    revealOpensAt: new Date(
      table.startsAt.getTime() - REVEAL_WINDOW_MS,
    ).toISOString(),
    startsAt: table.startsAt.toISOString(),
    msUntilStart: msUntil,
    tableId: table.id,
    tableStatus: table.status,
    revealedAt: table.revealedAt?.toISOString() ?? null,
    venue: {
      id: table.venue.id,
      name: table.venue.name,
      area: table.venue.area,
      city: table.venue.city,
      address: table.venue.address,
    },
    menu: table.menu
      ? {
          id: table.menu.id,
          name: table.menu.name,
          dietaryType: table.menu.dietaryType,
          courses: menuCourses,
        }
      : null,
    mates,
    bookingStatus: booking.status,
  };
}
