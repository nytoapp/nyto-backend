import { env } from "../../config/env";
import { AppError } from "../../middleware/errorHandler";
import type { SmsMessage, SmsTransport } from "./types";

const MSG91_FLOW_API = "https://control.msg91.com/api/v5/flow/";

/**
 * MSG91 Flow API. India requires DLT-registered templates, so the OTP is sent
 * as a template variable rather than as free-form text.
 */
export const msg91Transport: SmsTransport = {
  name: "msg91",

  isConfigured() {
    return Boolean(env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID);
  },

  async send({ to, code }: SmsMessage) {
    const authKey = env.MSG91_AUTH_KEY;
    const templateId = env.MSG91_TEMPLATE_ID;

    if (!authKey || !templateId) {
      throw new AppError("SMS delivery is not configured", 503);
    }

    const res = await fetch(MSG91_FLOW_API, {
      method: "POST",
      headers: {
        authkey: authKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: templateId,
        ...(env.MSG91_SENDER_ID ? { sender: env.MSG91_SENDER_ID } : {}),
        short_url: "0",
        recipients: [
          {
            // MSG91 expects the number without a leading "+".
            mobiles: to.replace(/^\+/, ""),
            OTP: code,
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new AppError("Could not send the code right now", 502);
    }

    // MSG91 returns HTTP 200 with a body-level error for rejected templates.
    const json = (await res.json().catch(() => null)) as
      | { type?: string; message?: unknown }
      | null;
    if (json?.type === "error") {
      throw new AppError("Could not send the code right now", 502);
    }
  },
};
