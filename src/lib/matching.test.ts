import { NytoTableType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertSeatingMatch, pairFit } from "./matching";

const calm = {
  conversationStyle: "calm",
  socialEnergy: "introverted",
  interests: ["books", "food"],
  dateOfBirth: new Date("1996-04-01"),
};

const lively = {
  conversationStyle: "lively",
  socialEnergy: "extroverted",
  interests: ["clubbing", "sport"],
  dateOfBirth: new Date("1998-04-01"),
};

describe("pairFit", () => {
  it("scores shared signals higher than a clash", () => {
    const same = pairFit(calm, { ...calm, interests: ["books", "walks"] });
    const clash = pairFit(calm, lively);
    expect(same.score).toBeGreaterThan(clash.score);
  });
});

describe("assertSeatingMatch", () => {
  it("lets the first person sit", () => {
    expect(() =>
      assertSeatingMatch({
        tableType: NytoTableType.WEEKLY,
        me: calm,
        peers: [],
      }),
    ).not.toThrow();
  });

  it("blocks a clear weekly mismatch", () => {
    expect(() =>
      assertSeatingMatch({
        tableType: NytoTableType.WEEKLY,
        me: calm,
        peers: [lively],
      }),
    ).toThrow(/different group/);
  });

  it("blocks singles outside the age band", () => {
    expect(() =>
      assertSeatingMatch({
        tableType: NytoTableType.SINGLES,
        me: { dateOfBirth: new Date("2002-01-01") },
        peers: [{ dateOfBirth: new Date("1980-01-01") }],
        now: new Date("2026-09-08"),
      }),
    ).toThrow(/age band|years/i);
  });
});
