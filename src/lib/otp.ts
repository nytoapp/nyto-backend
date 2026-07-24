type OtpEntry = {
  code: string;
  expiresAt: number;
};

const store = new Map<string, OtpEntry>();

const OTP_TTL_MS = 5 * 60 * 1000;

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function issueOtp(phone: string): string {
  const key = normalizePhone(phone);
  // Fixed stub OTP in development so Flutter / Postman can verify easily.
  const code = process.env.NODE_ENV === "production"
    ? String(Math.floor(100000 + Math.random() * 900000))
    : "000000";

  store.set(key, { code, expiresAt: Date.now() + OTP_TTL_MS });
  return code;
}

export function verifyOtp(phone: string, code: string): boolean {
  const key = normalizePhone(phone);
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }
  if (entry.code !== code.trim()) return false;
  store.delete(key);
  return true;
}
