import { BookingType, NytoTableType } from "@prisma/client";

export type GenderBucket = "WOMAN" | "MAN" | "OTHER";

export function classifyGender(
  gender: string | null | undefined,
): GenderBucket {
  const s = (gender ?? "").trim().toLowerCase();
  if (["woman", "women", "female", "f", "girl"].includes(s)) return "WOMAN";
  if (["man", "men", "male", "m", "boy"].includes(s)) return "MAN";
  return "OTHER";
}

export function matchingTransparency(tableType: NytoTableType): string {
  if (tableType === NytoTableType.SINGLES) {
    return "This table welcomes all identities and orientations.";
  }
  return "Matched by age, interests, and personality.";
}

export function defaultVibeCopy(tableType: NytoTableType): string {
  switch (tableType) {
    case NytoTableType.WOMEN_LED:
      return "A women-led table — same warmth, a room that starts with her.";
    case NytoTableType.COUPLES:
      return "Three couples. One long table. Conversation for two, then six.";
    case NytoTableType.SINGLES:
      return "Six seats, live mix. Come as you are.";
    default:
      return "Six strangers. One table. Nothing left to figure out.";
  }
}

export type BookingRuleInput = {
  tableType: NytoTableType;
  bookingType: BookingType | string;
  seatsBooked: number;
  seatsLeft: number;
  userGender?: string | null;
  womenHolding?: number;
  menHolding?: number;
};

export function assertBookingAllowed(input: BookingRuleInput): void {
  const type = input.tableType;
  const bookingType = String(input.bookingType);
  const seats = input.seatsBooked;

  if (seats < 1) throw new Error("At least 1 seat is required");
  if (seats > input.seatsLeft) throw new Error("Not enough seats left on this table");

  if (type === NytoTableType.SINGLES) {
    if (bookingType !== BookingType.SOLO && bookingType !== "SOLO") {
      throw new Error("Singles tables are solo booking only");
    }
    if (seats !== 1) throw new Error("Singles tables are 1 seat only");
    const bucket = classifyGender(input.userGender);
    const women = input.womenHolding ?? 0;
    const men = input.menHolding ?? 0;
    if (bucket === "WOMAN" && women >= 3) {
      throw new Error("This Singles table already has 3 women confirmed");
    }
    if (bucket === "MAN" && men >= 3) {
      throw new Error("This Singles table already has 3 men confirmed");
    }
    return;
  }

  if (type === NytoTableType.COUPLES) {
    if (bookingType !== BookingType.COUPLE && bookingType !== "COUPLE") {
      throw new Error("Couples tables book as one couple (2 seats)");
    }
    if (seats !== 2) throw new Error("A couple booking is exactly 2 seats");
    if (input.seatsLeft < 2) {
      throw new Error("No couple seats left on this table");
    }
    return;
  }

  if (type === NytoTableType.WOMEN_LED) {
    if (classifyGender(input.userGender) !== "WOMAN") {
      throw new Error("Women-Led tables are for verified women only");
    }
  }

  // Weekly + Women-Led: Solo or group of 2–3. Private full-table (6) is deferred.
  if (bookingType === BookingType.SOLO || bookingType === "SOLO") {
    if (seats !== 1) throw new Error("Solo booking must be 1 seat");
    return;
  }
  if (bookingType === BookingType.GROUP || bookingType === "GROUP") {
    if (seats < 2 || seats > 3) {
      throw new Error("Group booking must be 2 or 3 seats");
    }
    return;
  }

  throw new Error("This table does not accept that booking type");
}
