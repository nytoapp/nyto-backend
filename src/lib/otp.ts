type OtpEntry = {
  code: string;
  expiresAt: number;
};

const store = new Map<string, OtpEntry>();

const OTP_TTL_MS = 5 * 60 * 1000;

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function issueCode(): string {
  return process.env.NODE_ENV === "production"
    ? String(Math.floor(100000 + Math.random() * 900000))
    : "000000";
}

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function storeOtp(key: string, code: string): void {
  store.set(key, { code, expiresAt: Date.now() + OTP_TTL_MS });
}

export function issueOtp(key: string): string {
  const code = issueCode();
  storeOtp(key, code);
  return code;
}

export function verifyOtp(key: string, code: string): boolean {
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
