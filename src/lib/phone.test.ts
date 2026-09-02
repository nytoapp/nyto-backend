import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, normalizePhoneNumber } from "./phone";
import { AppError } from "../middleware/errorHandler";

describe("normalizePhoneNumber", () => {
  it("normalizes an Indian number to E.164", () => {
    const result = normalizePhoneNumber("+91 98765 43210");
    expect(result.e164).toBe("+919876543210");
    expect(result.callingCode).toBe("91");
    expect(result.country).toBe("IN");
  });

  it("accepts a number without the leading plus", () => {
    expect(normalizePhoneNumber("919876543210").e164).toBe("+919876543210");
  });

  it("strips separators and surrounding whitespace", () => {
    expect(normalizePhoneNumber("  +91-98765-43210  ").e164).toBe("+919876543210");
  });

  it("normalizes a US number", () => {
    const result = normalizePhoneNumber("+1 415 555 0132");
    expect(result.e164).toBe("+14155550132");
    expect(result.callingCode).toBe("1");
    expect(result.country).toBe("US");
  });

  it("normalizes an Italian number", () => {
    const result = normalizePhoneNumber("+39 320 123 4567");
    expect(result.callingCode).toBe("39");
    expect(result.country).toBe("IT");
  });

  it("converts an international 00 prefix", () => {
    expect(normalizePhoneNumber("00919876543210").e164).toBe("+919876543210");
  });

  it("rejects an Indian number with too few digits", () => {
    expect(() => normalizePhoneNumber("+9198765432")).toThrow(AppError);
  });

  it("rejects an Indian number with too many digits", () => {
    expect(() => normalizePhoneNumber("+91987654321012")).toThrow(AppError);
  });

  it("rejects letters", () => {
    expect(() => normalizePhoneNumber("+91abcdefghij")).toThrow(AppError);
  });

  it("rejects an empty value", () => {
    expect(() => normalizePhoneNumber("   ")).toThrow(AppError);
  });
});

describe("masking", () => {
  it("masks the middle of a phone number", () => {
    const masked = maskPhone("+919876543210");
    expect(masked).toContain("210");
    expect(masked).not.toContain("9876543");
  });

  it("masks the local part of an email", () => {
    const masked = maskEmail("someone@example.com");
    expect(masked.endsWith("@example.com")).toBe(true);
    expect(masked).not.toContain("someone");
  });
});
