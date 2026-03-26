import { describe, expect, it } from "vitest";
import { layoutTextForDisplayContent } from "../../src/domain/textLayout";

const monospacedMeasure = (text: string) => Array.from(text).length;

describe("text layout", () => {
  it("wraps horizontal CJK text by width and keeps punctuation off invalid boundaries", () => {
    const output = layoutTextForDisplayContent(
      "\u4f60\u597d\uff0c\uff08\u6d4b\u8bd5\uff09\u4e16\u754c\u3002\u6362\u884c\u89c4\u5219\u3002",
      {
        direction: "horizontal",
        maxWidth: 5,
        maxHeight: 100,
        fontSize: 1,
        lineHeight: 1.35,
        measureText: monospacedMeasure,
      },
    );

    const lines = output.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(Array.from(line).length).toBeLessThanOrEqual(5);
      expect(
        "\u3001\u3002\uff0c\uff0e\u30fb\uff1a\uff1b\uff1f\uff01)]\uff5d\u3015\u3009\u300b\u300d\u300f\u3011\u3019\u3017\u301f\u2019\u201d\uff60\u00bb",
      ).not.toContain(line[0] ?? "");
      expect(
        "([\uff5b\u3014\u3008\u300a\u300c\u300e\u3010\u3018\u3016\u301d\u2018\u201c\uff5f\u00ab",
      ).not.toContain(line.at(-1) ?? "");
    }
  });

  it("prefers whole words for horizontal latin text before falling back to character split", () => {
    const output = layoutTextForDisplayContent("PowerPoint wrapping behaves better", {
      direction: "horizontal",
      maxWidth: 11,
      maxHeight: 100,
      fontSize: 1,
      lineHeight: 1.35,
      measureText: monospacedMeasure,
    });

    const lines = output.split("\n");
    expect(lines[0]).toBe("PowerPoint");
  });

  it("supports per-line width profile for shaped horizontal bubble layout", () => {
    const lineWidthProfile = [2, 4, 6, 4, 2];
    const output = layoutTextForDisplayContent(
      "\u5929\u5730\u7384\u9ec4\u5b87\u5b99\u6d2a\u8352\u65e5\u6708\u76c8\u6603\u8fb0\u5bbf\u5217\u5f20",
      {
        direction: "horizontal",
        maxWidth: 6,
        maxHeight: 100,
        fontSize: 1,
        lineHeight: 1.35,
        measureText: monospacedMeasure,
        lineWidthProfile,
      },
    );

    const lines = output.split("\n");
    expect(Array.from(lines[0] ?? "").length).toBeLessThanOrEqual(2);
    expect(Array.from(lines[1] ?? "").length).toBeLessThanOrEqual(4);
    expect(Array.from(lines[2] ?? "").length).toBeLessThanOrEqual(6);
  });

  it("wraps vertical text into columns and transposes for display", () => {
    const output = layoutTextForDisplayContent(
      "\u5929\u5730\u7384\u9ec4\u5b87\u5b99\u6d2a\u8352",
      {
        direction: "vertical",
        maxWidth: 3,
        maxHeight: 4,
        fontSize: 1,
        lineHeight: 1,
        measureText: monospacedMeasure,
      },
    );

    expect(output).toBe("\u5b87\u5929\n\u5b99\u5730\n\u6d2a\u7384\n\u8352\u9ec4");
  });

  it("treats hard newline as a forced new vertical column", () => {
    const output = layoutTextForDisplayContent(
      "\u5929\u5730\n\u7384\u9ec4",
      {
        direction: "vertical",
        maxWidth: 3,
        maxHeight: 4,
        fontSize: 1,
        lineHeight: 1,
        measureText: monospacedMeasure,
      },
    );

    expect(output).toBe("\u7384\u5929\n\u9ec4\u5730");
  });

  it("supports per-column row profile for shaped vertical bubble layout", () => {
    const output = layoutTextForDisplayContent(
      "\u5929\u5730\u7384\u9ec4\u5b87\u5b99\u6d2a\u8352",
      {
        direction: "vertical",
        maxWidth: 6,
        maxHeight: 10,
        fontSize: 1,
        lineHeight: 1,
        measureText: monospacedMeasure,
        columnRowProfile: [2, 4, 2],
      },
    );

    expect(output).toBe("\u6d2a\u7384\u5929\n\u8352\u9ec4\u5730\n\u3000\u5b87\u3000\n\u3000\u5b99\u3000");
  });

  it("centers glyphs within each vertical column when center alignment is used", () => {
    const output = layoutTextForDisplayContent("\u5929\u5730\u7384\u9ec4\u5b87", {
      direction: "vertical",
      maxWidth: 6,
      maxHeight: 10,
      fontSize: 1,
      lineHeight: 1,
      measureText: monospacedMeasure,
      columnRowProfile: [4, 4],
      verticalColumnAlign: "center",
    });

    expect(output).toBe("\u3000\u5929\n\u5b87\u5730\n\u3000\u7384\n\u3000\u9ec4");
  });

  it("renders Chinese ellipsis as vertical ellipsis in vertical text", () => {
    const output = layoutTextForDisplayContent("\u7b49\u7b49\u2026\u2026", {
      direction: "vertical",
      maxWidth: 4,
      maxHeight: 10,
      fontSize: 1,
      lineHeight: 1,
      measureText: monospacedMeasure,
    });

    expect(output).toContain("\uFE19");
    expect(output).not.toContain("\u2026");
  });

  it("renders triple ASCII dots as vertical ellipsis in vertical text", () => {
    const output = layoutTextForDisplayContent("...", {
      direction: "vertical",
      maxWidth: 4,
      maxHeight: 10,
      fontSize: 1,
      lineHeight: 1,
      measureText: monospacedMeasure,
    });

    expect(output).toBe("\uFE19");
  });

  it("renders dash and ellipsis as vertical glyphs in vertical text", () => {
    const output = layoutTextForDisplayContent("\u2014\u2014\u2026\u2026", {
      direction: "vertical",
      maxWidth: 6,
      maxHeight: 20,
      fontSize: 1,
      lineHeight: 1,
      measureText: monospacedMeasure,
    });

    expect(output).toContain("\uFE31");
    expect(output).toContain("\uFE19");
    expect(/[\u2014\u2015\u2026]/u.test(output)).toBe(false);
  });

  it("renders corner brackets and parentheses as vertical glyphs in vertical text", () => {
    const output = layoutTextForDisplayContent("\u300c\u7532\u300d\u300e\u4e59\u300f\uff08\u4e19\uff09", {
      direction: "vertical",
      maxWidth: 8,
      maxHeight: 20,
      fontSize: 1,
      lineHeight: 1,
      measureText: monospacedMeasure,
    });

    expect(output).toContain("\uFE41");
    expect(output).toContain("\uFE42");
    expect(output).toContain("\uFE43");
    expect(output).toContain("\uFE44");
    expect(output).toContain("\uFE35");
    expect(output).toContain("\uFE36");
    expect(/[\u300c\u300d\u300e\u300f\uFF08\uFF09()]/u.test(output)).toBe(false);
  });

  it("normalizes quote marks to manga corner quotes", () => {
    const output = layoutTextForDisplayContent("\u201c\u7532\u201d\u2018\u4e59\u2019\"\u4e19\"'\u4e01'", {
      direction: "horizontal",
      maxWidth: 100,
      maxHeight: 20,
      fontSize: 1,
      lineHeight: 1.35,
      measureText: monospacedMeasure,
    });

    expect(output).toBe("\u300c\u7532\u300d\u300c\u4e59\u300d\u300c\u4e19\u300d\u300c\u4e01\u300d");
  });

  it("centers exclamation and question marks in vertical text using vertical glyphs", () => {
    const output = layoutTextForDisplayContent("!\uFF01?\uFF1F", {
      direction: "vertical",
      maxWidth: 6,
      maxHeight: 20,
      fontSize: 1,
      lineHeight: 1,
      measureText: monospacedMeasure,
    });

    expect(output).toContain("\uFE15");
    expect(output).toContain("\uFE16");
    expect(/[!?\uFF01\uFF1F]/u.test(output)).toBe(false);
  });

  it("normalizes comma glyphs for vertical centering", () => {
    const output = layoutTextForDisplayContent(",\uFF0C\u3001", {
      direction: "vertical",
      maxWidth: 6,
      maxHeight: 20,
      fontSize: 1,
      lineHeight: 1,
      measureText: monospacedMeasure,
    });

    expect(output).toContain("\uFE10");
    expect(output).toContain("\uFE11");
    expect(/[,\uFF0C\u3001]/u.test(output)).toBe(false);
  });

  it("supports stricter Chinese kinsoku mode for dash and ellipsis at line start", () => {
    const output = layoutTextForDisplayContent("\u7532\u4e59\u4e19\u2026\u2026\u4e01\u620a\u2014\u2014\u5df1\u5e9a", {
      direction: "horizontal",
      maxWidth: 3,
      maxHeight: 100,
      fontSize: 1,
      lineHeight: 1.35,
      measureText: monospacedMeasure,
      kinsokuMode: "zh-strict",
    });

    for (const line of output.split("\n")) {
      expect(/[—―…⋯︙]/u.test(line[0] ?? "")).toBe(false);
    }
  });

  it("uses stricter Japanese kinsoku in auto mode", () => {
    const output = layoutTextForDisplayContent("\u3042\u3042\u3042\u3083\u3042\u3042\u30fc\u30c6\u30b9\u30c8", {
      direction: "horizontal",
      maxWidth: 3,
      maxHeight: 100,
      fontSize: 1,
      lineHeight: 1.35,
      measureText: monospacedMeasure,
      kinsokuMode: "auto",
    });

    for (const line of output.split("\n")) {
      expect(/[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーｰ]/u.test(line[0] ?? "")).toBe(false);
    }
  });
});
