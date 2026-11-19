import { TableStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isOpenForNewSeats } from "./tableInventoryStatus";

describe("isOpenForNewSeats", () => {
  it("keeps revealed nights bookable while seats remain", () => {
    expect(isOpenForNewSeats(TableStatus.OPEN)).toBe(true);
    expect(isOpenForNewSeats(TableStatus.MATCHING)).toBe(true);
    expect(isOpenForNewSeats(TableStatus.REVEALED)).toBe(true);
  });

  it("does not reopen a cancelled or completed night", () => {
    expect(isOpenForNewSeats(TableStatus.CANCELLED)).toBe(false);
    expect(isOpenForNewSeats(TableStatus.COMPLETED)).toBe(false);
  });
});
