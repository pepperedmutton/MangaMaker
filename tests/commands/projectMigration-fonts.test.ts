import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_FONT_FAMILY } from "../../src/platform/localFonts";
import { normalizeProjectForCurrentVersion } from "../../src/storage/projectMigration";

describe("projectMigration font normalization", () => {
  it("forces existing text items to the curated default font family", () => {
    const rawProject = {
      id: "project-1",
      title: "Fonts",
      type: "manga",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [
        {
          id: "page-1",
          name: "Page 1",
          width: 1200,
          height: 1700,
          background: "#fff",
          panels: [],
          texts: [
            {
              id: "text-1",
              x: 100,
              y: 100,
              width: 200,
              height: 200,
              content: "A",
              fontSize: 32,
              fontFamily: "Random Old Font",
              fontWeight: 400,
              letterSpacing: 0,
              lineSpacing: 0,
              color: "#111",
              direction: "vertical",
              textAlign: "center",
              verticalAlign: "top",
            },
            {
              id: "text-2",
              x: 120,
              y: 120,
              width: 220,
              height: 220,
              content: "B",
              fontSize: 30,
              fontFamily: "Noto Serif SC",
              fontWeight: 400,
              letterSpacing: 0,
              lineSpacing: 0,
              color: "#111",
              direction: "vertical",
              textAlign: "center",
              verticalAlign: "top",
            },
          ],
          bubbles: [],
          groups: [],
          layers: ["text:text-1", "text:text-2"],
        },
      ],
    };

    const normalized = normalizeProjectForCurrentVersion(rawProject) as {
      pages: Array<{ texts: Array<{ fontFamily: string }> }>;
    };

    expect(normalized.pages[0].texts.map((text) => text.fontFamily)).toEqual([
      DEFAULT_TEXT_FONT_FAMILY,
      DEFAULT_TEXT_FONT_FAMILY,
    ]);
  });
});

