import { describe, expect, it } from "vitest";
import { getPageDisplayName } from "../../src/domain/pageNaming";
import { projectSchema } from "../../src/domain/schema";
import { DEFAULT_TEXT_FONT_FAMILY } from "../../src/platform/localFonts";
import { normalizeProjectForCurrentVersion } from "../../src/storage/projectMigration";

describe("projectMigration font normalization", () => {
  it("preserves supported text fonts and falls back for unsupported fonts", () => {
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
              fontFamily: "LXGW WenKai",
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
      "LXGW WenKai",
    ]);
  });

  it("renames legacy pages to the canonical stored page order", () => {
    const rawProject = {
      id: "project-pages",
      title: "Pages",
      type: "manga",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [
        {
          id: "page-b",
          name: "Old Page 9",
          width: 1200,
          height: 1700,
          background: "#fff",
          panels: [],
          texts: [],
          bubbles: [],
          groups: [],
          layers: [],
        },
        {
          id: "page-a",
          name: "Old Page 1",
          width: 1200,
          height: 1700,
          background: "#fff",
          panels: [],
          texts: [],
          bubbles: [],
          groups: [],
          layers: [],
        },
      ],
    };

    const normalized = normalizeProjectForCurrentVersion(rawProject) as {
      pages: Array<{ id: string; name: string }>;
    };

    expect(normalized.pages.map((page) => page.id)).toEqual(["page-b", "page-a"]);
    expect(normalized.pages.map((page) => page.name)).toEqual([
      getPageDisplayName("en", 0),
      getPageDisplayName("en", 1),
    ]);
  });

  it("migrates legacy narration bubble records into valid caption bubbles", () => {
    const rawProject = {
      id: "project-narration",
      title: "Narration",
      type: "cg",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [
        {
          id: "page-1",
          name: "Page 1",
          width: 1200,
          height: 1600,
          background: "#fff",
          panels: [],
          texts: [],
          bubbles: [
            {
              id: "bubble-1",
              x: 100,
              y: 1300,
              width: 1000,
              height: 240,
              contentCenter: { x: 500, y: 120 },
              tailTip: { x: 500, y: 120 },
              bubbleType: "narration",
              style: {
                fill: "rgba(255, 255, 255, 0.8)",
                stroke: "transparent",
                strokeWidth: 0,
              },
            },
          ],
          groups: [],
          layers: ["bubble:bubble-1"],
        },
      ],
    };

    const normalized = projectSchema.parse(normalizeProjectForCurrentVersion(rawProject));
    const bubble = normalized.pages[0].bubbles[0];

    expect(bubble.bubbleType).toBe("caption");
    expect(bubble.showTail).toBe(false);
    expect(bubble.backgroundColor).toBe("rgba(255, 255, 255, 0.8)");
    expect(bubble.strokeColor).toBe("transparent");
    expect(bubble.strokeWidth).toBe(0);
  });

  it("fills missing legacy page and panel geometry before schema parsing", () => {
    const rawProject = {
      id: "project-legacy-geometry",
      title: "Legacy Geometry",
      type: "manga",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [
        {
          id: "page-1",
          name: "Page 1",
          panels: [
            {
              id: "panel-1",
            },
          ],
          texts: [],
          bubbles: [],
          groups: [],
          layers: ["panel:panel-1"],
        },
      ],
    };

    const normalized = projectSchema.parse(normalizeProjectForCurrentVersion(rawProject));
    const page = normalized.pages[0];
    const panel = page.panels[0];

    expect(page.width).toBe(1200);
    expect(page.height).toBe(1700);
    expect(panel).toMatchObject({
      x: 0,
      y: 0,
      width: 1200,
      height: 1700,
      rotation: 0,
      style: {
        fill: "#fffdf8",
        stroke: "#111111",
        strokeWidth: 4,
        cornerRadius: 12,
      },
    });
  });
});
