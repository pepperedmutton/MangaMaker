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
import type {
  Bubble,
  ElementItem,
  ObjectType,
  Page,
  Panel,
  Point,
  Project,
  Rect,
  TextDirection,
  TextItem,
} from "./schema";
import type { EditorSelection } from "../state/types";

type RenderableLayer =
  | { layer: string; objectType: "panel"; object: Panel }
  | { layer: string; objectType: "text"; object: TextItem }
  | { layer: string; objectType: "bubble"; object: Bubble }
  | { layer: string; objectType: "element"; object: ElementItem };

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

export const clampElementRectToWorkspace = (
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
) => {
  return clampRectToWorkspace(page, rect, 24, 24);
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

export const getBubbleTextBounds = (
  bubble: Pick<Bubble, "width" | "height" | "bubbleType">,
) => {
  let paddingX = 24;
  let paddingY = 24;

  if (bubble.bubbleType === "thought") {
    paddingX = bubble.width * 0.22;
    paddingY = bubble.height * 0.2;
  } else if (bubble.bubbleType === "cloud" || bubble.bubbleType === "cloudDense") {
    paddingX = bubble.width * 0.18;
    paddingY = bubble.height * 0.16;
  } else if (bubble.bubbleType === "whisper") {
    // Whisper has additional shape clipping now, so keep tighter insets
    // to avoid wasting too much interior space.
    paddingX = bubble.width * 0.16;
    paddingY = bubble.height * 0.14;
  } else if (
    bubble.bubbleType === "explosion" ||
    bubble.bubbleType === "scream" ||
    bubble.bubbleType === "burstSoft" ||
    bubble.bubbleType === "jagged" ||
    bubble.bubbleType === "electric" ||
    bubble.bubbleType === "wave" ||
    bubble.bubbleType === "rough"
  ) {
    paddingX = bubble.width * 0.2;
    paddingY = bubble.height * 0.18;
  }

  const clampedPaddingX = clamp(paddingX, 8, Math.max(8, bubble.width * 0.45 - 1));
  const clampedPaddingY = clamp(paddingY, 8, Math.max(8, bubble.height * 0.45 - 1));

  return {
    x: clampedPaddingX,
    y: clampedPaddingY,
    width: Math.max(1, bubble.width - clampedPaddingX * 2),
    height: Math.max(1, bubble.height - clampedPaddingY * 2),
  };
};

type BubbleTextProfilePreset = {
  exponent: number;
  minRatio: number;
};

const getBubbleTextProfilePreset = (
  bubbleType: Bubble["bubbleType"],
): BubbleTextProfilePreset => {
  switch (bubbleType) {
    case "diamond":
    case "speed":
    case "arrow":
    case "electric":
      return { exponent: 1, minRatio: 0.24 };
    case "hexagon":
      return { exponent: 1.45, minRatio: 0.3 };
    case "octagon":
      return { exponent: 1.9, minRatio: 0.34 };
    case "explosion":
    case "scream":
    case "jagged":
    case "wave":
      return { exponent: 1.35, minRatio: 0.3 };
    case "whisper":
      // Clip guard is applied for whisper, so allow wider side columns.
      return { exponent: 2.2, minRatio: 0.42 };
    case "ellipse":
    case "oval":
    case "burstSoft":
    case "bubbleRound":
    case "cloud":
    case "thought":
    case "cloudDense":
    case "balloonTall":
    case "rough":
    case "droplet":
    case "pinched":
    case "heart":
      return { exponent: 2.1, minRatio: 0.34 };
    case "round":
    case "roundedSquare":
    case "square":
    case "balloonWide":
    case "caption":
    case "bracket":
    case "doubleOutline":
    default:
      return { exponent: 5.2, minRatio: 0.74 };
  }
};

const sampleSuperellipseProfile = (position: number, exponent: number) => {
  const clampedPosition = clamp(position, 0, 1);
  const centerOffset = Math.abs(clampedPosition * 2 - 1);
  if (centerOffset >= 1) {
    return 0;
  }
  if (exponent <= 1.001) {
    return 1 - centerOffset;
  }
  const base = Math.max(0, 1 - centerOffset ** exponent);
  return base ** (1 / exponent);
};

const resolveBubbleProfileRatio = (
  bubbleType: Bubble["bubbleType"],
  position: number,
) => {
  const preset = getBubbleTextProfilePreset(bubbleType);
  const shapeRatio = sampleSuperellipseProfile(position, preset.exponent);
  return clamp(preset.minRatio + (1 - preset.minRatio) * shapeRatio, preset.minRatio, 1);
};

export const getBubbleTextFlowProfile = (
  bubble: Pick<Bubble, "bubbleType">,
  textBounds: Pick<Rect, "width" | "height">,
  metrics: {
    fontSize: number;
    lineHeight: number;
    measureText: (text: string) => number;
  },
) => {
  const rowAdvance = Math.max(1, metrics.fontSize * metrics.lineHeight);
  const sampleCellWidth = Math.max(
    metrics.fontSize * 0.75,
    metrics.measureText("\u56fd"),
    metrics.measureText("M"),
    metrics.measureText("\u53e3"),
  );
  const columnAdvance = Math.max(1, sampleCellWidth * 1.04);

  const lineCount = Math.max(1, Math.floor(textBounds.height / rowAdvance));
  const columnCount = Math.max(1, Math.floor(textBounds.width / columnAdvance));
  const maxRows = Math.max(1, Math.floor(textBounds.height / rowAdvance));

  const lineWidthProfile = Array.from({ length: lineCount }, (_, index) => {
    if (lineCount <= 2) {
      return textBounds.width;
    }
    const position = (index + 0.5) / lineCount;
    return Math.max(
      1,
      textBounds.width * resolveBubbleProfileRatio(bubble.bubbleType, position),
    );
  });

  // Vertical columns are laid out from right to left, so sample profile from right edge first.
  const columnRowProfile = Array.from({ length: columnCount }, (_, index) => {
    if (columnCount <= 2) {
      return maxRows;
    }
    const position = 1 - (index + 0.5) / columnCount;
    const ratio = resolveBubbleProfileRatio(bubble.bubbleType, position);
    return Math.max(1, Math.min(maxRows, Math.floor(maxRows * ratio)));
  });

  return {
    lineWidthProfile,
    columnRowProfile,
  };
};

const getBubbleLocalCenter = (bubble: Pick<Bubble, "width" | "height">) => ({
  x: bubble.width * 0.5,
  y: bubble.height * 0.5,
});

type BubbleBoundarySample = Pick<
  Bubble,
  | "width"
  | "height"
  | "bubbleType"
  | "spikeDepth"
  | "spikeCount"
  | "tailBaseAngle"
> & {
  customPoints?: Point[];
};

const getCustomBubbleBoundaryPoint = (
  bubble: BubbleBoundarySample,
  target: Point,
) => {
  const points = bubble.customPoints;
  if (!points || points.length < 3) {
    return null;
  }
  const center = getBubbleLocalCenter(bubble);
  const direction = {
    x: target.x - center.x,
    y: target.y - center.y,
  };
  if (Math.abs(direction.x) < 0.0001 && Math.abs(direction.y) < 0.0001) {
    return null;
  }

  let nearestT = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const segment = {
      x: end.x - start.x,
      y: end.y - start.y,
    };
    const toSegmentStart = {
      x: start.x - center.x,
      y: start.y - center.y,
    };
    const denominator = direction.x * segment.y - direction.y * segment.x;
    if (Math.abs(denominator) < 0.000001) {
      continue;
    }
    const t =
      (toSegmentStart.x * segment.y - toSegmentStart.y * segment.x) / denominator;
    const u =
      (toSegmentStart.x * direction.y - toSegmentStart.y * direction.x) / denominator;
    if (t < 0 || u < -0.0001 || u > 1.0001) {
      continue;
    }
    if (t < nearestT) {
      nearestT = t;
    }
  }

  if (!Number.isFinite(nearestT)) {
    return null;
  }

  return {
    x: center.x + direction.x * nearestT,
    y: center.y + direction.y * nearestT,
  };
};

const getBubbleLocalBoundaryPoint = (
  bubble: BubbleBoundarySample,
  target: Point,
) => {
  const center = getBubbleLocalCenter(bubble);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
    return center;
  }

  let scale: number;
  switch (bubble.bubbleType) {
    case "ellipse":
    case "oval":
    case "whisper":
    case "burstSoft":
    case "hexagon":
    case "octagon":
    case "diamond":
    case "heart":
    case "balloonTall":
    case "balloonWide":
    case "droplet":
    case "pinched":
    case "doubleOutline": {
      const radiusX = bubble.width * 0.5;
      const radiusY = bubble.height * 0.5;
      scale =
        1 /
        Math.sqrt(
          (dx * dx) / Math.max(radiusX * radiusX, 0.0001) +
            (dy * dy) / Math.max(radiusY * radiusY, 0.0001),
        );
      break;
    }
    case "bubbleRound": {
      const radius = Math.min(bubble.width, bubble.height) * 0.5;
      scale = radius / Math.max(Math.hypot(dx, dy), 0.0001);
      break;
    }
    case "cloud":
    case "thought":
    case "cloudDense": {
      const radiusX = bubble.width * 0.425;
      const radiusY = bubble.height * 0.425;
      scale =
        1 /
        Math.sqrt(
          (dx * dx) / Math.max(radiusX * radiusX, 0.0001) +
            (dy * dy) / Math.max(radiusY * radiusY, 0.0001),
        );
      break;
    }
    case "explosion":
    case "scream": {
      const radius = Math.min(bubble.width, bubble.height) * 0.48;
      scale = radius / Math.max(Math.hypot(dx, dy), 0.0001);
      break;
    }
    case "jagged":
    case "wave":
    case "rough":
    case "electric": {
      scale = Math.min(
        (bubble.width * 0.48) / Math.max(Math.abs(dx), 0.0001),
        (bubble.height * 0.48) / Math.max(Math.abs(dy), 0.0001),
      );
      break;
    }
    case "custom": {
      const customBoundary = getCustomBubbleBoundaryPoint(bubble, target);
      if (customBoundary) {
        return customBoundary;
      }
      scale = Math.min(
        (bubble.width * 0.5) / Math.max(Math.abs(dx), 0.0001),
        (bubble.height * 0.5) / Math.max(Math.abs(dy), 0.0001),
      );
      break;
    }
    case "round":
    case "roundedSquare":
    case "square":
    default: {
      scale = Math.min(
        (bubble.width * 0.5) / Math.max(Math.abs(dx), 0.0001),
        (bubble.height * 0.5) / Math.max(Math.abs(dy), 0.0001),
      );
      break;
    }
  }

  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
};

const getLegacyBubbleTailBaseLocalPoint = (
  bubble: BubbleBoundarySample,
) => {
  const center = getBubbleLocalCenter(bubble);
  const angleRad = ((bubble.tailBaseAngle - 90) * Math.PI) / 180;
  return getBubbleLocalBoundaryPoint(bubble, {
    x: center.x + Math.cos(angleRad),
    y: center.y + Math.sin(angleRad),
  });
};

export const getBubbleTailBaseLocalPoint = (
  bubble: BubbleBoundarySample & Pick<Bubble, "tailBase">,
) =>
  bubble.tailBase
    ? clampBubbleTailBaseLocalPoint(bubble, bubble.tailBase)
    : getLegacyBubbleTailBaseLocalPoint(bubble);

export const clampBubbleTailBaseLocalPoint = (
  bubble: BubbleBoundarySample,
  point: Point,
) => {
  const clampedPoint = {
    x: clamp(point.x, 0, bubble.width),
    y: clamp(point.y, 0, bubble.height),
  };
  const center = getBubbleLocalCenter(bubble);
  let boundary = getBubbleLocalBoundaryPoint(bubble, clampedPoint);
  let boundaryDistance = Math.hypot(boundary.x - center.x, boundary.y - center.y);
  if (boundaryDistance < 0.0001) {
    boundary = getLegacyBubbleTailBaseLocalPoint(bubble);
    boundaryDistance = Math.hypot(boundary.x - center.x, boundary.y - center.y);
  }
  if (boundaryDistance < 0.0001) {
    return center;
  }
  // Keep the base handle exactly on the bubble boundary to avoid a visible inner seam.
  return boundary;
};

export const scaleBubbleLocalPoint = (
  point: Point,
  previousWidth: number,
  previousHeight: number,
  nextWidth: number,
  nextHeight: number,
) => ({
  x: point.x * (nextWidth / Math.max(previousWidth, 0.0001)),
  y: point.y * (nextHeight / Math.max(previousHeight, 0.0001)),
});

export const getBubbleTailBaseAngleFromLocalPoint = (
  bubble: Pick<Bubble, "width" | "height" | "tailBaseAngle">,
  point: Point,
) => {
  const center = getBubbleLocalCenter(bubble);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
    return bubble.tailBaseAngle;
  }
  return (((Math.atan2(dy, dx) * 180) / Math.PI + 90) % 360 + 360) % 360;
};

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
): Panel | TextItem | Bubble | ElementItem | null => {
  if (!selection || selection.pageId !== page.id) {
    return null;
  }

  if (selection.objectType === "panel") {
    return page.panels.find((panel) => panel.id === selection.objectId) ?? null;
  }

  if (selection.objectType === "text") {
    return page.texts.find((text) => text.id === selection.objectId) ?? null;
  }

  if (selection.objectType === "element") {
    return (page.elements ?? []).find((element) => element.id === selection.objectId) ?? null;
  }

  return page.bubbles.find((bubble) => bubble.id === selection.objectId) ?? null;
};

const isRenderableLayer = (
  entry:
    | { layer: string; objectType: "panel"; object: Panel | null }
    | { layer: string; objectType: "text"; object: TextItem | null }
    | { layer: string; objectType: "bubble"; object: Bubble | null }
    | { layer: string; objectType: "element"; object: ElementItem | null },
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
      if (layer.startsWith("element:")) {
        return {
          layer,
          objectType: "element" as const,
          object: (page.elements ?? []).find((element) => element.id === layer.slice("element:".length)) ?? null,
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
  const centerLocal = getBubbleTailBaseLocalPoint(bubble);
  const localCenter = getBubbleLocalCenter(bubble);
  const center = {
    x: bubble.x + centerLocal.x,
    y: bubble.y + centerLocal.y,
  };
  let directionX = bubble.tailTip.x - center.x;
  let directionY = bubble.tailTip.y - center.y;
  if (Math.abs(directionX) < 0.0001 && Math.abs(directionY) < 0.0001) {
    const fallbackAngleRad = ((bubble.tailBaseAngle - 90) * Math.PI) / 180;
    directionX = Math.cos(fallbackAngleRad);
    directionY = Math.sin(fallbackAngleRad);
  }
  const halfWidth = bubble.tailWidth * 0.5;
  let radialX = centerLocal.x - localCenter.x;
  let radialY = centerLocal.y - localCenter.y;
  let radialLength = Math.hypot(radialX, radialY);
  if (radialLength < 0.0001) {
    const fallbackAngleRad = ((bubble.tailBaseAngle - 90) * Math.PI) / 180;
    radialX = Math.cos(fallbackAngleRad);
    radialY = Math.sin(fallbackAngleRad);
    radialLength = 1;
  }
  const baseAngle = Math.atan2(radialY, radialX);
  const angleOffset = Math.min(Math.PI * 0.45, halfWidth / Math.max(radialLength, 1));
  const leftLocal = getBubbleLocalBoundaryPoint(bubble, {
    x: localCenter.x + Math.cos(baseAngle + angleOffset),
    y: localCenter.y + Math.sin(baseAngle + angleOffset),
  });
  const rightLocal = getBubbleLocalBoundaryPoint(bubble, {
    x: localCenter.x + Math.cos(baseAngle - angleOffset),
    y: localCenter.y + Math.sin(baseAngle - angleOffset),
  });

  return {
    left: {
      x: bubble.x + leftLocal.x,
      y: bubble.y + leftLocal.y,
    },
    right: {
      x: bubble.x + rightLocal.x,
      y: bubble.y + rightLocal.y,
    },
    center,
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

export const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
};

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

export const preservePanelImageViewBox = (
  previousPanel: Pick<Panel, "x" | "y" | "width" | "height">,
  nextPanel: Pick<Panel, "x" | "y" | "width" | "height">,
  sourceWidth: number,
  sourceHeight: number,
  viewBox: Rect,
) => {
  const renderedImageLeft =
    previousPanel.x - (viewBox.x / viewBox.width) * previousPanel.width;
  const renderedImageTop =
    previousPanel.y - (viewBox.y / viewBox.height) * previousPanel.height;
  const renderedImageWidth = (sourceWidth / viewBox.width) * previousPanel.width;
  const renderedImageHeight = (sourceHeight / viewBox.height) * previousPanel.height;

  const nextViewBoxWidth = (sourceWidth * nextPanel.width) / renderedImageWidth;
  const nextViewBoxHeight = (sourceHeight * nextPanel.height) / renderedImageHeight;

  return clampImageViewBox(sourceWidth, sourceHeight, {
    x: ((nextPanel.x - renderedImageLeft) / nextPanel.width) * nextViewBoxWidth,
    y: ((nextPanel.y - renderedImageTop) / nextPanel.height) * nextViewBoxHeight,
    width: nextViewBoxWidth,
    height: nextViewBoxHeight,
  });
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

export const getDisplayedContentByDirection = (content: string, direction: TextDirection) =>
  direction === "vertical" ? getVerticalTextLines(content) : content;

export const getDisplayedTextContent = (text: Pick<TextItem, "content" | "direction">) =>
  getDisplayedContentByDirection(text.content, text.direction);

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
