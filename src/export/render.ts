import { PDFDocument } from "pdf-lib";
import {
  getBubbleBasePoints,
  getRenderableLayers,
} from "../domain/helpers";
import type { ElementItem, Page, Panel, TextItem } from "../domain/schema";
import {
  createVerticalPunctuationOffsetMeasurer,
  FULL_WIDTH_SPACE,
  resolveTextDisplayLayout,
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

type KonvaModule = typeof import("konva");

let cachedKonvaModule: Promise<KonvaModule> | null = null;

const loadKonvaModule = async () => {
  if (!cachedKonvaModule) {
    cachedKonvaModule = import("konva");
  }
  return cachedKonvaModule;
};

const buildPanelPath = (context: CanvasRenderingContext2D, panel: Panel) => {
  context.beginPath();
  context.moveTo(panel.x + panel.points[0].x, panel.y + panel.points[0].y);
  for (let index = 1; index < panel.points.length; index += 1) {
    context.lineTo(panel.x + panel.points[index].x, panel.y + panel.points[index].y);
  }
  context.closePath();
};

const getTextStrokeConfig = (text: TextItem) => {
  const strokeWidth = Math.max(0, text.strokeWidth);
  return {
    stroke: strokeWidth > 0 ? text.strokeColor : undefined,
    strokeWidth,
    fillAfterStrokeEnabled: strokeWidth > 0,
  };
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

const drawElement = async (context: CanvasRenderingContext2D, element: ElementItem) => {
  const image = await loadImage(element.src);
  context.save();
  context.globalAlpha = element.opacity;
  context.translate(element.x + element.width * 0.5, element.y + element.height * 0.5);
  context.rotate((element.rotation * Math.PI) / 180);
  context.drawImage(
    image,
    -element.width * 0.5,
    -element.height * 0.5,
    element.width,
    element.height,
  );
  context.restore();
};

const buildKonvaTextNode = (Konva: KonvaModule["default"], text: TextItem) => {
  const layout = resolveTextDisplayLayout({
    content: text.content,
    direction: text.direction,
    width: text.width,
    height: text.height,
    fontSize: text.fontSize,
    fontFamily: text.fontFamily,
    fontWeight: text.fontWeight,
    textAlign: text.textAlign,
    verticalAlign: text.verticalAlign,
    letterSpacing: text.letterSpacing,
    lineSpacing: text.lineSpacing,
  });

  if (text.direction !== "vertical") {
    return new Konva.Text({
      x: text.x,
      y: text.y,
      text: layout.displayContent,
      fontSize: text.fontSize,
      fontFamily: text.fontFamily,
      fontStyle: String(text.fontWeight),
      letterSpacing: layout.letterSpacing,
      fill: text.color,
      ...getTextStrokeConfig(text),
      width: text.width,
      height: text.height,
      align: text.textAlign,
      verticalAlign: text.verticalAlign,
      wrap: "none",
      lineHeight: layout.renderLineHeight,
      listening: false,
    });
  }

  const punctuationOffsetMeasurer = createVerticalPunctuationOffsetMeasurer(
    text.fontSize,
    text.fontFamily,
    text.fontWeight,
  );
  const group = new Konva.Group({
    x: text.x,
    y: text.y,
    clipFunc: (ctx) => {
      const strokePadding = Math.max(0, text.strokeWidth);
      ctx.beginPath();
      ctx.rect(
        -strokePadding,
        -strokePadding,
        text.width + strokePadding * 2,
        text.height + strokePadding * 2,
      );
      ctx.closePath();
    },
    listening: false,
  });

  for (let rowIndex = 0; rowIndex < layout.vertical.rowCount; rowIndex += 1) {
    const row = layout.vertical.cellGrid[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < layout.vertical.columnCount; columnIndex += 1) {
      const unit = row[columnIndex] ?? FULL_WIDTH_SPACE;
      if (unit.length === 0 || unit === FULL_WIDTH_SPACE) {
        continue;
      }
      group.add(
        new Konva.Text({
          text: unit,
          fontSize: text.fontSize,
          fontFamily: text.fontFamily,
          fontStyle: String(text.fontWeight),
          fill: text.color,
          ...getTextStrokeConfig(text),
          x:
            layout.vertical.offsetX +
            columnIndex * layout.vertical.columnAdvance +
            punctuationOffsetMeasurer(unit),
          y: layout.vertical.offsetY + rowIndex * layout.vertical.rowAdvance,
          width: layout.vertical.columnAdvance,
          height: layout.vertical.rowAdvance,
          align: "center",
          verticalAlign: "middle",
          wrap: "none",
          lineHeight: 1,
          listening: false,
        }),
      );
    }
  }

  return group;
};

const renderTextLayersToCanvas = async (
  textLayers: TextItem[],
  pageWidth: number,
  pageHeight: number,
) => {
  if (textLayers.length === 0 || typeof document === "undefined") {
    return null;
  }

  const Konva = (await loadKonvaModule()).default;
  const container = document.createElement("div");
  const stage = new Konva.Stage({
    container,
    width: pageWidth,
    height: pageHeight,
  });
  const layer = new Konva.Layer({ listening: false });
  stage.add(layer);

  for (const text of textLayers) {
    layer.add(buildKonvaTextNode(Konva, text));
  }

  layer.draw();
  const canvas = layer.toCanvas({ pixelRatio: 1 });
  stage.destroy();
  return canvas;
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
  const orderedTextLayers: TextItem[] = [];

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
      orderedTextLayers.push(entry.object);
      continue;
    }

    if (entry.objectType === "element") {
      await drawElement(context, entry.object);
      continue;
    }

    const bubble = entry.object;
    drawBubble(context, bubble);
  }

  const textCanvas = await renderTextLayersToCanvas(orderedTextLayers, page.width, page.height);
  if (textCanvas) {
    context.drawImage(textCanvas, 0, 0);
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
