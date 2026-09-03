import { describe, expect, it } from "vitest";
import { BookingStatus } from "@prisma/client";
import {
  PENDING_PAYMENT_TTL_MS,
  seatsHoldingCapacity,
} from "./bookingSeats";
import { moneyFor } from "./pricing";
import { generateCheckInCode } from "./checkInCode";

describe("seatsHoldingCapacity", () => {
  const now = new Date("2026-09-03T12:00:00.000Z");

  it("counts confirmed and attended", () => {
    expect(
      seatsHoldingCapacity(
        [
          { seatsBooked: 2, status: BookingStatus.CONFIRMED },
          { seatsBooked: 1, status: BookingStatus.ATTENDED },
        ],
        now,
      ),
    ).toBe(3);
  });

  it("counts fresh pending holds only", () => {
    expect(
      seatsHoldingCapacity(
        [
          {
            seatsBooked: 2,
            status: BookingStatus.PENDING_PAYMENT,
            createdAt: new Date(now.getTime() - 5 * 60 * 1000),
          },
          {
            seatsBooked: 3,
            status: BookingStatus.PENDING_PAYMENT,
            createdAt: new Date(now.getTime() - PENDING_PAYMENT_TTL_MS - 1000),
          },
          { seatsBooked: 1, status: BookingStatus.CANCELLED },
        ],
        now,
      ),
    ).toBe(2);
  });
});

describe("moneyFor", () => {
  it("applies 5% GST", () => {
    expect(moneyFor(1000, 2)).toEqual({
      seatSubtotal: 2000,
      gst: 100,
      total: 2100,
    });
  });
});

describe("generateCheckInCode", () => {
  it("returns fixed length uppercase code", () => {
    const code = generateCheckInCode(8);
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-Z0-9]+$/);
  });
});
