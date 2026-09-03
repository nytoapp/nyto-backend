import { BookingType, NytoTableType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  assertBookingAllowed,
  classifyGender,
  matchingTransparency,
} from "./tableBookingRules";

describe("classifyGender", () => {
  it("maps common woman labels", () => {
    expect(classifyGender("Woman")).toBe("WOMAN");
    expect(classifyGender("female")).toBe("WOMAN");
  });
  it("maps common man labels", () => {
    expect(classifyGender("Man")).toBe("MAN");
  });
  it("does not invent identity for other values", () => {
    expect(classifyGender("prefer not to say")).toBe("OTHER");
    expect(classifyGender(null)).toBe("OTHER");
  });
});

describe("assertBookingAllowed", () => {
  it("allows weekly solo", () => {
    expect(() =>
      assertBookingAllowed({
        tableType: NytoTableType.WEEKLY,
        bookingType: BookingType.SOLO,
        seatsBooked: 1,
        seatsLeft: 6,
      }),
    ).not.toThrow();
  });

  it("rejects women-led for men", () => {
    expect(() =>
      assertBookingAllowed({
        tableType: NytoTableType.WOMEN_LED,
        bookingType: BookingType.SOLO,
        seatsBooked: 1,
        seatsLeft: 6,
        userGender: "Man",
      }),
    ).toThrow(/women/i);
  });

  it("rejects private 6-seat group (deferred)", () => {
    expect(() =>
      assertBookingAllowed({
        tableType: NytoTableType.WOMEN_LED,
        bookingType: BookingType.GROUP,
        seatsBooked: 6,
        seatsLeft: 6,
        userGender: "Woman",
      }),
    ).toThrow(/2 or 3/);
  });

  it("requires couple bookings of 2 seats", () => {
    expect(() =>
      assertBookingAllowed({
        tableType: NytoTableType.COUPLES,
        bookingType: BookingType.COUPLE,
        seatsBooked: 1,
        seatsLeft: 6,
      }),
    ).toThrow(/2 seats/);
  });

  it("rejects singles group booking", () => {
    expect(() =>
      assertBookingAllowed({
        tableType: NytoTableType.SINGLES,
        bookingType: BookingType.GROUP,
        seatsBooked: 2,
        seatsLeft: 6,
        userGender: "Woman",
      }),
    ).toThrow(/solo/i);
  });

  it("blocks a 4th woman on singles", () => {
    expect(() =>
      assertBookingAllowed({
        tableType: NytoTableType.SINGLES,
        bookingType: BookingType.SOLO,
        seatsBooked: 1,
        seatsLeft: 3,
        userGender: "Woman",
        womenHolding: 3,
        menHolding: 0,
      }),
    ).toThrow(/3 women/);
  });
});

describe("matchingTransparency", () => {
  it("uses inclusive copy for singles", () => {
    expect(matchingTransparency(NytoTableType.SINGLES)).toMatch(/welcomes/i);
  });
});
