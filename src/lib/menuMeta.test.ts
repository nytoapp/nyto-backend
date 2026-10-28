import { describe, expect, it } from "vitest";
import { MenuPublishStatus, NytoTableType } from "@prisma/client";
import { parseLegacyMenuDescription } from "./menuMeta";

describe("parseLegacyMenuDescription", () => {
  it("returns draft empty for blank description", () => {
    expect(parseLegacyMenuDescription("")).toEqual({
      body: "",
      publishStatus: MenuPublishStatus.DRAFT,
      categories: [],
    });
  });

  it("parses categories + status lines and keeps body", () => {
    const parsed = parseLegacyMenuDescription(
      [
        "Burrata starter",
        "Categories: Weekly, Singles",
        "Status: Draft",
        "Sea bass main",
      ].join("\n"),
    );
    expect(parsed.publishStatus).toBe(MenuPublishStatus.DRAFT);
    expect(parsed.categories).toEqual(
      expect.arrayContaining([NytoTableType.WEEKLY, NytoTableType.SINGLES]),
    );
    expect(parsed.body).toContain("Burrata starter");
    expect(parsed.body).toContain("Sea bass main");
    expect(parsed.body).not.toMatch(/Categories:/i);
  });

  it("defaults publish status to PUBLISHED when Status line absent", () => {
    const parsed = parseLegacyMenuDescription("Just a dish note");
    expect(parsed.publishStatus).toBe(MenuPublishStatus.PUBLISHED);
    expect(parsed.body).toBe("Just a dish note");
  });
});
