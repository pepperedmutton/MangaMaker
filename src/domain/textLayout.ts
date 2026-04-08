import type { TextDirection } from "./schema";

export type TextMeasureFn = (text: string) => number;
export type KinsokuMode = "auto" | "off" | "cjk" | "zh-strict" | "ja-strict";

export type TextLayoutOptions = {
  direction: TextDirection;
  maxWidth: number;
  maxHeight: number;
  fontSize: number;
  lineHeight: number;
  measureText: TextMeasureFn;
  letterSpacing?: number;
  lineSpacing?: number;
  kinsokuMode?: KinsokuMode;
  lineWidthProfile?: readonly number[];
  columnRowProfile?: readonly number[];
  verticalColumnAlign?: "start" | "center" | "end";
};

type SegmentLike = {
  segment: (input: string) => Iterable<{ segment: string }>;
};

type KinsokuRules = {
  forbiddenLineStart: ReadonlySet<string>;
  forbiddenLineEnd: ReadonlySet<string>;
};

const getProfileValue = (
  profile: readonly number[] | undefined,
  index: number,
  fallback: number,
) => {
  if (!profile || profile.length === 0) {
    return fallback;
  }
  const clampedIndex = Math.min(Math.max(index, 0), profile.length - 1);
  return Math.max(1, profile[clampedIndex] ?? fallback);
};

const BASE_FORBIDDEN_LINE_START =
  "\u3001\u3002\uff0c\uff0e\u30fb\uff1a\uff1b\uff1f\uff01\ufe10\ufe11\ufe12\ufe13\ufe14\ufe15\ufe16\ufe36\ufe42\ufe44)]\uff5d\u3015\u3009\u300b\u300d\u300f\u3011\u3019\u3017\u301f\u2019\u201d\uff60\u00bb";
const BASE_FORBIDDEN_LINE_END =
  "\ufe35\ufe41\ufe43([\uff5b\u3014\u3008\u300a\u300c\u300e\u3010\u3018\u3016\u301d\u2018\u201c\uff5f\u00ab";
const ZH_STRICT_FORBIDDEN_LINE_START = "\u2013\u2014\u2015\ufe31\ufe32\u2026\u22ef\ufe19";
const JA_STRICT_FORBIDDEN_LINE_START =
  "\u30fc\uff70\u30fb\uff65\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u3095\u3096\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30f5\u30f6\u309b\u309c\u309d\u309e\u30fd\u30fe\u3005";
const JAPANESE_SCRIPT_PATTERN = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u;
const CJK_SCRIPT_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const CJK_PUNCTUATION_PATTERN =
  /[\u3001\u3002\uff0c\uff0e\u30fb\uff1a\uff1b\uff1f\uff01\u300c\u300d\u300e\u300f\uff08\uff09\u3010\u3011\u300a\u300b\u3008\u3009]/u;

const toCharacterSet = (value: string) => new Set(value.split(""));
const mergeCharacterSets = (...values: string[]) => toCharacterSet(values.join(""));

const OFF_KINSOKU_RULES: KinsokuRules = {
  forbiddenLineStart: toCharacterSet(""),
  forbiddenLineEnd: toCharacterSet(""),
};
const CJK_KINSOKU_RULES: KinsokuRules = {
  forbiddenLineStart: toCharacterSet(BASE_FORBIDDEN_LINE_START),
  forbiddenLineEnd: toCharacterSet(BASE_FORBIDDEN_LINE_END),
};
const ZH_STRICT_KINSOKU_RULES: KinsokuRules = {
  forbiddenLineStart: mergeCharacterSets(
    BASE_FORBIDDEN_LINE_START,
    ZH_STRICT_FORBIDDEN_LINE_START,
  ),
  forbiddenLineEnd: CJK_KINSOKU_RULES.forbiddenLineEnd,
};
const JA_STRICT_KINSOKU_RULES: KinsokuRules = {
  forbiddenLineStart: mergeCharacterSets(
    BASE_FORBIDDEN_LINE_START,
    ZH_STRICT_FORBIDDEN_LINE_START,
    JA_STRICT_FORBIDDEN_LINE_START,
  ),
  forbiddenLineEnd: CJK_KINSOKU_RULES.forbiddenLineEnd,
};

const resolveEffectiveKinsokuMode = (content: string, mode: KinsokuMode) => {
  if (mode !== "auto") {
    return mode;
  }
  if (JAPANESE_SCRIPT_PATTERN.test(content)) {
    return "ja-strict" as const;
  }
  if (CJK_SCRIPT_PATTERN.test(content) || CJK_PUNCTUATION_PATTERN.test(content)) {
    return "cjk" as const;
  }
  return "off" as const;
};

const resolveKinsokuRules = (content: string, mode: KinsokuMode = "auto"): KinsokuRules => {
  const effectiveMode = resolveEffectiveKinsokuMode(content, mode);
  if (effectiveMode === "off") {
    return OFF_KINSOKU_RULES;
  }
  if (effectiveMode === "zh-strict") {
    return ZH_STRICT_KINSOKU_RULES;
  }
  if (effectiveMode === "ja-strict") {
    return JA_STRICT_KINSOKU_RULES;
  }
  return CJK_KINSOKU_RULES;
};

const FULL_WIDTH_SPACE = "\u3000";
const VERTICAL_ELLIPSIS = "\uFE19";
const VERTICAL_EM_DASH = "\uFE31";
const VERTICAL_EN_DASH = "\uFE32";
const VERTICAL_COMMA = "\uFE10";
const VERTICAL_IDEOGRAPHIC_COMMA = "\uFE11";
const VERTICAL_LEFT_PAREN = "\uFE35";
const VERTICAL_RIGHT_PAREN = "\uFE36";
const VERTICAL_LEFT_CORNER_BRACKET = "\uFE41";
const VERTICAL_RIGHT_CORNER_BRACKET = "\uFE42";
const VERTICAL_LEFT_WHITE_CORNER_BRACKET = "\uFE43";
const VERTICAL_RIGHT_WHITE_CORNER_BRACKET = "\uFE44";
const VERTICAL_EXCLAMATION = "\uFE15";
const VERTICAL_QUESTION = "\uFE16";
const HORIZONTAL_ELLIPSIS = "\u2026";
const MIDLINE_HORIZONTAL_ELLIPSIS = "\u22EF";
const MANGA_QUOTE_OPEN = "\u300C";
const MANGA_QUOTE_CLOSE = "\u300D";

export const resolveVerticalColumnAlignFromTextAlign = (
  textAlign: "left" | "center" | "right",
): "start" | "center" | "end" => {
  if (textAlign === "center") {
    return "center";
  }
  if (textAlign === "right") {
    return "end";
  }
  return "start";
};

let graphemeSegmenter: SegmentLike | null | undefined;
let wordSegmenter: SegmentLike | null | undefined;
let sharedMeasureContext: CanvasRenderingContext2D | null | undefined;

const createSegmenter = (granularity: "grapheme" | "word"): SegmentLike | null => {
  const intlWithSegmenter = Intl as unknown as {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity: "grapheme" | "word" },
    ) => SegmentLike;
  };
  if (!intlWithSegmenter.Segmenter) {
    return null;
  }
  try {
    return new intlWithSegmenter.Segmenter(undefined, { granularity });
  } catch {
    return null;
  }
};

const getGraphemeSegmenter = () => {
  if (graphemeSegmenter === undefined) {
    graphemeSegmenter = createSegmenter("grapheme");
  }
  return graphemeSegmenter;
};

const getWordSegmenter = () => {
  if (wordSegmenter === undefined) {
    wordSegmenter = createSegmenter("word");
  }
  return wordSegmenter;
};

const splitLines = (value: string) => value.replace(/\r\n/g, "\n").split("\n");

const splitGraphemes = (value: string) => {
  if (value.length === 0) {
    return [] as string[];
  }
  const segmenter = getGraphemeSegmenter();
  if (!segmenter) {
    return Array.from(value);
  }
  return Array.from(segmenter.segment(value), (entry) => entry.segment);
};

export const splitTextToGraphemes = (value: string) => splitGraphemes(value);

const createLetterSpacingMeasure = (measureText: TextMeasureFn, letterSpacing: number): TextMeasureFn => {
  if (Math.abs(letterSpacing) < 0.0001) {
    return measureText;
  }
  return (text: string) => {
    const glyphCount = splitGraphemes(text).length;
    if (glyphCount <= 1) {
      return measureText(text);
    }
    return measureText(text) + (glyphCount - 1) * letterSpacing;
  };
};

const normalizeVerticalEllipsis = (value: string) => {
  if (value.length === 0) {
    return value;
  }

  const replaceDotRuns = (input: string, pattern: RegExp, dotChar: string) =>
    input.replace(pattern, (match) => {
      const verticalCount = Math.floor(match.length / 3);
      const remainder = match.length % 3;
      return VERTICAL_ELLIPSIS.repeat(verticalCount) + dotChar.repeat(remainder);
    });

  return replaceDotRuns(
    replaceDotRuns(
      value
        .replaceAll(HORIZONTAL_ELLIPSIS, VERTICAL_ELLIPSIS)
        .replaceAll(MIDLINE_HORIZONTAL_ELLIPSIS, VERTICAL_ELLIPSIS),
      /\.{3,}/g,
      ".",
    ),
    /\uFF0E{3,}/g,
    "\uFF0E",
  );
};

const normalizeVerticalDash = (value: string) =>
  value
    .replaceAll("\u2015", VERTICAL_EM_DASH)
    .replaceAll("\u2014", VERTICAL_EM_DASH)
    .replaceAll("\u2013", VERTICAL_EN_DASH);

const normalizeMangaQuotes = (value: string) => {
  if (value.length === 0) {
    return value;
  }

  const chars = Array.from(value);
  const output: string[] = [];
  let nextDoubleOpen = true;
  let nextSingleOpen = true;

  const pushQuote = (isOpen: boolean) => {
    output.push(isOpen ? MANGA_QUOTE_OPEN : MANGA_QUOTE_CLOSE);
  };

  for (let index = 0; index < chars.length; index += 1) {
    const unit = chars[index] ?? "";
    if (unit === "\u201C" || unit === "\u201D" || unit === "\"" || unit === "\uFF02") {
      const forceOpen = unit === "\u201C";
      const forceClose = unit === "\u201D";
      const isOpen: boolean = forceOpen || (!forceClose && nextDoubleOpen);
      pushQuote(isOpen);
      nextDoubleOpen = !isOpen;
      continue;
    }

    if (unit === "\u2018" || unit === "\u2019" || unit === "'" || unit === "\uFF07") {
      const previous = chars[index - 1] ?? "";
      const next = chars[index + 1] ?? "";
      if (unit === "'" && /[A-Za-z0-9]/u.test(previous) && /[A-Za-z0-9]/u.test(next)) {
        output.push(unit);
        continue;
      }
      const forceOpen = unit === "\u2018";
      const forceClose = unit === "\u2019";
      const isOpen: boolean = forceOpen || (!forceClose && nextSingleOpen);
      pushQuote(isOpen);
      nextSingleOpen = !isOpen;
      continue;
    }

    output.push(unit);
  }

  return output.join("");
};

const normalizeVerticalBrackets = (value: string) =>
  value
    .replaceAll("\u300c", VERTICAL_LEFT_CORNER_BRACKET)
    .replaceAll("\u300d", VERTICAL_RIGHT_CORNER_BRACKET)
    .replaceAll("\u300e", VERTICAL_LEFT_WHITE_CORNER_BRACKET)
    .replaceAll("\u300f", VERTICAL_RIGHT_WHITE_CORNER_BRACKET)
    .replaceAll("(", VERTICAL_LEFT_PAREN)
    .replaceAll(")", VERTICAL_RIGHT_PAREN)
    .replaceAll("\uFF08", VERTICAL_LEFT_PAREN)
    .replaceAll("\uFF09", VERTICAL_RIGHT_PAREN);

const normalizeVerticalPunctuation = (value: string) =>
  value
    .replaceAll(",", VERTICAL_COMMA)
    .replaceAll("\uFF0C", VERTICAL_COMMA)
    .replaceAll("\u3001", VERTICAL_IDEOGRAPHIC_COMMA)
    .replaceAll("!", VERTICAL_EXCLAMATION)
    .replaceAll("\uFF01", VERTICAL_EXCLAMATION)
    .replaceAll("?", VERTICAL_QUESTION)
    .replaceAll("\uFF1F", VERTICAL_QUESTION);

const segmentWordTokens = (line: string) => {
  if (line.length === 0) {
    return [] as string[];
  }
  const segmenter = getWordSegmenter();
  if (!segmenter) {
    return line.match(/\s+|[^\s]+/g) ?? [];
  }
  return Array.from(segmenter.segment(line), (entry) => entry.segment).filter((entry) => entry.length > 0);
};

const isWhitespaceOnly = (value: string) => /^\s+$/u.test(value);

const breakTokenByWidth = (
  token: string,
  maxWidth: number,
  measureText: TextMeasureFn,
  kinsokuRules: KinsokuRules,
) => {
  const units = splitGraphemes(token);
  if (units.length === 0) {
    return [] as string[];
  }
  const lines: string[] = [];
  let current = "";
  for (const unit of units) {
    const next = `${current}${unit}`;
    if (current.length > 0 && measureText(next) > maxWidth) {
      const currentUnits = splitGraphemes(current);
      const carry: string[] = [unit];
      while (currentUnits.length > 1) {
        const currentTail = currentUnits[currentUnits.length - 1] ?? "";
        const nextHead = carry[0] ?? "";
        if (
          !kinsokuRules.forbiddenLineEnd.has(currentTail) &&
          !kinsokuRules.forbiddenLineStart.has(nextHead)
        ) {
          break;
        }
        const moved = currentUnits.pop();
        if (!moved) {
          break;
        }
        carry.unshift(moved);
      }
      lines.push(currentUnits.join(""));
      current = carry.join("");
      continue;
    }
    current = next;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
};

const applyKinsokuBoundary = (
  currentLine: string,
  nextToken: string,
  maxWidth: number,
  measureText: TextMeasureFn,
  kinsokuRules: KinsokuRules,
) => {
  let currentUnits = splitGraphemes(currentLine.replace(/\s+$/u, ""));
  let nextUnits = splitGraphemes(nextToken.replace(/^\s+/u, ""));

  if (currentUnits.length === 0) {
    return {
      line: "",
      next: nextUnits.join(""),
    };
  }

  if (nextUnits.length > 0 && kinsokuRules.forbiddenLineStart.has(nextUnits[0] ?? "")) {
    const sticky = nextUnits[0] ?? "";
    const candidate = `${currentUnits.join("")}${sticky}`;
    if (measureText(candidate) <= maxWidth * 1.06) {
      currentUnits.push(sticky);
      nextUnits = nextUnits.slice(1);
    }
  }

  while (currentUnits.length > 1 && nextUnits.length > 0) {
    const currentTail = currentUnits[currentUnits.length - 1] ?? "";
    const nextHead = nextUnits[0] ?? "";
    if (
      !kinsokuRules.forbiddenLineEnd.has(currentTail) &&
      !kinsokuRules.forbiddenLineStart.has(nextHead)
    ) {
      break;
    }
    const moved = currentUnits.pop();
    if (!moved) {
      break;
    }
    nextUnits.unshift(moved);
  }

  return {
    line: currentUnits.join(""),
    next: nextUnits.join(""),
  };
};

const wrapHorizontalLine = (
  line: string,
  maxWidth: number,
  measureText: TextMeasureFn,
  kinsokuRules: KinsokuRules,
) => {
  if (line.length === 0) {
    return [""] as string[];
  }

  const tokens = segmentWordTokens(line);
  if (tokens.length === 0) {
    return [""] as string[];
  }

  const wrapped: string[] = [];
  let current = "";

  for (const token of tokens) {
    if (current.length === 0 && isWhitespaceOnly(token)) {
      continue;
    }

    if (current.length === 0) {
      if (measureText(token) <= maxWidth) {
        current = token;
        continue;
      }
      const chunks = breakTokenByWidth(token, maxWidth, measureText, kinsokuRules);
      if (chunks.length > 0) {
        wrapped.push(...chunks.slice(0, -1));
        current = chunks[chunks.length - 1] ?? "";
      }
      continue;
    }

    const candidate = `${current}${token}`;
    if (measureText(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    const adjusted = applyKinsokuBoundary(
      current,
      token,
      maxWidth,
      measureText,
      kinsokuRules,
    );
    wrapped.push(adjusted.line);
    current = adjusted.next;

    if (current.length === 0) {
      continue;
    }
    if (measureText(current) <= maxWidth) {
      continue;
    }
    const chunks = breakTokenByWidth(current, maxWidth, measureText, kinsokuRules);
    if (chunks.length > 0) {
      wrapped.push(...chunks.slice(0, -1));
      current = chunks[chunks.length - 1] ?? "";
    }
  }

  wrapped.push(current);
  return wrapped.length > 0 ? wrapped : [""];
};

const wrapHorizontalLineWithProfile = (
  line: string,
  startLineIndex: number,
  lineWidthProfile: readonly number[] | undefined,
  maxWidth: number,
  measureText: TextMeasureFn,
  kinsokuRules: KinsokuRules,
) => {
  if (line.length === 0) {
    return {
      lines: [""],
      nextLineIndex: startLineIndex + 1,
    };
  }

  const tokens = segmentWordTokens(line);
  if (tokens.length === 0) {
    return {
      lines: [""],
      nextLineIndex: startLineIndex + 1,
    };
  }

  const wrapped: string[] = [];
  let current = "";
  let lineIndex = startLineIndex;
  const getCurrentMaxWidth = () => getProfileValue(lineWidthProfile, lineIndex, maxWidth);

  const pushWrappedLine = (value: string) => {
    wrapped.push(value);
    lineIndex += 1;
  };

  const splitCurrentAcrossProfileWidths = () => {
    while (current.length > 0 && measureText(current) > getCurrentMaxWidth()) {
      const chunks = breakTokenByWidth(current, getCurrentMaxWidth(), measureText, kinsokuRules);
      if (chunks.length === 0) {
        break;
      }
      if (chunks.length === 1) {
        pushWrappedLine(chunks[0] ?? current);
        current = "";
        break;
      }
      pushWrappedLine(chunks[0] ?? "");
      current = chunks.slice(1).join("");
    }
  };

  for (const token of tokens) {
    if (current.length === 0 && isWhitespaceOnly(token)) {
      continue;
    }

    if (current.length === 0) {
      current = token;
      splitCurrentAcrossProfileWidths();
      continue;
    }

    const maxWidthForLine = getCurrentMaxWidth();
    const candidate = `${current}${token}`;
    if (measureText(candidate) <= maxWidthForLine) {
      current = candidate;
      continue;
    }

    const adjusted = applyKinsokuBoundary(
      current,
      token,
      maxWidthForLine,
      measureText,
      kinsokuRules,
    );
    pushWrappedLine(adjusted.line);
    current = adjusted.next;
    splitCurrentAcrossProfileWidths();
  }

  if (current.length > 0 || wrapped.length === 0) {
    wrapped.push(current);
    lineIndex += 1;
  }
  return {
    lines: wrapped.length > 0 ? wrapped : [""],
    nextLineIndex: lineIndex,
  };
};

const wrapVerticalColumnsForLine = (
  line: string,
  maxRows: number,
  kinsokuRules: KinsokuRules,
  columnRowProfile?: readonly number[],
  startColumnIndex = 0,
) => {
  if (line.length === 0) {
    return [[]] as string[][];
  }
  const queue = splitGraphemes(
    normalizeVerticalPunctuation(
      normalizeVerticalBrackets(normalizeVerticalDash(normalizeVerticalEllipsis(line))),
    ),
  );
  const columns: string[][] = [];
  let current: string[] = [];
  let index = 0;
  const getCurrentMaxRows = () =>
    Math.max(1, Math.floor(getProfileValue(columnRowProfile, startColumnIndex + columns.length, maxRows)));

  while (index < queue.length) {
    const unit = queue[index] ?? "";
    if (current.length < getCurrentMaxRows()) {
      current.push(unit);
      index += 1;
      continue;
    }

    const carry: string[] = [unit];
    while (current.length > 1) {
      const currentTail = current[current.length - 1] ?? "";
      const nextHead = carry[0] ?? "";
      if (
        !kinsokuRules.forbiddenLineEnd.has(currentTail) &&
        !kinsokuRules.forbiddenLineStart.has(nextHead)
      ) {
        break;
      }
      const moved = current.pop();
      if (!moved) {
        break;
      }
      carry.unshift(moved);
    }

    columns.push(current);
    current = [];
    queue.splice(index, 1, ...carry);
  }

  if (current.length > 0) {
    columns.push(current);
  }

  return columns;
};

const layoutHorizontal = (
  content: string,
  maxWidth: number,
  measureText: TextMeasureFn,
  kinsokuRules: KinsokuRules,
  lineWidthProfile?: readonly number[],
) => {
  const lines: string[] = [];
  let nextLineIndex = 0;
  for (const sourceLine of splitLines(content)) {
    if (!lineWidthProfile || lineWidthProfile.length === 0) {
      lines.push(...wrapHorizontalLine(sourceLine, maxWidth, measureText, kinsokuRules));
      nextLineIndex += 1;
      continue;
    }
    const wrapped = wrapHorizontalLineWithProfile(
      sourceLine,
      nextLineIndex,
      lineWidthProfile,
      maxWidth,
      measureText,
      kinsokuRules,
    );
    lines.push(...wrapped.lines);
    nextLineIndex = wrapped.nextLineIndex;
  }
  return lines;
};

const layoutVertical = (
  content: string,
  maxWidth: number,
  maxHeight: number,
  fontSize: number,
  lineHeight: number,
  letterSpacing: number,
  lineSpacing: number,
  measureText: TextMeasureFn,
  kinsokuRules: KinsokuRules,
  columnRowProfile?: readonly number[],
  verticalColumnAlign: "start" | "center" | "end" = "start",
) => {
  const rowAdvance = Math.max(1, fontSize * lineHeight + letterSpacing);
  const sampleCellWidth = Math.max(
    fontSize * 0.75,
    measureText("\u56fd"),
    measureText("M"),
    measureText("\u53e3"),
  );
  const columnAdvance = Math.max(1, sampleCellWidth * 1.04 + lineSpacing);
  const maxRows = Math.max(1, Math.floor(maxHeight / rowAdvance));
  const maxCols =
    columnRowProfile && columnRowProfile.length > 0
      ? columnRowProfile.length
      : Math.max(1, Math.floor(maxWidth / columnAdvance));

  const columns: string[][] = [];
  for (const sourceLine of splitLines(content)) {
    const wrappedColumns = wrapVerticalColumnsForLine(
      sourceLine,
      maxRows,
      kinsokuRules,
      columnRowProfile,
      columns.length,
    );
    columns.push(...wrappedColumns);
  }

  const visibleColumns = columns.slice(0, maxCols);
  const visualColumns = [...visibleColumns].reverse();
  const hasColumnProfile = !!(columnRowProfile && columnRowProfile.length > 0);
  const baseColumnData = visualColumns.map((column, visualIndex) => {
    const sourceIndex = visibleColumns.length - 1 - visualIndex;
    const capacity = hasColumnProfile
      ? Math.max(
          1,
          Math.floor(getProfileValue(columnRowProfile, sourceIndex, maxRows)),
        )
      : Math.max(1, column.length);
    return {
      column,
      capacity,
    };
  });
  const alignmentRows = Math.max(1, ...baseColumnData.map((entry) => entry.capacity));
  const visualColumnData = baseColumnData.map((entry) => {
    const pad = Math.max(0, alignmentRows - entry.column.length);
    const topPad =
      verticalColumnAlign === "center"
        ? Math.floor(pad * 0.5)
        : verticalColumnAlign === "end"
          ? pad
          : 0;
    return {
      column: entry.column,
      capacity: entry.capacity,
      topPad,
    };
  });
  const occupiedColumns = visualColumnData.filter((entry) => entry.column.length > 0);
  const occupiedStart = occupiedColumns.length > 0
    ? Math.min(...occupiedColumns.map((entry) => entry.topPad))
    : 0;
  const occupiedEnd = occupiedColumns.length > 0
    ? Math.max(...occupiedColumns.map((entry) => entry.topPad + entry.column.length))
    : 1;
  const rowCount = Math.max(1, occupiedEnd - occupiedStart);

  const rows: string[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const normalizedRow = rowIndex + occupiedStart;
    const row = visualColumnData
      .map((entry) => {
        const localIndex = normalizedRow - entry.topPad;
        if (localIndex < 0 || localIndex >= entry.column.length) {
          return FULL_WIDTH_SPACE;
        }
        return entry.column[localIndex] ?? FULL_WIDTH_SPACE;
      })
      .join("");
    rows.push(/^[\u3000]+$/u.test(row) ? "" : row);
  }
  return rows;
};

const approximateTextWidth = (text: string, fontSize: number) =>
  splitGraphemes(text).reduce((width, unit) => {
    if (/^\s$/u.test(unit)) {
      return width + fontSize * 0.35;
    }
    if (/^[\u0000-\u00ff]$/u.test(unit)) {
      return width + fontSize * 0.56;
    }
    return width + fontSize;
  }, 0);

const getSharedMeasureContext = () => {
  if (sharedMeasureContext !== undefined) {
    return sharedMeasureContext;
  }
  if (typeof document === "undefined") {
    sharedMeasureContext = null;
    return sharedMeasureContext;
  }
  const canvas = document.createElement("canvas");
  sharedMeasureContext = canvas.getContext("2d");
  return sharedMeasureContext;
};

export const createCanvasTextMeasurer = (
  fontSize: number,
  fontFamily: string,
  fontWeight = 400,
): TextMeasureFn => {
  const context = getSharedMeasureContext();
  if (!context) {
    return (text: string) => approximateTextWidth(text, fontSize);
  }
  const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const cache = new Map<string, number>();
  return (text: string) => {
    const cached = cache.get(text);
    if (cached !== undefined) {
      return cached;
    }
    context.font = font;
    const width = context.measureText(text).width;
    cache.set(text, width);
    return width;
  };
};

export const getTextLineHeightByDirection = (direction: TextDirection) =>
  direction === "vertical" ? 1.1 : 1.35;

export const layoutTextForDisplayLines = (content: string, options: TextLayoutOptions) => {
  const normalizedContent = normalizeMangaQuotes(content);
  const maxWidth = Math.max(1, options.maxWidth);
  const maxHeight = Math.max(1, options.maxHeight);
  const letterSpacing = Number.isFinite(options.letterSpacing) ? options.letterSpacing ?? 0 : 0;
  const lineSpacing = Number.isFinite(options.lineSpacing) ? options.lineSpacing ?? 0 : 0;
  const measureText = createLetterSpacingMeasure(options.measureText, letterSpacing);
  const kinsokuRules = resolveKinsokuRules(normalizedContent, options.kinsokuMode ?? "auto");
  if (options.direction === "vertical") {
    return layoutVertical(
      normalizedContent,
      maxWidth,
      maxHeight,
      options.fontSize,
      options.lineHeight,
      letterSpacing,
      lineSpacing,
      measureText,
      kinsokuRules,
      options.columnRowProfile,
      options.verticalColumnAlign ?? "start",
    );
  }
  return layoutHorizontal(
    normalizedContent,
    maxWidth,
    measureText,
    kinsokuRules,
    options.lineWidthProfile,
  );
};

export const layoutTextForDisplayContent = (content: string, options: TextLayoutOptions) =>
  layoutTextForDisplayLines(content, options).join("\n");
