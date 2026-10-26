import { MenuPublishStatus, NytoTableType } from "@prisma/client";

const CAT_LINE = /^Categories:\s*(.+)$/im;
const STATUS_LINE = /^Status:\s*(Draft|Published)$/im;

/** Parse legacy description encoding into first-class fields. */
export function parseLegacyMenuDescription(description: string | null | undefined): {
  body: string;
  publishStatus: MenuPublishStatus;
  categories: NytoTableType[];
} {
  if (!description?.trim()) {
    return {
      body: "",
      publishStatus: MenuPublishStatus.DRAFT,
      categories: [],
    };
  }
  const lines = description.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let categories: NytoTableType[] = [];
  let publishStatus: MenuPublishStatus = MenuPublishStatus.PUBLISHED;
  const bodyLines: string[] = [];

  for (const line of lines) {
    const cat = line.match(CAT_LINE);
    const st = line.match(STATUS_LINE);
    if (cat) {
      categories = parseCategoryLabels(cat[1]);
    } else if (st) {
      publishStatus =
        st[1].toLowerCase() === "draft"
          ? MenuPublishStatus.DRAFT
          : MenuPublishStatus.PUBLISHED;
    } else {
      bodyLines.push(line);
    }
  }

  return {
    body: bodyLines.join("\n"),
    publishStatus,
    categories,
  };
}

function parseCategoryLabels(raw: string): NytoTableType[] {
  const out: NytoTableType[] = [];
  const lower = raw.toLowerCase();
  if (/\bwomen[- ]?led\b/.test(lower)) out.push(NytoTableType.WOMEN_LED);
  if (/\bcouples?\b/.test(lower)) out.push(NytoTableType.COUPLES);
  if (/\bsingles?\b/.test(lower)) out.push(NytoTableType.SINGLES);
  if (/\bweekly\b/.test(lower)) out.push(NytoTableType.WEEKLY);
  for (const id of [
    NytoTableType.WEEKLY,
    NytoTableType.WOMEN_LED,
    NytoTableType.COUPLES,
    NytoTableType.SINGLES,
  ]) {
    if (raw.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
