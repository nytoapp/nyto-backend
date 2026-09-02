import { env } from "../../config/env";
import { AppError } from "../../middleware/errorHandler";
import type { SmsMessage, SmsTransport } from "./types";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

/** Twilio Programmable Messaging over REST — no SDK, no extra dependency. */
export const twilioTransport: SmsTransport = {
  name: "twilio",

  isConfigured() {
    return Boolean(
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM,
    );
  },

  async send({ to, body }: SmsMessage) {
    const sid = env.TWILIO_ACCOUNT_SID;
    const token = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_FROM;

    if (!sid || !token || !from) {
      throw new AppError("SMS delivery is not configured", 503);
    }

    const form = new URLSearchParams({ To: to, Body: body });
    // Messaging Service SIDs start with "MG" and use a different parameter.
    if (from.startsWith("MG")) {
      form.set("MessagingServiceSid", from);
    } else {
      form.set("From", from);
    }

    const res = await fetch(`${TWILIO_API}/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const detail = await safeMessage(res);
      throw new AppError(
        `Could not send the code right now. ${detail}`.trim(),
        502,
      );
    }
  },
};

async function safeMessage(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { message?: string };
    // Twilio messages are operator-facing, safe to surface in trimmed form.
    return typeof json.message === "string" ? json.message : "";
  } catch {
    return "";
  }
}
