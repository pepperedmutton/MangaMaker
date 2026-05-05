import { getPageWorkspace } from "../domain/helpers";
import type { Page, Project } from "../domain/schema";
import { renderPageToCanvas } from "../export/render";
import { useEditorStore } from "../state/editorStore";
import type { EditorSelectionItem } from "../state/types";
import { buildCommandManifest } from "./commandManifest";
import type {
  AgentCanvasSnapshot,
  AgentContextSnapshot,
  AgentImageAsset,
  AgentObjectSummary,
  AgentPageSummary,
} from "./types";

const MAX_SNAPSHOT_EDGE = 1280;

const byteLengthFromDataUrl = (dataUrl: string) => {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  return Math.floor((base64.length * 3) / 4);
};

const createEmptySnapshot = (
  scope: "canvas" | "selection",
  reason: string,
): AgentCanvasSnapshot => ({
  scope,
  dataUrl: null,
  width: 0,
  height: 0,
  mimeType: "image/png",
  byteLength: 0,
  capturedAt: new Date().toISOString(),
  reason,
});

const getFallbackCanvas = () => {
  const canvases = Array.from(
    document.querySelectorAll<HTMLCanvasElement>(".canvas-wrap .konvajs-content canvas"),
  ).filter((canvas) => canvas.width > 0 && canvas.height > 0);
  if (canvases.length === 0) {
    return null;
  }
  if (canvases.length === 1) {
    return canvases[0];
  }
  const target = document.createElement("canvas");
  target.width = Math.max(...canvases.map((canvas) => canvas.width));
  target.height = Math.max(...canvases.map((canvas) => canvas.height));
  const context = target.getContext("2d");
  if (!context) {
    return canvases[0];
  }
  for (const canvas of canvases) {
    context.drawImage(canvas, 0, 0);
  }
  return target;
};

const drawScaledCanvas = (
  source: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
) => {
  const scale = Math.min(1, MAX_SNAPSHOT_EDGE / Math.max(crop.width, crop.height));
  const target = document.createElement("canvas");
  target.width = Math.max(1, Math.round(crop.width * scale));
  target.height = Math.max(1, Math.round(crop.height * scale));
  const context = target.getContext("2d");
  if (!context) {
    return null;
  }
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    target.width,
    target.height,
  );
  return target;
};

const snapshotFromCanvas = (
  source: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
  scope: "canvas" | "selection",
  sourceType: AgentCanvasSnapshot["source"],
): AgentCanvasSnapshot => {
  const target = drawScaledCanvas(source, crop);
  if (!target) {
    return createEmptySnapshot(scope, "Could not prepare canvas snapshot.");
  }
  const dataUrl = target.toDataURL("image/png");
  return {
    scope,
    dataUrl,
    width: target.width,
    height: target.height,
    mimeType: "image/png",
    byteLength: byteLengthFromDataUrl(dataUrl),
    capturedAt: new Date().toISOString(),
    source: sourceType,
  };
};

const clampCrop = (
  canvas: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
) => {
  const x = Math.max(0, Math.min(canvas.width - 1, crop.x));
  const y = Math.max(0, Math.min(canvas.height - 1, crop.y));
  const width = Math.max(1, Math.min(canvas.width - x, crop.width));
  const height = Math.max(1, Math.min(canvas.height - y, crop.height));
  return { x, y, width, height };
};

const getSelectionRect = (page: Page, selection: EditorSelectionItem) => {
  if (selection.objectType === "panel") {
    const panel = page.panels.find((entry) => entry.id === selection.objectId);
    return panel ? { x: panel.x, y: panel.y, width: panel.width, height: panel.height } : null;
  }
  if (selection.objectType === "text") {
    const text = page.texts.find((entry) => entry.id === selection.objectId);
    return text ? { x: text.x, y: text.y, width: text.width, height: text.height } : null;
  }
  if (selection.objectType === "element") {
    const element = page.elements.find((entry) => entry.id === selection.objectId);
    return element ? { x: element.x, y: element.y, width: element.width, height: element.height } : null;
  }
  const bubble = page.bubbles.find((entry) => entry.id === selection.objectId);
  return bubble ? { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height } : null;
};

const getPageCanvasMetrics = (page: Page, zoom: number) => {
  const wrap = document.querySelector<HTMLDivElement>(".canvas-wrap");
  const stage = document.querySelector<HTMLDivElement>(".canvas-wrap .konvajs-content");
  if (!wrap || !stage) {
    return null;
  }
  const styles = window.getComputedStyle(wrap);
  const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const viewportWidth = Math.max(0, wrap.clientWidth - horizontalPadding);
  const viewportHeight = Math.max(0, wrap.clientHeight - verticalPadding);
  const workspace = getPageWorkspace(page);
  const fitScale =
    viewportWidth > 0 && viewportHeight > 0
      ? Math.min(viewportWidth / workspace.width, viewportHeight / workspace.height, 1)
      : 1;
  const coverWorkspaceScale =
    viewportWidth > 0 && viewportHeight > 0
      ? Math.max(viewportWidth / workspace.width, viewportHeight / workspace.height)
      : 1;
  const scale = Math.max(0.1, fitScale * zoom);
  const workspaceScale = zoom > 1 ? Math.max(coverWorkspaceScale, scale) : coverWorkspaceScale;
  const workspaceCanvasWidth = workspace.width * workspaceScale;
  const workspaceCanvasHeight = workspace.height * workspaceScale;
  const baseStageWidth = Math.max(1, viewportWidth);
  const baseStageHeight = Math.max(1, viewportHeight);
  const shouldUseScrollableStage =
    zoom > 1 &&
    (workspaceCanvasWidth > baseStageWidth || workspaceCanvasHeight > baseStageHeight);
  const stageWidth = shouldUseScrollableStage
    ? Math.max(1, Math.ceil(workspaceCanvasWidth))
    : baseStageWidth;
  const stageHeight = shouldUseScrollableStage
    ? Math.max(1, Math.ceil(workspaceCanvasHeight))
    : baseStageHeight;
  const workspaceCanvasX = (stageWidth - workspaceCanvasWidth) * 0.5;
  const workspaceCanvasY = (stageHeight - workspaceCanvasHeight) * 0.5;
  const contentCanvasX =
    workspaceCanvasWidth * 0.5 - (workspace.x + workspace.width * 0.5) * scale;
  const contentCanvasY =
    workspaceCanvasHeight * 0.5 - (workspace.y + workspace.height * 0.5) * scale;
  return {
    scale,
    pageX: workspaceCanvasX + contentCanvasX,
    pageY: workspaceCanvasY + contentCanvasY,
    stageRect: stage.getBoundingClientRect(),
  };
};

const getSelectionCrop = (canvas: HTMLCanvasElement, page: Page, selection: EditorSelectionItem, zoom: number) => {
  const rect = getSelectionRect(page, selection);
  const metrics = rect ? getPageCanvasMetrics(page, zoom) : null;
  if (!rect || !metrics) {
    return null;
  }
  const margin = 24;
  const scaleX = canvas.width / metrics.stageRect.width;
  const scaleY = canvas.height / metrics.stageRect.height;
  return clampCrop(canvas, {
    x: (metrics.pageX + rect.x * metrics.scale - margin) * scaleX,
    y: (metrics.pageY + rect.y * metrics.scale - margin) * scaleY,
    width: (rect.width * metrics.scale + margin * 2) * scaleX,
    height: (rect.height * metrics.scale + margin * 2) * scaleY,
  });
};

export const captureCurrentCanvasSnapshot = async (
  scope: "canvas" | "selection" = "canvas",
): Promise<AgentCanvasSnapshot> => {
  if (typeof document === "undefined") {
    return createEmptySnapshot(scope, "Canvas snapshots are only available in the browser.");
  }
  const state = useEditorStore.getState();
  const page =
    state.project.pages.find((entry) => entry.id === state.selectedPageId) ??
    state.project.pages[0] ??
    null;
  if (!page) {
    return createEmptySnapshot(scope, "No current page is available.");
  }
  try {
    const renderedPage = await renderPageToCanvas(page);
    const crop =
      scope === "selection" && state.selection?.pageId === page.id
        ? getSelectionRect(page, state.selection)
        : { x: 0, y: 0, width: renderedPage.width, height: renderedPage.height };
    if (!crop) {
      return createEmptySnapshot(scope, "The current selection could not be mapped to the page render.");
    }
    return snapshotFromCanvas(renderedPage, clampCrop(renderedPage, crop), scope, "page-render");
  } catch (error) {
    const fallbackCanvas = getFallbackCanvas();
    if (!fallbackCanvas) {
      return createEmptySnapshot(
        scope,
        error instanceof Error ? error.message : "Canvas snapshot failed.",
      );
    }
    const crop =
      scope === "selection" && state.selection?.pageId === page.id
        ? getSelectionCrop(fallbackCanvas, page, state.selection, state.zoom)
        : { x: 0, y: 0, width: fallbackCanvas.width, height: fallbackCanvas.height };
    if (!crop) {
      return createEmptySnapshot(scope, "The current selection could not be mapped to the fallback canvas.");
    }
    return snapshotFromCanvas(fallbackCanvas, crop, scope, "dom-canvas");
  }
};

export const listImageAssets = (project: Project = useEditorStore.getState().project): AgentImageAsset[] =>
  project.pages.flatMap((page) =>
    page.panels.flatMap((panel) =>
      panel.image
        ? [
            {
              src: panel.image.src,
              pageId: page.id,
              pageName: page.name,
              panelId: panel.id,
              sourceWidth: panel.image.sourceWidth ?? panel.image.viewBox.width,
              sourceHeight: panel.image.sourceHeight ?? panel.image.viewBox.height,
              viewBox: { ...panel.image.viewBox },
              ...(panel.image.clip ? { clip: { ...panel.image.clip } } : {}),
              ...(panel.image.transform ? { transform: { ...panel.image.transform } } : {}),
              prompt: panel.image.prompt ?? "",
              description: panel.description ?? "",
            },
          ]
        : [],
    ),
  );

const summarizePage = (page: Page): AgentPageSummary => ({
  id: page.id,
  name: page.name,
  width: page.width,
  height: page.height,
  background: page.background,
  panelCount: page.panels.length,
  textCount: page.texts.length,
  bubbleCount: page.bubbles.length,
  layerCount: page.layers.length,
});

const summarizeObjects = (page: Page): AgentObjectSummary[] => {
  const objects: AgentObjectSummary[] = [];
  for (const [layerIndex, layerRef] of page.layers.entries()) {
    const [objectType, objectId] = layerRef.split(":", 2);
    if (objectType === "panel") {
      const panel = page.panels.find((entry) => entry.id === objectId);
      if (panel) {
        objects.push({
          id: panel.id,
          objectType,
          x: panel.x,
          y: panel.y,
          width: panel.width,
          height: panel.height,
          rotation: panel.rotation,
          layerRef,
          layerIndex,
          description: panel.description,
          points: panel.points.map((point) => ({ ...point })),
          fillColor: panel.style.fill,
          strokeColor: panel.style.stroke,
          strokeWidth: panel.style.strokeWidth,
          hasImage: Boolean(panel.image),
          image: panel.image
            ? {
                src: panel.image.src,
                pageId: page.id,
                pageName: page.name,
                panelId: panel.id,
                sourceWidth: panel.image.sourceWidth ?? panel.image.viewBox.width,
                sourceHeight: panel.image.sourceHeight ?? panel.image.viewBox.height,
                viewBox: { ...panel.image.viewBox },
                ...(panel.image.clip ? { clip: { ...panel.image.clip } } : {}),
                ...(panel.image.transform ? { transform: { ...panel.image.transform } } : {}),
                prompt: panel.image.prompt ?? "",
                description: panel.description ?? "",
              }
            : undefined,
        });
      }
      continue;
    }
    if (objectType === "text") {
      const text = page.texts.find((entry) => entry.id === objectId);
      if (text) {
        objects.push({
          id: text.id,
          objectType,
          x: text.x,
          y: text.y,
          width: text.width,
          height: text.height,
          layerRef,
          layerIndex,
          content: text.content,
          direction: text.direction,
          fontFamily: text.fontFamily,
          fontSize: text.fontSize,
          fontWeight: text.fontWeight,
          color: text.color,
          textAlign: text.textAlign,
          verticalAlign: text.verticalAlign,
          strokeColor: text.strokeColor,
          strokeWidth: text.strokeWidth,
        });
      }
      continue;
    }
    if (objectType === "bubble") {
      const bubble = page.bubbles.find((entry) => entry.id === objectId);
      if (bubble) {
        objects.push({
          id: bubble.id,
          objectType,
          x: bubble.x,
          y: bubble.y,
          width: bubble.width,
          height: bubble.height,
          layerRef,
          layerIndex,
          bubbleType: bubble.bubbleType,
          showTail: bubble.showTail,
          tailTip: { ...bubble.tailTip },
          ...(bubble.tailBase ? { tailBase: { ...bubble.tailBase } } : {}),
          backgroundColor: bubble.backgroundColor,
          strokeColor: bubble.strokeColor,
          strokeWidth: bubble.strokeWidth,
          opacity: bubble.opacity,
          contentCenter: { ...bubble.contentCenter },
        });
      }
      continue;
    }
    if (objectType === "element") {
      const element = page.elements.find((entry) => entry.id === objectId);
      if (element) {
        objects.push({
          id: element.id,
          objectType,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
          layerRef,
          layerIndex,
          content: element.title,
          opacity: element.opacity,
        });
      }
    }
  }
  return objects;
};

export const getAgentContext = async (): Promise<AgentContextSnapshot> => {
  const state = useEditorStore.getState();
  const selectedPage =
    state.project.pages.find((page) => page.id === state.selectedPageId) ??
    state.project.pages[0] ??
    null;
  const canvasSnapshot = await captureCurrentCanvasSnapshot("canvas");
  const selectionSnapshot =
    selectedPage && state.selection?.pageId === selectedPage.id
      ? await captureCurrentCanvasSnapshot("selection")
      : null;
  const objects = selectedPage ? summarizeObjects(selectedPage) : [];
  const selectedObject =
    state.selection && selectedPage
      ? objects.find(
          (object) =>
            object.objectType === state.selection?.objectType &&
            object.id === state.selection.objectId,
        ) ?? null
      : null;
  return {
    project: {
      id: state.project.id,
      title: state.project.title,
      type: state.project.type,
      createdAt: state.project.createdAt,
      updatedAt: state.project.updatedAt,
      pageCount: state.project.pages.length,
    },
    selectedPageId: selectedPage?.id ?? null,
    currentPage: selectedPage ? summarizePage(selectedPage) : null,
    pages: state.project.pages.map(summarizePage),
    selection: state.selection ? { ...state.selection } : null,
    multiSelection: state.multiSelection.map((entry) => ({ ...entry })),
    activeTool: state.activeTool,
    zoom: state.zoom,
    saveStatus: { ...state.saveStatus },
    objects,
    selectedObject,
    imageAssets: listImageAssets(state.project),
    commandManifest: buildCommandManifest(),
    canvasSnapshot,
    selectionSnapshot,
  };
};

export const readImageAsset = async (src: string) => {
  const asset = listImageAssets().find((entry) => entry.src === src) ?? null;
  if (!asset) {
    throw new Error(`Image asset not found: ${src}`);
  }
  if (src.startsWith("data:")) {
    return { ...asset, dataUrl: src };
  }
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to read image asset: ${response.status}`);
  }
  const blob = await response.blob();
  const reader = new FileReader();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { ...asset, dataUrl };
};
