import { describe, expect, it } from "vitest";
import {
  defaultBookingOpensAt,
  isBookingOpen,
  istNineAmOn,
} from "./bookingWindow";
import {
  areasForFilter,
  nearestHyderabadArea,
} from "./hyderabadAreas";

describe("defaultBookingOpensAt", () => {
  it("unlocks Saturday tables on that week's Thursday 09:00 IST", () => {
    // 2026-09-05 is a Saturday
    const starts = new Date("2026-09-05T14:30:00.000Z"); // 20:00 IST
    const opens = defaultBookingOpensAt(starts);
    expect(opens.toISOString()).toBe(
      istNineAmOn("2026-09-05", -2).toISOString(),
    );
  });

  it("unlocks weekday tables 3 days before 09:00 IST", () => {
    // 2026-09-09 is a Wednesday
    const starts = new Date("2026-09-09T14:30:00.000Z");
    const opens = defaultBookingOpensAt(starts);
    expect(opens.toISOString()).toBe(
      istNineAmOn("2026-09-09", -3).toISOString(),
    );
  });
});

describe("isBookingOpen", () => {
  it("is false before opensAt and after startsAt", () => {
    const opens = new Date("2026-09-03T03:30:00.000Z");
    const starts = new Date("2026-09-05T14:30:00.000Z");
    expect(isBookingOpen(opens, starts, new Date("2026-09-02T00:00:00.000Z"))).toBe(
      false,
    );
    expect(isBookingOpen(opens, starts, new Date("2026-09-04T00:00:00.000Z"))).toBe(
      true,
    );
    expect(isBookingOpen(opens, starts, new Date("2026-09-06T00:00:00.000Z"))).toBe(
      false,
    );
  });
});

describe("areasForFilter", () => {
  it("returns null for ALL", () => {
    expect(areasForFilter("ALL")).toBeNull();
  });

  it("includes neighbours for Madhapur", () => {
    expect(areasForFilter("Madhapur")).toEqual([
      "Madhapur",
      "Hitech City",
      "Gachibowli",
      "Kondapur",
    ]);
  });
});

describe("nearestHyderabadArea", () => {
  it("maps a Madhapur-ish coordinate", () => {
    expect(nearestHyderabadArea(17.448, 78.391)).toBe("Madhapur");
  });
});
