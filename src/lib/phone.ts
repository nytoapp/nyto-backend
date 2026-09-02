import { parsePhoneNumberFromString } from "libphonenumber-js";
import { AppError } from "../middleware/errorHandler";

export type NormalizedPhone = {
  /** E.164, e.g. `+919876543210`. This is the canonical identity value. */
  e164: string;
  /** Country calling code without `+`, e.g. `91`. */
  callingCode: string;
  /** ISO 3166-1 alpha-2, e.g. `IN`. */
  country?: string;
};

/**
 * Parses any user-entered phone number to E.164 and rejects numbers that are
 * not valid for their country. Works for every country, not just India.
 */
export function normalizePhoneNumber(input: string): NormalizedPhone {
  const raw = input.trim();
  if (!raw) throw new AppError("Phone number is required");

  // libphonenumber needs a leading "+" to infer the country from the number.
  const candidate = raw.startsWith("+") ? raw : `+${raw.replace(/^00/, "")}`;
  const parsed = parsePhoneNumberFromString(candidate);

  if (!parsed || !parsed.isValid()) {
    throw new AppError("Enter a valid phone number with country code", 400);
  }

  return {
    e164: parsed.number,
    callingCode: parsed.countryCallingCode.toString(),
    country: parsed.country,
  };
}

/** Masks a destination for logs and user-facing copy: `+9198•••••210`. */
export function maskPhone(e164: string): string {
  if (e164.length <= 7) return "•••";
  return `${e164.slice(0, 5)}•••••${e164.slice(-3)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}
