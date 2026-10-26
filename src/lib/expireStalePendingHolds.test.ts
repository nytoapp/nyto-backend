import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import { PENDING_PAYMENT_TTL_MS } from "./bookingSeats";

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    booking: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    payment: {
      updateMany: vi.fn(),
    },
  };
  return { prismaMock };
});

vi.mock("./prisma", () => ({ prisma: prismaMock }));

import {
  HOLD_EXPIRED_REASON,
  expireStalePendingHolds,
} from "./expireStalePendingHolds";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("expireStalePendingHolds", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");

  it("no-ops when nothing is stale", async () => {
    prismaMock.booking.findMany.mockResolvedValue([]);
    const result = await expireStalePendingHolds({ now });
    expect(result).toEqual({ expiredCount: 0 });
    expect(prismaMock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("cancels stale holds and fails pending payments", async () => {
    prismaMock.booking.findMany.mockResolvedValue([{ id: "b1" }, { id: "b2" }]);
    prismaMock.booking.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });

    const result = await expireStalePendingHolds({
      tableId: "t1",
      now,
    });

    expect(result.expiredCount).toBe(2);
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith({
      where: {
        status: BookingStatus.PENDING_PAYMENT,
        createdAt: { lt: new Date(now.getTime() - PENDING_PAYMENT_TTL_MS) },
        tableId: "t1",
      },
      select: { id: true },
    });
    expect(prismaMock.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["b1", "b2"] },
        status: BookingStatus.PENDING_PAYMENT,
      },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: now,
        cancelReason: HOLD_EXPIRED_REASON,
      },
    });
    expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
      where: {
        bookingId: { in: ["b1", "b2"] },
        status: PaymentStatus.PENDING,
      },
      data: { status: PaymentStatus.FAILED },
    });
  });
});
