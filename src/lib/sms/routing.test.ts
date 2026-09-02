import { describe, expect, it } from "vitest";
import { buildOtpSmsBody } from "./index";
import { env } from "../../config/env";

describe("buildOtpSmsBody", () => {
  it("includes the code and an expiry hint", () => {
    const body = buildOtpSmsBody("123456");
    expect(body).toContain("123456");
    expect(body.toLowerCase()).toContain("expires");
  });

  it("appends the Android app hash as the final token when configured", () => {
    const original = env.ANDROID_SMS_APP_HASH;
    try {
      (env as { ANDROID_SMS_APP_HASH?: string }).ANDROID_SMS_APP_HASH = "FA+9qCX9VSu";
      const body = buildOtpSmsBody("123456");
      expect(body.trimEnd().endsWith("FA+9qCX9VSu")).toBe(true);
    } finally {
      (env as { ANDROID_SMS_APP_HASH?: string }).ANDROID_SMS_APP_HASH = original;
    }
  });

  it("stays within the 140-byte SMS Retriever limit", () => {
    expect(Buffer.byteLength(buildOtpSmsBody("123456"), "utf8")).toBeLessThan(140);
  });
});
