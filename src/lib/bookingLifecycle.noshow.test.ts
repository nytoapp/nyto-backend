import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus } from "@prisma/client";
import { AppError } from "../middleware/errorHandler";

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    booking: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    supperTable: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  return { prismaMock };
});

vi.mock("./prisma", () => ({ prisma: prismaMock }));
vi.mock("./opsEvents", () => ({
  emitBookingCancelled: vi.fn(),
  emitDoorCheckedIn: vi.fn(),
  emitInventorySeats: vi.fn(),
}));
vi.mock("./paymentRefund", () => ({
  claimAndRefundPayment: vi.fn(),
}));

import { markNoShowAsAdmin } from "./bookingLifecycle";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("markNoShowAsAdmin", () => {
  it("rejects before night start", async () => {
    prismaMock.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: BookingStatus.CONFIRMED,
      tableId: "t1",
      table: { startsAt: new Date(Date.now() + 60_000) },
      payment: null,
    });
    await expect(markNoShowAsAdmin("b1")).rejects.toBeInstanceOf(AppError);
  });

  it("rejects non-confirmed", async () => {
    prismaMock.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: BookingStatus.ATTENDED,
      tableId: "t1",
      table: { startsAt: new Date(Date.now() - 60_000) },
      payment: null,
    });
    await expect(markNoShowAsAdmin("b1")).rejects.toBeInstanceOf(AppError);
  });

  it("marks confirmed after start", async () => {
    prismaMock.booking.findUnique.mockResolvedValue({
      id: "b1",
      status: BookingStatus.CONFIRMED,
      tableId: "t1",
      table: { startsAt: new Date(Date.now() - 60_000), venueId: "v1" },
      payment: null,
    });
    prismaMock.booking.update.mockResolvedValue({
      id: "b1",
      status: BookingStatus.NO_SHOW,
    });
    prismaMock.supperTable.findUnique.mockResolvedValue(null);

    const result = await markNoShowAsAdmin("b1");
    expect(result).toMatchObject({ status: BookingStatus.NO_SHOW });
    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: expect.objectContaining({ status: BookingStatus.NO_SHOW }),
      }),
    );
  });
});
