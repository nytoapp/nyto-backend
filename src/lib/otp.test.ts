import { beforeEach, describe, expect, it, vi } from "vitest";

type Challenge = {
  id: string;
  channel: string;
  destination: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  sendCount: number;
  expiresAt: Date;
  lastSentAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

/// Hoisted alongside `vi.mock` so the fake exists before the module under
/// test is imported, which lets the imports below stay static (and typed).
const { rows, otpChallenge } = vi.hoisted(() => {
const rows: Challenge[] = [];
let seq = 0;

/** Minimal in-memory stand-in for the queries the OTP service issues. */
const otpChallenge = {
  async findFirst({ where }: any) {
    const now = new Date();
    const matches = rows
      .filter((row) => {
        if (where.channel && row.channel !== where.channel) return false;
        if (where.destination && row.destination !== where.destination) return false;
        if (where.consumedAt === null && row.consumedAt !== null) return false;
        if (where.expiresAt?.gt && !(row.expiresAt > (where.expiresAt.gt ?? now))) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  },

  async aggregate({ where }: any) {
    const since = where.createdAt?.gte as Date | undefined;
    const total = rows
      .filter(
        (row) =>
          row.channel === where.channel &&
          row.destination === where.destination &&
          (!since || row.createdAt >= since),
      )
      .reduce((sum, row) => sum + row.sendCount, 0);
    return { _sum: { sendCount: total } };
  },

  async create({ data }: any) {
    const row: Challenge = {
      id: `otp_${++seq}`,
      channel: data.channel,
      destination: data.destination,
      codeHash: data.codeHash,
      attempts: 0,
      maxAttempts: data.maxAttempts ?? 5,
      sendCount: 1,
      expiresAt: data.expiresAt,
      lastSentAt: data.lastSentAt ?? new Date(),
      consumedAt: null,
      createdAt: new Date(),
    };
    rows.push(row);
    return row;
  },

  async update({ where, data }: any) {
    const row = rows.find((item) => item.id === where.id);
    if (!row) throw new Error("not found");
    for (const [key, value] of Object.entries(data) as [string, any][]) {
      if (value && typeof value === "object" && "increment" in value) {
        (row as any)[key] = (row as any)[key] + value.increment;
      } else {
        (row as any)[key] = value;
      }
    }
    return row;
  },

  async deleteMany() {
    return { count: 0 };
  },
};

  return { rows, otpChallenge };
});

vi.mock("./prisma", () => ({ prisma: { otpChallenge } }));

import { consumeOtpChallenge, issueOtpChallenge } from "./otp";
import { env } from "../config/env";

const PHONE = "+919876543210";
const SMS = "SMS" as never;

function rewindCooldown(seconds = 120) {
  for (const row of rows) {
    row.lastSentAt = new Date(row.lastSentAt.getTime() - seconds * 1000);
  }
}

beforeEach(() => {
  // IDs only need to be unique, so the counter keeps running across tests.
  rows.length = 0;
});

describe("issueOtpChallenge", () => {
  it("issues a code of the configured length and never returns the hash", async () => {
    const result = await issueOtpChallenge(SMS, PHONE);
    expect(result.code).toMatch(/^\d{6}$/);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).not.toContain(result.code);
  });

  it("blocks a resend inside the cooldown window", async () => {
    await issueOtpChallenge(SMS, PHONE);
    await expect(issueOtpChallenge(SMS, PHONE)).rejects.toMatchObject({
      statusCode: 429,
    });
    // Duplicate taps must not create a second challenge.
    expect(rows).toHaveLength(1);
  });

  it("replaces the code on a permitted resend so the old one stops working", async () => {
    const first = await issueOtpChallenge(SMS, PHONE);
    rewindCooldown();
    const second = await issueOtpChallenge(SMS, PHONE);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.sendCount).toBe(2);
    await expect(
      consumeOtpChallenge(SMS, PHONE, first.code),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(consumeOtpChallenge(SMS, PHONE, second.code)).resolves.toBeUndefined();
  });

  it("enforces the rolling hourly send cap", async () => {
    for (let i = 0; i < env.OTP_MAX_SENDS_PER_HOUR; i++) {
      rewindCooldown();
      await issueOtpChallenge(SMS, PHONE);
    }
    rewindCooldown();
    await expect(issueOtpChallenge(SMS, PHONE)).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("scopes limits per destination", async () => {
    await issueOtpChallenge(SMS, PHONE);
    await expect(
      issueOtpChallenge(SMS, "+14155550132"),
    ).resolves.toMatchObject({ isTestCode: false });
  });
});

describe("consumeOtpChallenge", () => {
  it("accepts the correct code exactly once", async () => {
    const { code } = await issueOtpChallenge(SMS, PHONE);
    await expect(consumeOtpChallenge(SMS, PHONE, code)).resolves.toBeUndefined();

    // Replay must fail even with the right code.
    await expect(consumeOtpChallenge(SMS, PHONE, code)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("tolerates surrounding whitespace in the submitted code", async () => {
    const { code } = await issueOtpChallenge(SMS, PHONE);
    await expect(
      consumeOtpChallenge(SMS, PHONE, `  ${code} `),
    ).resolves.toBeUndefined();
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const { code } = await issueOtpChallenge(SMS, PHONE);
    const wrong = code === "000000" ? "111111" : "000000";

    await expect(consumeOtpChallenge(SMS, PHONE, wrong)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(rows[0]!.attempts).toBe(1);
  });

  it("locks out after the attempt budget is spent", async () => {
    const { code } = await issueOtpChallenge(SMS, PHONE);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < env.OTP_MAX_ATTEMPTS; i++) {
      await expect(consumeOtpChallenge(SMS, PHONE, wrong)).rejects.toThrow();
    }

    // Even the correct code is refused once the budget is gone.
    await expect(consumeOtpChallenge(SMS, PHONE, code)).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("rejects an expired code", async () => {
    const { code } = await issueOtpChallenge(SMS, PHONE);
    rows[0]!.expiresAt = new Date(Date.now() - 1000);

    await expect(consumeOtpChallenge(SMS, PHONE, code)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects verification when no code was ever requested", async () => {
    await expect(consumeOtpChallenge(SMS, PHONE, "123456")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("does not accept a code issued for a different destination", async () => {
    const { code } = await issueOtpChallenge(SMS, PHONE);
    await issueOtpChallenge(SMS, "+14155550132");

    await expect(
      consumeOtpChallenge(SMS, "+14155550132", code),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
