import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationFromEmail } from "./emailDelivery";

vi.mock("../config/env", () => ({
  env: {
    RESEND_API_KEY: undefined,
    RESEND_FROM_EMAIL: undefined,
  },
}));

describe("notificationFromEmail", () => {
  it("never claims delivery when mail was skipped", () => {
    expect(
      notificationFromEmail(
        null,
        "Email sent.",
        "No email on file — tell them in person.",
      ),
    ).toEqual({
      emailDelivered: false,
      deliveryMode: "none",
      nextStep: "No email on file — tell them in person.",
    });
  });

  it("uses not-delivered copy for dev_log", () => {
    expect(
      notificationFromEmail(
        { delivered: false, mode: "dev_log" },
        "Email sent with portal link.",
        "Access granted — no email sent (mail provider off). They sign in with OTP.",
      ).emailDelivered,
    ).toBe(false);
  });
});

describe("sendEmailOtp without Resend", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns delivered:false mode:dev_log", async () => {
    const { sendEmailOtp, isTransactionalEmailConfigured } = await import(
      "./email"
    );
    expect(isTransactionalEmailConfigured()).toBe(false);
    const result = await sendEmailOtp("ops@nyto.app", "123456");
    expect(result).toEqual({ delivered: false, mode: "dev_log" });
  });
});
