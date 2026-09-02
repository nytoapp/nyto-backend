import { env, isProduction } from "../../config/env";
import { AppError } from "../../middleware/errorHandler";
import { maskPhone } from "../phone";
import { msg91Transport } from "./msg91";
import { twilioTransport } from "./twilio";
import type { SmsMessage, SmsTransport } from "./types";

export type { SmsTransport } from "./types";

/**
 * Development transport. Prints that a code was requested — never the code
 * itself — so local work does not depend on a paid provider.
 */
const consoleTransport: SmsTransport = {
  name: "console",
  isConfigured: () => !isProduction,
  async send({ to }: SmsMessage) {
    console.log(`[sms:dev] code issued for ${maskPhone(to)} (not delivered)`);
  },
};

/**
 * Routes by country calling code: India (and anything else listed in
 * MSG91_COUNTRY_CODES) goes to MSG91, the rest of the world to Twilio.
 */
export function transportFor(callingCode: string): SmsTransport {
  const preferred = env.MSG91_COUNTRY_CODES.includes(callingCode)
    ? [msg91Transport, twilioTransport]
    : [twilioTransport, msg91Transport];

  const configured = preferred.find((transport) => transport.isConfigured());
  if (configured) return configured;

  if (!isProduction) return consoleTransport;

  throw new AppError(
    "SMS delivery is not configured for this country. Contact support.",
    503,
  );
}

export function buildOtpSmsBody(code: string): string {
  const lines = [`${code} is your NYTO verification code. It expires in 5 minutes.`];
  // The SMS Retriever API requires the app hash as the final token of the body.
  if (env.ANDROID_SMS_APP_HASH) lines.push(env.ANDROID_SMS_APP_HASH);
  return lines.join("\n");
}

export async function sendOtpSms(to: string, callingCode: string, code: string) {
  const transport = transportFor(callingCode);
  await transport.send({ to, code, body: buildOtpSmsBody(code) });
  return transport.name;
}
