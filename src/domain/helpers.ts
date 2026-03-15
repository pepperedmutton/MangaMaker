import {
  GRID_SIZE,
  MIN_BUBBLE_HEIGHT,
  MIN_BUBBLE_WIDTH,
  MIN_PANEL_SIZE,
  MIN_TEXT_BOX_HEIGHT,
  MIN_TEXT_BOX_WIDTH,
  WORKSPACE_PAGE_AREA_RATIO,
  createRectanglePanelPoints,
} from "./defaults";
import type { Bubble, ObjectType, Page, Panel, Point, Project, Rect, TextItem } from "./schema";
import type { EditorSelection } from "../state/types";

type RenderableLayer =
  | { layer: string; objectType: "panel"; object: Panel }
  | { layer: string; objectType: "text"; object: TextItem }
  | { layer: string; objectType: "bubble"; object: Bubble };

export const snapValue = (value: number, step = GRID_SIZE) =>
  Math.round(value / step) * step;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const getPageWorkspace = (
  page: Pick<Page, "width" | "height">,
): Rect => {
  const scaleFactor = 1 / Math.sqrt(WORKSPACE_PAGE_AREA_RATIO);
  const width = page.width * scaleFactor;
  const height = page.height * scaleFactor;
  return {
    x: -((width - page.width) * 0.5),
    y: -((height - page.height) * 0.5),
    width,
    height,
  };
};

export const getPageWorkspaceOffset = (page: Pick<Page, "width" | "height">) => {
  const workspace = getPageWorkspace(page);
  return {
    x: -workspace.x,
    y: -workspace.y,
  };
};

export const clampRectToWorkspace = (
  page: Pick<Page, "width" | "height">,
  rect: { x: number; y: number; width: number; height: number },
  minimumWidth: number,
  minimumHeight = minimumWidth,
) => {
  const workspace = getPageWorkspace(page);
  const width = clamp(snapValue(rect.width), minimumWidth, workspace.width);
  const height = clamp(snapValue(rect.height), minimumHeight, workspace.height);
  const x = clamp(
    snapValue(rect.x),
    workspace.x,
    workspace.x + workspace.width - width,
  );
  const y = clamp(
    snapValue(rect.y),
    workspace.y,
    workspace.y + workspace.height - height,
  );
  return { x, y, width, height };
};

export const clampPanelRectToWorkspace = (
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
) => clampRectToWorkspace(page, rect, MIN_PANEL_SIZE);

export const clampBubbleRectToWorkspace = (
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
) => {
  return clampRectToWorkspace(page, rect, MIN_BUBBLE_WIDTH, MIN_BUBBLE_HEIGHT);
};

export const clampTextBoxToWorkspace = (
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
) => {
  return clampRectToWorkspace(page, rect, MIN_TEXT_BOX_WIDTH, MIN_TEXT_BOX_HEIGHT);
};

export const clampPointToWorkspace = (
  page: Pick<Page, "width" | "height">,
  point: Point,
) => {
  const workspace = getPageWorkspace(page);
  return {
    x: clamp(snapValue(point.x), workspace.x, workspace.x + workspace.width),
    y: clamp(snapValue(point.y), workspace.y, workspace.y + workspace.height),
  };
};

export const toLayerRef = (objectType: ObjectType, objectId: string) =>
  `${objectType}:${objectId}`;

export const removeLayerRef = (layers: string[], objectType: ObjectType, objectId: string) =>
  layers.filter((layer) => layer !== toLayerRef(objectType, objectId));

export const shiftBubbleTail = (bubble: Bubble, deltaX: number, deltaY: number): Bubble => ({
  ...bubble,
  tailTip: {
    x: bubble.tailTip.x + deltaX,
    y: bubble.tailTip.y + deltaY,
  },
});

export const getPageById = (project: Project, pageId: string) => {
  const page = project.pages.find((entry) => entry.id === pageId);
  if (!page) {
    throw new Error(`Page not found: ${pageId}`);
  }
  return page;
};

export const getSelectedObject = (
  page: Page,
  selection: EditorSelection,
): Panel | TextItem | Bubble | null => {
  if (!selection || selection.pageId !== page.id) {
    return null;
  }

  if (selection.objectType === "panel") {
    return page.panels.find((panel) => panel.id === selection.objectId) ?? null;
  }

  if (selection.objectType === "text") {
    return page.texts.find((text) => text.id === selection.objectId) ?? null;
  }

  return page.bubbles.find((bubble) => bubble.id === selection.objectId) ?? null;
};

const isRenderableLayer = (
  entry:
    | { layer: string; objectType: "panel"; object: Panel | null }
    | { layer: string; objectType: "text"; object: TextItem | null }
    | { layer: string; objectType: "bubble"; object: Bubble | null },
): entry is RenderableLayer => entry.object !== null;

export const getRenderableLayers = (page: Page): RenderableLayer[] =>
  page.layers
    .map((layer) => {
      if (layer.startsWith("panel:")) {
        return {
          layer,
          objectType: "panel" as const,
          object: page.panels.find((panel) => panel.id === layer.slice("panel:".length)) ?? null,
        };
      }
      if (layer.startsWith("text:")) {
        return {
          layer,
          objectType: "text" as const,
          object: page.texts.find((text) => text.id === layer.slice("text:".length)) ?? null,
        };
      }
      return {
        layer,
        objectType: "bubble" as const,
        object: page.bubbles.find((bubble) => bubble.id === layer.slice("bubble:".length)) ?? null,
      };
    })
    .filter(isRenderableLayer);

export const getBubbleBasePoints = (bubble: Bubble) => {
  const centerX = bubble.x + bubble.width * 0.5;
  const baseY = bubble.y + bubble.height;
  return {
    left: { x: centerX - 20, y: baseY },
    right: { x: centerX + 20, y: baseY },
  };
};

export const getPanelAbsolutePoints = (panel: Panel): Point[] =>
  panel.points.map((point) => ({
    x: panel.x + point.x,
    y: panel.y + point.y,
  }));

export const scalePanelPoints = (
  points: Point[],
  previousWidth: number,
  previousHeight: number,
  nextWidth: number,
  nextHeight: number,
) => {
  const scaleX = nextWidth / previousWidth;
  const scaleY = nextHeight / previousHeight;
  return points.map((point) => ({
    x: snapValue(point.x * scaleX),
    y: snapValue(point.y * scaleY),
  }));
};

export const clampPointToPanel = (point: Point, panel: Pick<Panel, "width" | "height">) => ({
  x: clamp(snapValue(point.x), 0, panel.width),
  y: clamp(snapValue(point.y), 0, panel.height),
});

export const insertPanelPoint = (panel: Panel, afterIndex?: number) => {
  const index =
    afterIndex !== undefined
      ? afterIndex
      : panel.points.reduce(
          (longestIndex, point, currentIndex) => {
            const nextPoint = panel.points[(currentIndex + 1) % panel.points.length];
            const longestPoint = panel.points[longestIndex];
            const longestNextPoint = panel.points[(longestIndex + 1) % panel.points.length];
            const currentDistance = Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y);
            const longestDistance = Math.hypot(
              longestNextPoint.x - longestPoint.x,
              longestNextPoint.y - longestPoint.y,
            );
            return currentDistance > longestDistance ? currentIndex : longestIndex;
          },
          0,
        );

  const start = panel.points[index];
  const end = panel.points[(index + 1) % panel.points.length];
  const insertedPoint = clampPointToPanel(
    {
      x: (start.x + end.x) * 0.5,
      y: (start.y + end.y) * 0.5,
    },
    panel,
  );

  const nextPoints = [...panel.points];
  nextPoints.splice(index + 1, 0, insertedPoint);
  return nextPoints;
};

export const removePanelPoint = (panel: Panel, pointIndex: number) => {
  if (panel.points.length <= 3) {
    return panel.points;
  }
  return panel.points.filter((_, index) => index !== pointIndex);
};

export const getPanelBoundingRect = (panel: Pick<Panel, "x" | "y" | "width" | "height">): Rect => ({
  x: panel.x,
  y: panel.y,
  width: panel.width,
  height: panel.height,
});

export const createInitialPanelViewBox = (
  panel: Pick<Panel, "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
): Rect => {
  const panelRatio = panel.width / panel.height;
  const sourceRatio = sourceWidth / sourceHeight;

  if (sourceRatio > panelRatio) {
    const width = sourceHeight * panelRatio;
    return {
      x: (sourceWidth - width) * 0.5,
      y: 0,
      width,
      height: sourceHeight,
    };
  }

  const height = sourceWidth / panelRatio;
  return {
    x: 0,
    y: (sourceHeight - height) * 0.5,
    width: sourceWidth,
    height,
  };
};

export const clampImageViewBox = (
  sourceWidth: number,
  sourceHeight: number,
  viewBox: Rect,
): Rect => {
  const width = clamp(viewBox.width, 20, sourceWidth);
  const height = clamp(viewBox.height, 20, sourceHeight);
  const x = clamp(viewBox.x, 0, Math.max(0, sourceWidth - width));
  const y = clamp(viewBox.y, 0, Math.max(0, sourceHeight - height));
  return { x, y, width, height };
};

export const panImageViewBox = (
  panel: Pick<Panel, "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
  viewBox: Rect,
  deltaX: number,
  deltaY: number,
) =>
  clampImageViewBox(sourceWidth, sourceHeight, {
    ...viewBox,
    x: viewBox.x - (deltaX / panel.width) * viewBox.width,
    y: viewBox.y - (deltaY / panel.height) * viewBox.height,
  });

export const zoomImageViewBox = (
  panel: Pick<Panel, "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
  viewBox: Rect,
  factor: number,
  focusXRatio = 0.5,
  focusYRatio = 0.5,
) => {
  const nextWidth = clamp(viewBox.width * factor, 20, sourceWidth);
  const nextHeight = clamp(viewBox.height * factor, 20, sourceHeight);
  const focusSourceX = viewBox.x + viewBox.width * focusXRatio;
  const focusSourceY = viewBox.y + viewBox.height * focusYRatio;
  return clampImageViewBox(sourceWidth, sourceHeight, {
    x: focusSourceX - nextWidth * focusXRatio,
    y: focusSourceY - nextHeight * focusYRatio,
    width: nextWidth,
    height: nextHeight,
  });
};

export const fitViewBoxToPanelAspect = (
  panel: Pick<Panel, "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
  viewBox: Rect,
) => {
  const targetAspect = panel.width / panel.height;
  const centerX = viewBox.x + viewBox.width * 0.5;
  const centerY = viewBox.y + viewBox.height * 0.5;

  let width = viewBox.width;
  let height = viewBox.height;

  if (width / height > targetAspect) {
    width = height * targetAspect;
  } else {
    height = width / targetAspect;
  }

  if (width > sourceWidth) {
    width = sourceWidth;
    height = width / targetAspect;
  }

  if (height > sourceHeight) {
    height = sourceHeight;
    width = height * targetAspect;
  }

  return clampImageViewBox(sourceWidth, sourceHeight, {
    x: centerX - width * 0.5,
    y: centerY - height * 0.5,
    width,
    height,
  });
};

export const getHorizontalTextLines = (content: string) => content.split(/\r?\n/);

export const getVerticalTextLines = (content: string) =>
  content
    .split(/\r?\n/)
    .map((line) => line.split("").join("\n"))
    .join("\n\n");

export const getDisplayedTextContent = (text: TextItem) =>
  text.direction === "vertical" ? getVerticalTextLines(text.content) : text.content;

export const getOnboardingStep = (project: Project, lastExportKind: string | null) => {
  const hasProject = project.title.trim().length > 0;
  if (!hasProject) {
    return "createProject" as const;
  }
  if (project.pages.length === 0) {
    return "addPage" as const;
  }
  const hasPanel = project.pages.some((page) => page.panels.length > 0);
  if (!hasPanel) {
    return "addPanel" as const;
  }
  const hasImage = project.pages.some((page) => page.panels.some((panel) => panel.image));
  if (!hasImage) {
    return "importImage" as const;
  }
  const hasTextOrBubble = project.pages.some(
    (page) => page.texts.length > 0 || page.bubbles.length > 0,
  );
  if (!hasTextOrBubble) {
    return "addDialogue" as const;
  }
  if (lastExportKind !== "png") {
    return "exportPage" as const;
  }
  return "done" as const;
};

export const getToolbarZoomLabel = (zoom: number) => `${Math.round(zoom * 100)}%`;

export const createDefaultPanelShape = (width: number, height: number) =>
  createRectanglePanelPoints(width, height);
