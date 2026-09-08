import { NytoTableType } from "@prisma/client";
import { env } from "../config/env";

export type MatchPerson = {
  dateOfBirth?: Date | null;
  interests?: string[];
  socialEnergy?: string | null;
  conversationStyle?: string | null;
};

export function ageYears(dob: Date, now = new Date()): number {
  let age = now.getFullYear() - dob.getFullYear();
  const month = now.getMonth() - dob.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

function sharedCount(a: string[] = [], b: string[] = []): number {
  const set = new Set(a);
  return b.filter((item) => set.has(item)).length;
}

function styleClash(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return (
    (a === "calm" && b === "lively") || (a === "lively" && b === "calm")
  );
}

/** 0–1 fit between two people. compared = how many signals we could use. */
export function pairFit(
  a: MatchPerson,
  b: MatchPerson,
  now = new Date(),
): { score: number; compared: number } {
  let points = 0;
  let compared = 0;

  const aInterests = a.interests ?? [];
  const bInterests = b.interests ?? [];
  if (aInterests.length > 0 && bInterests.length > 0) {
    compared += 1;
    points += sharedCount(aInterests, bInterests) > 0 ? 1 : 0;
  }

  if (a.conversationStyle && b.conversationStyle) {
    compared += 1;
    if (a.conversationStyle === b.conversationStyle) points += 1;
    else if (styleClash(a.conversationStyle, b.conversationStyle)) points += 0;
    else points += 0.5;
  }

  if (a.socialEnergy && b.socialEnergy) {
    compared += 1;
    if (a.socialEnergy === b.socialEnergy) points += 1;
    else if (
      (a.socialEnergy === "introverted" && b.socialEnergy === "extroverted") ||
      (a.socialEnergy === "extroverted" && b.socialEnergy === "introverted")
    ) {
      points += 0;
    } else {
      points += 0.5;
    }
  }

  if (a.dateOfBirth && b.dateOfBirth) {
    compared += 1;
    const gap = Math.abs(ageYears(a.dateOfBirth, now) - ageYears(b.dateOfBirth, now));
    if (gap <= 5) points += 1;
    else if (gap <= 10) points += 0.5;
    else points += 0;
  }

  return {
    score: compared === 0 ? 1 : points / compared,
    compared,
  };
}

/**
 * Empty tables always accept the first seat.
 * Singles: hard age band against people already holding.
 * Other types: block only a clear mismatch when we have enough signal.
 */
export function assertSeatingMatch(input: {
  tableType: NytoTableType;
  me: MatchPerson;
  peers: MatchPerson[];
  now?: Date;
}): void {
  const peers = input.peers;
  if (peers.length === 0) return;
  const now = input.now ?? new Date();

  if (input.tableType === NytoTableType.SINGLES && input.me.dateOfBirth) {
    const band = env.SINGLES_AGE_BAND_YEARS;
    const myAge = ageYears(input.me.dateOfBirth, now);
    for (const peer of peers) {
      if (!peer.dateOfBirth) continue;
      const gap = Math.abs(myAge - ageYears(peer.dateOfBirth, now));
      if (gap > band) {
        throw new Error(
          `Singles tables stay within ${band} years. This table is already seated outside that band.`,
        );
      }
    }
  }

  if (input.tableType === NytoTableType.SINGLES) return;

  const fits = peers.map((peer) => pairFit(input.me, peer, now));
  const compared = fits.reduce((sum, fit) => sum + fit.compared, 0);
  if (compared < 2) return;

  const avg =
    fits.reduce((sum, fit) => sum + fit.score, 0) / fits.length;
  if (avg < 0.35) {
    throw new Error(
      "This table is already matched around a different group. Pick another seat.",
    );
  }
}
