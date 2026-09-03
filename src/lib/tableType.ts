import { GenderPreference, NytoTableType, TablePaymentType } from "@prisma/client";

export function genderPreferenceForTableType(
  tableType: NytoTableType,
): GenderPreference {
  return tableType === NytoTableType.WOMEN_LED
    ? GenderPreference.WOMEN_ONLY
    : GenderPreference.BALANCED;
}

export function parseTableType(raw: unknown): NytoTableType | undefined {
  if (raw === "WEEKLY" || raw === "WOMEN_LED" || raw === "COUPLES" || raw === "SINGLES") {
    return raw;
  }
  return undefined;
}

export function parsePaymentType(raw: unknown): TablePaymentType | undefined {
  if (raw === "ALL_INCLUSIVE" || raw === "PAY_OWN_BILL") return raw;
  return undefined;
}
