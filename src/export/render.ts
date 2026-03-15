import { PDFDocument } from "pdf-lib";
import {
  getBubbleBasePoints,
  getDisplayedTextContent,
  getRenderableLayers,
} from "../domain/helpers";
import type { Page, Panel } from "../domain/schema";

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });

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

const drawTextBlock = (
  context: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) => {
  const lines = content.split(/\r?\n/);
  let cursorY = y;

  for (const line of lines) {
    if (line.length === 0) {
      cursorY += lineHeight;
      continue;
    }

    const words = line.split(/\s+/);
    let current = "";

    for (const word of words) {
      const next = current.length > 0 ? `${current} ${word}` : word;
      if (context.measureText(next).width > maxWidth && current.length > 0) {
        context.fillText(current, x, cursorY);
        current = word;
        cursorY += lineHeight;
      } else {
        current = next;
      }
    }

    if (current.length > 0) {
      context.fillText(current, x, cursorY);
      cursorY += lineHeight;
    }
  }
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

  for (const entry of getRenderableLayers(page)) {
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
      context.fillStyle = text.color;
      context.font = `${text.fontSize}px ${text.fontFamily}`;
      drawTextBlock(
        context,
        getDisplayedTextContent(text),
        text.x,
        text.y + text.fontSize,
        text.width,
        Math.round(text.fontSize * (text.direction === "vertical" ? 1.1 : 1.35)),
      );
      continue;
    }

    const bubble = entry.object;
    const base = getBubbleBasePoints(bubble);
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#111111";
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(bubble.x, bubble.y, bubble.width, bubble.height, 28);
    context.fill();
    context.beginPath();
    context.roundRect(bubble.x, bubble.y, bubble.width, bubble.height, 28);
    context.stroke();
    context.beginPath();
    context.moveTo(base.left.x, base.left.y);
    context.lineTo(bubble.tailTip.x, bubble.tailTip.y);
    context.lineTo(base.right.x, base.right.y);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = "#111111";
    context.font = `${bubble.fontSize}px Georgia`;
    drawTextBlock(
      context,
      bubble.text,
      bubble.x + 24,
      bubble.y + bubble.fontSize + 18,
      bubble.width - 48,
      Math.round(bubble.fontSize * 1.3),
    );
  }

  return canvas;
};

export const renderPageToPngDataUrl = async (page: Page) => {
  const canvas = await renderPageToCanvas(page);
  return canvas.toDataURL("image/png");
};

export const renderProjectToPdfDataUrl = async (pages: Page[]) => {
  const pdf = await PDFDocument.create();

  for (const page of pages) {
    const pngDataUrl = await renderPageToPngDataUrl(page);
    const pngBytes = await fetch(pngDataUrl).then((response) => response.arrayBuffer());
    const pngImage = await pdf.embedPng(pngBytes);
    const pdfPage = pdf.addPage([page.width, page.height]);
    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    });
  }

  return pdf.saveAsBase64({ dataUri: true });
};
