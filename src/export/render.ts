import { PDFDocument } from "pdf-lib";
import {
  getBubbleBasePoints,
  getRenderableLayers,
} from "../domain/helpers";
import type { Page, Panel } from "../domain/schema";
import {
  getTextLineHeightByDirection,
  layoutTextForDisplayContent,
  resolveVerticalColumnAlignFromTextAlign,
  splitTextToGraphemes,
} from "../domain/textLayout";
import {
  getBubbleBodyPath,
  getBubbleRegularTailStrokeOutlinePath,
  getBubbleTailPath,
} from "../ui/bubbleShapes";

const PDF_EXPORT_JPEG_QUALITY = 0.84;
const JPG_ZIP_EXPORT_JPEG_QUALITY = 0.92;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const FULL_WIDTH_SPACE = "\u3000";
const DEFAULT_TEXT_COLOR = "#121212";
const VERTICAL_QUESTION = "\uFE16";
const VERTICAL_EXCLAMATION = "\uFE15";
const VERTICAL_ELLIPSIS = "\uFE19";
const VERTICAL_EM_DASH = "\uFE31";
const VERTICAL_EN_DASH = "\uFE32";
const VERTICAL_COMMA = "\uFE10";
const VERTICAL_IDEOGRAPHIC_COMMA = "\uFE11";
const VERTICAL_CENTERED_PUNCTUATION = new Set([
  VERTICAL_QUESTION,
  VERTICAL_EXCLAMATION,
  VERTICAL_ELLIPSIS,
  VERTICAL_EM_DASH,
  VERTICAL_EN_DASH,
  VERTICAL_COMMA,
  VERTICAL_IDEOGRAPHIC_COMMA,
]);
const VERTICAL_PUNCTUATION_FINE_TUNE_X: Record<string, number> = {
  [VERTICAL_QUESTION]: 0,
  [VERTICAL_EXCLAMATION]: 0,
  [VERTICAL_ELLIPSIS]: 0,
  [VERTICAL_EM_DASH]: 0,
  [VERTICAL_EN_DASH]: 0,
  [VERTICAL_COMMA]: 0,
  [VERTICAL_IDEOGRAPHIC_COMMA]: 0,
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });

type ZipEntry = {
  fileName: string;
  bytes: Uint8Array;
};

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const computeCrc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    const next = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ crc32Table[next];
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const encodeZipFileName = (fileName: string) => new TextEncoder().encode(fileName);

const clampDosDatePart = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.floor(value)));

const toDosDateTime = (timestamp: Date) => {
  const year = clampDosDatePart(timestamp.getFullYear(), 1980, 2107);
  const month = clampDosDatePart(timestamp.getMonth() + 1, 1, 12);
  const day = clampDosDatePart(timestamp.getDate(), 1, 31);
  const hour = clampDosDatePart(timestamp.getHours(), 0, 23);
  const minute = clampDosDatePart(timestamp.getMinutes(), 0, 59);
  const second = clampDosDatePart(timestamp.getSeconds(), 0, 59);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hour << 11) | (minute << 5) | Math.floor(second / 2),
  };
};

const concatUint8Arrays = (parts: Uint8Array[]) => {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
};

const buildStoredZipArchive = (entries: ZipEntry[]) => {
  if (entries.length > 0xffff) {
    throw new Error("Too many files for ZIP export.");
  }

  const now = new Date();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encodeZipFileName(entry.fileName);
    const { date, time } = toDosDateTime(now);
    const crc32 = computeCrc32(entry.bytes);
    const size = entry.bytes.length >>> 0;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
    localView.setUint16(4, ZIP_VERSION, true);
    localView.setUint16(6, ZIP_UTF8_FLAG, true);
    localView.setUint16(8, ZIP_STORE_METHOD, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc32, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, ZIP_CENTRAL_DIRECTORY_HEADER_SIGNATURE, true);
    centralView.setUint16(4, ZIP_VERSION, true);
    centralView.setUint16(6, ZIP_VERSION, true);
    centralView.setUint16(8, ZIP_UTF8_FLAG, true);
    centralView.setUint16(10, ZIP_STORE_METHOD, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc32, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset >>> 0, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    localOffset += localHeader.length + entry.bytes.length;
  }

  const localBytes = concatUint8Arrays(localParts);
  const centralBytes = concatUint8Arrays(centralParts);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.length >>> 0, true);
  endView.setUint32(16, localBytes.length >>> 0, true);
  endView.setUint16(20, 0, true);

  return concatUint8Arrays([localBytes, centralBytes, end]);
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob as data URL."));
    reader.readAsDataURL(blob);
  });

const dataUrlToBytes = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
};

const buildPanelPath = (context: CanvasRenderingContext2D, panel: Panel) => {
  context.beginPath();
  context.moveTo(panel.x + panel.points[0].x, panel.y + panel.points[0].y);
  for (let index = 1; index < panel.points.length; index += 1) {
    context.lineTo(panel.x + panel.points[index].x, panel.y + panel.points[index].y);
  }
  context.closePath();
};

const drawPanelImage = async (context: CanvasRenderingContext2D, panel: Panel) => {
  if (!panel.image) {
    return;
  }

  const image = await loadImage(panel.image.src);
  const { viewBox } = panel.image;

  context.save();
  buildPanelPath(context, panel);
  context.clip();
  context.drawImage(
    image,
    viewBox.x,
    viewBox.y,
    viewBox.width,
    viewBox.height,
    panel.x,
    panel.y,
    panel.width,
    panel.height,
  );
  context.restore();
};

type TextAlign = "left" | "center" | "right";
type VerticalAlign = "top" | "middle" | "bottom";

const resolveAlignedTextX = (
  boxX: number,
  boxWidth: number,
  lineWidth: number,
  align: TextAlign,
) => {
  if (align === "center") {
    return boxX + (boxWidth - lineWidth) * 0.5;
  }
  if (align === "right") {
    return boxX + boxWidth - lineWidth;
  }
  return boxX;
};

const resolveAlignedTextYOffset = (
  boxHeight: number,
  blockHeight: number,
  verticalAlign: VerticalAlign,
) => {
  const available = boxHeight - blockHeight;
  if (verticalAlign === "middle") {
    return available * 0.5;
  }
  if (verticalAlign === "bottom") {
    return available;
  }
  return 0;
};

const createVerticalPunctuationOffsetMeasurer = (
  context: CanvasRenderingContext2D,
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
) => {
  const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const cache = new Map<string, number>();
  return (unit: string) => {
    if (!VERTICAL_CENTERED_PUNCTUATION.has(unit)) {
      return 0;
    }
    const cached = cache.get(unit);
    if (cached !== undefined) {
      return cached;
    }
    context.font = font;
    const metrics = context.measureText(unit);
    const left =
      Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : 0;
    const right =
      Number.isFinite(metrics.actualBoundingBoxRight)
        ? metrics.actualBoundingBoxRight
        : metrics.width;
    const leftEdgeX = -left;
    const rightEdgeX = right;
    const inkCenterX = (leftEdgeX + rightEdgeX) * 0.5;
    const advanceCenterX = metrics.width * 0.5;
    const offsetX =
      advanceCenterX - inkCenterX + (VERTICAL_PUNCTUATION_FINE_TUNE_X[unit] ?? 0);
    cache.set(unit, offsetX);
    return offsetX;
  };
};

const splitGraphemes = (value: string) => splitTextToGraphemes(value);

const measureLineWidthWithLetterSpacing = (
  context: CanvasRenderingContext2D,
  line: string,
  letterSpacing: number,
) => {
  if (line.length === 0) {
    return 0;
  }
  if (Math.abs(letterSpacing) < 0.0001) {
    return context.measureText(line).width;
  }
  const units = splitGraphemes(line);
  if (units.length === 0) {
    return 0;
  }
  const glyphWidth = units.reduce((width, unit) => width + context.measureText(unit).width, 0);
  return glyphWidth + (units.length - 1) * letterSpacing;
};

const drawLineWithLetterSpacing = (
  context: CanvasRenderingContext2D,
  line: string,
  x: number,
  baselineY: number,
  letterSpacing: number,
) => {
  if (line.length === 0) {
    return;
  }
  if (Math.abs(letterSpacing) < 0.0001) {
    context.fillText(line, x, baselineY);
    return;
  }
  const units = splitGraphemes(line);
  let cursorX = x;
  for (const unit of units) {
    context.fillText(unit, cursorX, baselineY);
    cursorX += context.measureText(unit).width + letterSpacing;
  }
};

const resolveCanvasTextColor = (
  context: CanvasRenderingContext2D,
  color: string,
  fallback = DEFAULT_TEXT_COLOR,
) => {
  const normalized = typeof color === "string" ? color.trim() : "";
  context.fillStyle = fallback;
  if (normalized.length > 0) {
    context.fillStyle = normalized;
  }
  return String(context.fillStyle);
};

const drawTextInBox = (
  context: CanvasRenderingContext2D,
  options: {
    content: string;
    direction: "horizontal" | "vertical";
    boxX: number;
    boxY: number;
    boxWidth: number;
    boxHeight: number;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    lineHeightRatio: number;
    letterSpacing: number;
    lineSpacing: number;
    textAlign: TextAlign;
    verticalAlign: VerticalAlign;
    color: string;
  },
) => {
  const letterSpacing = Number.isFinite(options.letterSpacing) ? options.letterSpacing : 0;
  const lineSpacing = Number.isFinite(options.lineSpacing) ? options.lineSpacing : 0;
  const resolvedColor = resolveCanvasTextColor(context, options.color);
  const lines = options.content.replace(/\r\n/g, "\n").split("\n");
  const lineAdvance = Math.max(1, options.fontSize * options.lineHeightRatio + lineSpacing);
  if (options.direction === "vertical") {
    const rowCount = Math.max(1, lines.length);
    const columnCount = Math.max(1, ...lines.map((line) => splitGraphemes(line).length));
    // Keep vertical row stepping consistent with CanvasView.
    const rowAdvance = Math.max(1, options.fontSize * options.lineHeightRatio + letterSpacing);
    const sampleCellWidth = Math.max(
      options.fontSize * 0.75,
      context.measureText("\u56fd").width,
      context.measureText("M").width,
      context.measureText("\u53e3").width,
    );
    const columnAdvance = Math.max(1, sampleCellWidth * 1.04 + lineSpacing);
    const blockWidth = columnCount * columnAdvance;
    const blockHeight = rowCount * rowAdvance;
    const originX = resolveAlignedTextX(
      options.boxX,
      options.boxWidth,
      blockWidth,
      options.textAlign,
    );
    const originY =
      options.boxY +
      resolveAlignedTextYOffset(options.boxHeight, blockHeight, options.verticalAlign);

    context.save();
    context.fillStyle = resolvedColor;
    context.beginPath();
    context.rect(options.boxX, options.boxY, options.boxWidth, options.boxHeight);
    context.clip();
    context.textAlign = "center";
    context.textBaseline = "middle";
    const punctuationOffsetMeasurer = createVerticalPunctuationOffsetMeasurer(
      context,
      options.fontSize,
      options.fontFamily,
      options.fontWeight,
    );

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = splitGraphemes(lines[rowIndex] ?? "");
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        const unit = row[columnIndex] ?? FULL_WIDTH_SPACE;
        if (unit.length === 0 || unit === FULL_WIDTH_SPACE) {
          continue;
        }
        context.fillText(
          unit,
          originX +
            columnIndex * columnAdvance +
            columnAdvance * 0.5 +
            punctuationOffsetMeasurer(unit),
          originY + rowIndex * rowAdvance + rowAdvance * 0.5,
        );
      }
    }

    context.restore();
    return;
  }

  const blockHeight = lines.length * lineAdvance;
  const yOffset = resolveAlignedTextYOffset(
    options.boxHeight,
    blockHeight,
    options.verticalAlign,
  );
  let baselineY = options.boxY + yOffset + options.fontSize;

  context.save();
  context.fillStyle = resolvedColor;
  context.beginPath();
  context.rect(options.boxX, options.boxY, options.boxWidth, options.boxHeight);
  context.clip();

  for (const line of lines) {
    const lineWidth = measureLineWidthWithLetterSpacing(context, line, letterSpacing);
    const lineX = resolveAlignedTextX(
      options.boxX,
      options.boxWidth,
      lineWidth,
      options.textAlign,
    );
    drawLineWithLetterSpacing(context, line, lineX, baselineY, letterSpacing);
    baselineY += lineAdvance;
  }

  context.restore();
};

const getThoughtTailCirclesForDisplay = (bubble: Page["bubbles"][number]) => {
  const base = getBubbleBasePoints(bubble);
  const tailTipX = bubble.tailTip.x - bubble.x;
  const tailTipY = bubble.tailTip.y - bubble.y;
  const tailBaseX = base.center.x - bubble.x;
  const tailBaseY = base.center.y - bubble.y;
  const circleCount = bubble.thoughtCircles ?? 3;
  const circles: Array<{ cx: number; cy: number; r: number }> = [];

  for (let index = 0; index < circleCount; index += 1) {
    const t = (index + 1) / (circleCount + 1);
    circles.push({
      cx: tailBaseX + (tailTipX - tailBaseX) * t,
      cy: tailBaseY + (tailTipY - tailBaseY) * t,
      r: Math.max(4, 12 - index * 2),
    });
  }

  return circles;
};

const drawBubble = (context: CanvasRenderingContext2D, bubble: Page["bubbles"][number]) => {
  const bubbleOpacity = Math.max(0, Math.min(1, bubble.opacity));
  const hasStroke = bubble.strokeWidth > 0;
  const shouldShowTail = bubble.showTail && bubble.bubbleType !== "explosion";
  const shouldRenderRegularTail = shouldShowTail && bubble.bubbleType !== "thought";
  const shouldRenderThoughtTail = shouldShowTail && bubble.bubbleType === "thought";
  const bodyPath = new Path2D(getBubbleBodyPath(bubble));
  const tailFillPath = shouldRenderRegularTail ? new Path2D(getBubbleTailPath(bubble)) : null;
  const strokePath = new Path2D(
    shouldRenderRegularTail ? getBubbleRegularTailStrokeOutlinePath(bubble) : getBubbleBodyPath(bubble),
  );
  const fillPath = new Path2D(getBubbleBodyPath(bubble));
  if (tailFillPath) {
    fillPath.addPath(tailFillPath);
  }

  context.save();
  context.translate(bubble.x, bubble.y);
  context.lineJoin = "round";
  context.lineCap = "round";

  context.save();
  context.globalAlpha = bubbleOpacity;
  context.fillStyle = bubble.backgroundColor;
  context.fill(fillPath);
  context.restore();

  if (hasStroke) {
    context.strokeStyle = bubble.strokeColor;
    context.lineWidth = bubble.strokeWidth;
    context.stroke(strokePath);
  }

  if (shouldRenderThoughtTail) {
    const circles = getThoughtTailCirclesForDisplay(bubble);
    for (const circle of circles) {
      context.beginPath();
      context.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
      context.save();
      context.globalAlpha = bubbleOpacity;
      context.fillStyle = bubble.backgroundColor;
      context.fill();
      context.restore();
      if (hasStroke) {
        context.strokeStyle = bubble.strokeColor;
        context.lineWidth = bubble.strokeWidth;
        context.stroke();
      }
    }
  }

  context.restore();
};

export const renderPageToCanvas = async (page: Page) => {
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas context not available");
  }

  context.fillStyle = page.background;
  context.fillRect(0, 0, page.width, page.height);

  // Keep export draw order consistent with CanvasView: render text above non-text layers.
  const renderableLayers = getRenderableLayers(page);
  const orderedLayers = [
    ...renderableLayers.filter((entry) => entry.objectType !== "text"),
    ...renderableLayers.filter((entry) => entry.objectType === "text"),
  ];

  for (const entry of orderedLayers) {
    if (entry.objectType === "panel") {
      const panel = entry.object;
      context.fillStyle = panel.style.fill;
      buildPanelPath(context, panel);
      context.fill();
      await drawPanelImage(context, panel);
      context.strokeStyle = panel.style.stroke;
      context.lineWidth = panel.style.strokeWidth;
      buildPanelPath(context, panel);
      context.stroke();
      continue;
    }

    if (entry.objectType === "text") {
      const text = entry.object;
      const letterSpacing = text.letterSpacing ?? 0;
      const lineSpacing = text.lineSpacing ?? 0;
      const lineHeightRatio = getTextLineHeightByDirection(text.direction);
      context.font = `${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`;
      const displayContent = layoutTextForDisplayContent(text.content, {
        direction: text.direction,
        maxWidth: text.width,
        maxHeight: text.height,
        fontSize: text.fontSize,
        lineHeight: lineHeightRatio,
        letterSpacing,
        lineSpacing,
        verticalColumnAlign: resolveVerticalColumnAlignFromTextAlign(text.textAlign),
        measureText: (value) => context.measureText(value).width,
      });
      drawTextInBox(context, {
        content: displayContent,
        direction: text.direction,
        boxX: text.x,
        boxY: text.y,
        boxWidth: text.width,
        boxHeight: text.height,
        fontSize: text.fontSize,
        fontFamily: text.fontFamily,
        fontWeight: text.fontWeight,
        lineHeightRatio,
        letterSpacing,
        lineSpacing,
        textAlign: text.textAlign,
        verticalAlign: text.verticalAlign,
        color: text.color,
      });
      continue;
    }

    const bubble = entry.object;
    drawBubble(context, bubble);
  }

  return canvas;
};

export const renderPageToPngDataUrl = async (page: Page) => {
  const canvas = await renderPageToCanvas(page);
  return canvas.toDataURL("image/png");
};

export const renderPageToJpegDataUrl = async (
  page: Page,
  quality = PDF_EXPORT_JPEG_QUALITY,
) => {
  const canvas = await renderPageToCanvas(page);
  return canvas.toDataURL("image/jpeg", Math.max(0.1, Math.min(1, quality)));
};

export const renderProjectToPdfDataUrl = async (pages: Page[]) => {
  const pdf = await PDFDocument.create();

  for (const page of pages) {
    const jpegDataUrl = await renderPageToJpegDataUrl(page, PDF_EXPORT_JPEG_QUALITY);
    const jpegBytes = await fetch(jpegDataUrl).then((response) => response.arrayBuffer());
    const jpegImage = await pdf.embedJpg(jpegBytes);
    const pdfPage = pdf.addPage([page.width, page.height]);
    pdfPage.drawImage(jpegImage, {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    });
  }

  return pdf.saveAsBase64({ dataUri: true });
};

export const renderProjectToJpgZipDataUrl = async (pages: Page[]) => {
  const zipEntries = await Promise.all(
    pages.map(async (page, index) => {
      const jpegDataUrl = await renderPageToJpegDataUrl(page, JPG_ZIP_EXPORT_JPEG_QUALITY);
      return {
        fileName: `${index + 1}.jpg`,
        bytes: await dataUrlToBytes(jpegDataUrl),
      };
    }),
  );

  const zipBytes = buildStoredZipArchive(zipEntries);
  const zipBlob = new Blob([zipBytes], { type: "application/zip" });
  return blobToDataUrl(zipBlob);
};
