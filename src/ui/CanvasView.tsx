import { useEffect, useMemo, useRef, useState } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Path,
  Rect,
  Stage,
  Text,
} from "react-konva";
import {
  CG_PAGE_HEIGHT,
  CG_PAGE_WIDTH,
  GRID_SIZE,
  createDefaultBubble,
} from "../domain/defaults";
import {
  clampBubbleTailBaseLocalPoint,
  clampBubbleRectToWorkspace,
  getBubbleBasePoints,
  getPageWorkspace,
  getPanelAbsolutePoints,
  getRenderableLayers,
  getSelectedObject,
  getBubbleTailBaseLocalPoint,
  isPointInPolygon,
  panImageViewBox,
  scaleBubbleLocalPoint,
  snapValue,
  zoomImageViewBox,
} from "../domain/helpers";
import type { Bubble, Page, Panel, Point, Rect as PanelRect, TextItem } from "../domain/schema";
import {
  createCanvasTextMeasurer,
  getTextLineHeightByDirection,
  layoutTextForDisplayLines,
  resolveVerticalColumnAlignFromTextAlign,
} from "../domain/textLayout";
import { useI18n } from "../i18n/useI18n";
import { persistImportedImageForProject } from "../storage/projectFiles";
import { useEditorStore } from "../state/editorStore";
import {
  getBubbleBodyPath,
  getBubbleRegularTailStrokeOutlinePath,
  getBubbleTailPath,
  getExplosionSpikePoints,
} from "./bubbleShapes";

type DraftShape =
  | {
      kind: "panel" | "bubble";
      startX: number;
      startY: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | null;

type CustomBubblePreview = {
  x: number;
  y: number;
  width: number;
  height: number;
  localPoints: Point[];
  path: string;
};

type BoundaryOverlayPreview =
  | {
      objectType: "panel" | "text";
      objectId: string;
      rect: { x: number; y: number; width: number; height: number };
    }
  | null;

const MAX_VISIBLE_CUSTOM_POINT_HANDLES = 2;
const DENSE_CUSTOM_POINT_HANDLE_THRESHOLD = 24;

type ContextMenuTarget =
  | {
      kind: "canvas";
      point: { x: number; y: number };
    }
  | {
      kind: "panel";
      panelId: string;
    }
  | {
      kind: "text";
      textId: string;
    }
  | {
      kind: "bubble";
      bubbleId: string;
    };

type ContextMenuState =
  | {
      x: number;
      y: number;
      target: ContextMenuTarget;
    }
  | null;

type ContextMenuAction = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type MarqueeDragState = {
  startX: number;
  startY: number;
  x: number;
  y: number;
} | null;

type SmartGuideState = {
  x: number;
  y: number;
} | null;

type ResizeHandle =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "right"
  | "bottom"
  | "left";

const HANDLE_SIZE = 8;
const POINT_HANDLE_RADIUS = 7;
const CONTEXT_MENU_WIDTH = 220;
const EDGE_HANDLE_LENGTH = 34;
const EDGE_HANDLE_THICKNESS = 10;
const EDGE_AXIS_LOCK_ENTER_RATIO = 0.45;
const EDGE_AXIS_LOCK_EXIT_RATIO = 0.75;
const CUSTOM_BUBBLE_CLOSE_DISTANCE_PX = 9;
const FULL_WIDTH_SPACE = "\u3000";
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

type CanvasLayoutSnapshot = {
  scale: number;
  workspaceScale: number;
  workspaceCanvasOrigin: { x: number; y: number };
  contentCanvasOrigin: { x: number; y: number };
  pageCanvasOrigin: { x: number; y: number };
};

const inferClipboardImageExtension = (mimeType: string | null) => {
  if (!mimeType) {
    return "png";
  }
  const [, subtype] = mimeType.split("/");
  return subtype ? subtype.replace(/[^a-z0-9]/gi, "").toLowerCase() : "png";
};

const getClipboardImageFile = async (event: ClipboardEvent) => {
  const clipboardData = event.clipboardData;
  if (clipboardData) {
    const itemFile = Array.from(clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (itemFile) {
      return itemFile;
    }

    const fileEntry = Array.from(clipboardData.files).find((file) =>
      file.type.startsWith("image/"),
    );
    if (fileEntry) {
      return fileEntry;
    }
  }

  if (!window.navigator.clipboard?.read) {
    return null;
  }

  try {
    const clipboardItems = await window.navigator.clipboard.read();
    for (const clipboardItem of clipboardItems) {
      const imageType = clipboardItem.types.find((type) => type.startsWith("image/"));
      if (!imageType) {
        continue;
      }
      const blob = await clipboardItem.getType(imageType);
      const extension = inferClipboardImageExtension(blob.type || imageType);
      return new File([blob], `clipboard-image.${extension}`, {
        type: blob.type || imageType,
      });
    }
  } catch {
    // Ignore clipboard read failures and fall through to null.
  }

  return null;
};

const useImageElement = (src: string | null | undefined) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }

    let active = true;
    const nextImage = new window.Image();
    nextImage.onload = () => {
      if (active) {
        setImage(nextImage);
      }
    };
    nextImage.src = src;

    return () => {
      active = false;
    };
  }, [src]);

  return image;
};

const createVerticalPunctuationOffsetMeasurer = (
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
) => {
  if (typeof document === "undefined") {
    return (_unit: string) => 0;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return (_unit: string) => 0;
  }
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

const getPointFromEvent = (
  event: KonvaEventObject<MouseEvent>,
  scale: number,
  pageCanvasOrigin: { x: number; y: number },
) => {
  const stage = event.target.getStage();
  if (!stage) {
    return null;
  }
  const point = stage.getPointerPosition();
  if (!point) {
    return null;
  }
  return {
    x: (point.x - pageCanvasOrigin.x) / scale,
    y: (point.y - pageCanvasOrigin.y) / scale,
  };
};

const createRectFromDrag = (shape: DraftShape) => {
  if (!shape) {
    return null;
  }
  return {
    x: Math.min(shape.startX, shape.x),
    y: Math.min(shape.startY, shape.y),
    width: Math.abs(shape.width),
    height: Math.abs(shape.height),
  };
};

const createRectFromMarquee = (marquee: MarqueeDragState) => {
  if (!marquee) {
    return null;
  }
  return {
    x: Math.min(marquee.startX, marquee.x),
    y: Math.min(marquee.startY, marquee.y),
    width: Math.abs(marquee.x - marquee.startX),
    height: Math.abs(marquee.y - marquee.startY),
  };
};

const doRectsIntersect = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) =>
  left.x <= right.x + right.width &&
  left.x + left.width >= right.x &&
  left.y <= right.y + right.height &&
  left.y + left.height >= right.y;

const buildCustomBubblePreview = (
  points: Point[],
  smoothness: number,
): CustomBubblePreview | null => {
  if (points.length < 3) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const localPoints = points.map((point) => ({
    x: point.x - minX,
    y: point.y - minY,
  }));
  const previewBubble: Bubble = {
    id: "preview-custom-bubble",
    ...createDefaultBubble({
      x: minX,
      y: minY,
      width,
      height,
      bubbleType: "custom",
      showTail: false,
      customPoints: localPoints,
      customSmoothness: smoothness,
    }),
  };

  return {
    x: minX,
    y: minY,
    width,
    height,
    localPoints,
    path: getBubbleBodyPath(previewBubble),
  };
};

const isRectCrossingPageBounds = (
  rect: { x: number; y: number; width: number; height: number },
  page: Pick<Page, "width" | "height">,
) =>
  rect.x < 0 ||
  rect.y < 0 ||
  rect.x + rect.width > page.width ||
  rect.y + rect.height > page.height;

const getPanelImageRenderMetrics = (
  panel: Pick<Panel, "width" | "height" | "image">,
  scale: number,
  viewBoxOverride?: PanelRect,
) => {
  if (!panel.image) {
    return null;
  }

  const viewBox = viewBoxOverride ?? panel.image.viewBox;
  const sourceWidth = panel.image.sourceWidth ?? viewBox.width;
  const sourceHeight = panel.image.sourceHeight ?? viewBox.height;
  return {
    viewBox,
    sourceWidth,
    sourceHeight,
    renderWidth: (sourceWidth / viewBox.width) * panel.width * scale,
    renderHeight: (sourceHeight / viewBox.height) * panel.height * scale,
    renderX: -((viewBox.x / viewBox.width) * panel.width * scale),
    renderY: -((viewBox.y / viewBox.height) * panel.height * scale),
  };
};

const CanvasContextMenu = ({
  title,
  actions,
  x,
  y,
}: {
  title: string;
  actions: ContextMenuAction[];
  x: number;
  y: number;
}) => (
  <div
    className="canvas-context-menu"
    role="menu"
    aria-label={title}
    style={{
      left: `${x}px`,
      top: `${y}px`,
    }}
    onContextMenu={(event) => {
      event.preventDefault();
    }}
  >
    <p className="canvas-context-menu-title">{title}</p>
    <div className="canvas-context-menu-actions">
      {actions.map((action) => (
        <button
          key={action.label}
          className={`canvas-context-menu-item${action.danger ? " danger" : ""}`}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </div>
  </div>
);

const ResizeHandles = ({
  rect,
  scale,
  color,
  onCommit,
  onLiveChange,
  mode = "corners",
  resizeBehavior = "centered",
}: {
  rect: { x: number; y: number; width: number; height: number };
  scale: number;
  color: string;
  onCommit: (handle: ResizeHandle, newRect: { x: number; y: number; width: number; height: number }) => void;
  onLiveChange?: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  mode?: "corners" | "corners-and-edges";
  resizeBehavior?: "centered" | "anchored";
}) => {
  const size = HANDLE_SIZE;

  // Store drag start state
  const dragStateRef = useRef<{
    handleKey: ResizeHandle;
    initialRect: typeof rect;
  } | null>(null);

  const getPointerInParentSpace = (event: KonvaEventObject<DragEvent>) => {
    const stage = event.target.getStage();
    const parent = event.target.getParent();
    const pointer = stage?.getPointerPosition();
    if (!pointer || !parent) {
      return null;
    }
    return parent.getAbsoluteTransform().copy().invert().point(pointer);
  };

  // Compute a centered resize rect; corners resize both axes, edge handles resize one axis.
  const computeScaledRect = (
    handleKey: ResizeHandle,
    pointerX: number,
    pointerY: number,
    baseRect: typeof rect,
  ) => {
    const centerX = baseRect.x + baseRect.width / 2;
    const centerY = baseRect.y + baseRect.height / 2;
    
    // Convert pointer to page coordinates
    const pageX = pointerX / scale;
    const pageY = pointerY / scale;

    // Calculate new dimensions based on which corner is being dragged
    let newWidth = baseRect.width;
    let newHeight = baseRect.height;

    switch (handleKey) {
      case "top-left": {
        // Distance from drag point to center
        const dx = centerX - pageX;
        const dy = centerY - pageY;
        newWidth = dx * 2;
        newHeight = dy * 2;
        break;
      }
      case "top-right": {
        const dx = pageX - centerX;
        const dy = centerY - pageY;
        newWidth = dx * 2;
        newHeight = dy * 2;
        break;
      }
      case "bottom-left": {
        const dx = centerX - pageX;
        const dy = pageY - centerY;
        newWidth = dx * 2;
        newHeight = dy * 2;
        break;
      }
      case "bottom-right": {
        const dx = pageX - centerX;
        const dy = pageY - centerY;
        newWidth = dx * 2;
        newHeight = dy * 2;
        break;
      }
      case "top": {
        const dy = centerY - pageY;
        newHeight = dy * 2;
        break;
      }
      case "right": {
        const dx = pageX - centerX;
        newWidth = dx * 2;
        break;
      }
      case "bottom": {
        const dy = pageY - centerY;
        newHeight = dy * 2;
        break;
      }
      case "left": {
        const dx = centerX - pageX;
        newWidth = dx * 2;
        break;
      }
      default:
        return baseRect;
    }

    // Enforce minimum size
    newWidth = Math.max(20, newWidth);
    newHeight = Math.max(20, newHeight);

    // Calculate new x, y to maintain center
    const newX = centerX - newWidth / 2;
    const newY = centerY - newHeight / 2;

    return { x: newX, y: newY, width: newWidth, height: newHeight };
  };

  const computeAnchoredRect = (
    handleKey: ResizeHandle,
    pointerX: number,
    pointerY: number,
    baseRect: typeof rect,
  ) => {
    const minimumSize = 20;
    const pageX = pointerX / scale;
    const pageY = pointerY / scale;
    const left = baseRect.x;
    const right = baseRect.x + baseRect.width;
    const top = baseRect.y;
    const bottom = baseRect.y + baseRect.height;

    switch (handleKey) {
      case "top-left": {
        const nextX = Math.min(pageX, right - minimumSize);
        const nextY = Math.min(pageY, bottom - minimumSize);
        return {
          x: nextX,
          y: nextY,
          width: right - nextX,
          height: bottom - nextY,
        };
      }
      case "top-right": {
        const nextY = Math.min(pageY, bottom - minimumSize);
        const nextWidth = Math.max(minimumSize, pageX - left);
        return {
          x: left,
          y: nextY,
          width: nextWidth,
          height: bottom - nextY,
        };
      }
      case "bottom-left": {
        const nextX = Math.min(pageX, right - minimumSize);
        const nextHeight = Math.max(minimumSize, pageY - top);
        return {
          x: nextX,
          y: top,
          width: right - nextX,
          height: nextHeight,
        };
      }
      case "bottom-right": {
        const nextWidth = Math.max(minimumSize, pageX - left);
        const nextHeight = Math.max(minimumSize, pageY - top);
        return {
          x: left,
          y: top,
          width: nextWidth,
          height: nextHeight,
        };
      }
      case "top": {
        const nextY = Math.min(pageY, bottom - minimumSize);
        return {
          x: left,
          y: nextY,
          width: baseRect.width,
          height: bottom - nextY,
        };
      }
      case "right": {
        const nextWidth = Math.max(minimumSize, pageX - left);
        return {
          x: left,
          y: top,
          width: nextWidth,
          height: baseRect.height,
        };
      }
      case "bottom": {
        const nextHeight = Math.max(minimumSize, pageY - top);
        return {
          x: left,
          y: top,
          width: baseRect.width,
          height: nextHeight,
        };
      }
      case "left": {
        const nextX = Math.min(pageX, right - minimumSize);
        return {
          x: nextX,
          y: top,
          width: right - nextX,
          height: baseRect.height,
        };
      }
      default:
        return baseRect;
    }
  };

  const handleDragStart = (
    handleKey: ResizeHandle,
    event: KonvaEventObject<DragEvent>,
  ) => {
    event.cancelBubble = true;
    const pointer = getPointerInParentSpace(event);
    if (!pointer) return;

    dragStateRef.current = {
      handleKey,
      initialRect: { ...rect },
    };
  };

  const handleDragMove = (
    event: KonvaEventObject<DragEvent>,
  ) => {
    if (!dragStateRef.current) return;
    event.cancelBubble = true;

    const pointer = getPointerInParentSpace(event);
    if (!pointer) return;

    const { initialRect } = dragStateRef.current;
    
    const nextRect =
      resizeBehavior === "anchored"
        ? computeAnchoredRect(dragStateRef.current.handleKey, pointer.x, pointer.y, initialRect)
        : computeScaledRect(dragStateRef.current.handleKey, pointer.x, pointer.y, initialRect);
    onLiveChange?.(nextRect);
  };

  const handleDragEnd = (
    event: KonvaEventObject<DragEvent>,
  ) => {
    if (!dragStateRef.current) return;
    event.cancelBubble = true;

    const pointer = getPointerInParentSpace(event);
    
    const { handleKey, initialRect } = dragStateRef.current;
    dragStateRef.current = null;

    if (!pointer) {
      onLiveChange?.(null);
      return;
    }

    const nextRect =
      resizeBehavior === "anchored"
        ? computeAnchoredRect(handleKey, pointer.x, pointer.y, initialRect)
        : computeScaledRect(handleKey, pointer.x, pointer.y, initialRect);
    onLiveChange?.(null);
    onCommit(handleKey, nextRect);
  };

  const cornerHandles: Array<{ key: ResizeHandle; x: number; y: number }> = [
    { key: "top-left", x: rect.x, y: rect.y },
    { key: "top-right", x: rect.x + rect.width, y: rect.y },
    { key: "bottom-left", x: rect.x, y: rect.y + rect.height },
    { key: "bottom-right", x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  const edgeHandles: Array<{ key: ResizeHandle; x: number; y: number }> = [
    { key: "top", x: rect.x + rect.width * 0.5, y: rect.y },
    { key: "right", x: rect.x + rect.width, y: rect.y + rect.height * 0.5 },
    { key: "bottom", x: rect.x + rect.width * 0.5, y: rect.y + rect.height },
    { key: "left", x: rect.x, y: rect.y + rect.height * 0.5 },
  ];
  const handles = mode === "corners-and-edges" ? [...cornerHandles, ...edgeHandles] : cornerHandles;

  return (
    <>
      {handles.map((handle) => (
        <Rect
          key={handle.key}
          x={handle.x * scale - size / 2}
          y={handle.y * scale - size / 2}
          width={size}
          height={size}
          fill="#ffffff"
          stroke={color}
          strokeWidth={1.5}
          cornerRadius={2}
          draggable
          onMouseDown={(event) => {
            if (event.evt.button === 0) {
              event.cancelBubble = true;
            }
          }}
          onDragStart={(event) => handleDragStart(handle.key, event)}
          onDragMove={(event) => handleDragMove(event)}
          onDragEnd={(event) => handleDragEnd(event)}
        />
      ))}
    </>
  );
};

const scaleExplosionSpikePositions = (
  spikePositions: Array<{ x: number; y: number }> | undefined,
  fromRect: { width: number; height: number },
  toRect: { width: number; height: number },
) => {
  if (!spikePositions || spikePositions.length === 0) {
    return [];
  }

  const scaleX = toRect.width / fromRect.width;
  const scaleY = toRect.height / fromRect.height;

  return spikePositions.map((position) => ({
    x: (position.x - fromRect.width / 2) * scaleX + toRect.width / 2,
    y: (position.y - fromRect.height / 2) * scaleY + toRect.height / 2,
  }));
};

const SelectedPanelImagePreview = ({
  page,
  panel,
  scale,
  image,
}: {
  page: Page;
  panel: Panel;
  scale: number;
  image: HTMLImageElement | null;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const { t } = useI18n();
  const [liveViewBox, setLiveViewBox] = useState<PanelRect | null>(null);
  const dragStateRef = useRef<{
    viewBox: PanelRect;
    renderX: number;
    renderY: number;
    sourceWidth: number;
    sourceHeight: number;
  } | null>(null);
  const activeViewBox = liveViewBox ?? panel.image?.viewBox ?? null;
  const metrics =
    activeViewBox && panel.image ? getPanelImageRenderMetrics(panel, scale, activeViewBox) : null;
  const clipPoints = panel.points.flatMap((point) => [point.x * scale, point.y * scale]);

  if (!panel.image || !image || !metrics) {
    return null;
  }

  return (
    <Group>
      {/* Draggable image for crop adjustment - sits on top to receive drag events */}
      <KonvaImage
        image={image}
        x={metrics.renderX}
        y={metrics.renderY}
        width={metrics.renderWidth}
        height={metrics.renderHeight}
        opacity={0.3}
        draggable
        onDragStart={(event) => {
          event.cancelBubble = true;
          dragStateRef.current = {
            viewBox: activeViewBox!,
            renderX: metrics.renderX,
            renderY: metrics.renderY,
            sourceWidth: metrics.sourceWidth,
            sourceHeight: metrics.sourceHeight,
          };
        }}
        onDragMove={(event) => {
          event.cancelBubble = true;
          const dragState = dragStateRef.current;
          if (!dragState) return;
          const nextViewBox = panImageViewBox(
            panel,
            dragState.sourceWidth,
            dragState.sourceHeight,
            dragState.viewBox,
            (event.target.x() - dragState.renderX) / scale,
            (event.target.y() - dragState.renderY) / scale,
          );
          const nextMetrics = getPanelImageRenderMetrics(panel, scale, nextViewBox);
          if (!nextMetrics) return;
          setLiveViewBox(nextViewBox);
          event.target.position({ x: nextMetrics.renderX, y: nextMetrics.renderY });
        }}
        onDragEnd={(event) => {
          event.cancelBubble = true;
          const dragState = dragStateRef.current;
          if (!dragState) return;
          const nextViewBox = panImageViewBox(
            panel,
            dragState.sourceWidth,
            dragState.sourceHeight,
            dragState.viewBox,
            (event.target.x() - dragState.renderX) / scale,
            (event.target.y() - dragState.renderY) / scale,
          );
          const nextMetrics = getPanelImageRenderMetrics(panel, scale, nextViewBox);
          setLiveViewBox(nextViewBox);
          if (nextMetrics) {
            event.target.position({ x: nextMetrics.renderX, y: nextMetrics.renderY });
          }
          void executeCommand("setPanelImageCrop", {
            pageId: page.id,
            panelId: panel.id,
            viewBox: nextViewBox,
          }).finally(() => {
            dragStateRef.current = null;
            setLiveViewBox(null);
          });
        }}
      />
      {/* Clipped image showing current crop */}
      <Group
        clipFunc={(ctx) => {
          ctx.beginPath();
          ctx.moveTo(panel.points[0].x * scale, panel.points[0].y * scale);
          for (let index = 1; index < panel.points.length; index += 1) {
            ctx.lineTo(panel.points[index].x * scale, panel.points[index].y * scale);
          }
          ctx.closePath();
        }}
        listening={false}
      >
        <KonvaImage
          image={image}
          x={metrics.renderX}
          y={metrics.renderY}
          width={metrics.renderWidth}
          height={metrics.renderHeight}
          listening={false}
        />
        <Line
          points={clipPoints}
          closed
          fill="rgba(255,255,255,0.08)"
          strokeWidth={0}
          listening={false}
        />
      </Group>
      <Text
        x={0}
        y={(panel.height + 10) * scale}
        text={t("canvas.imageEditHint")}
        fontSize={14}
        fill="#2d241b"
        listening={false}
      />
    </Group>
  );
};

const PanelNode = ({
  page,
  panel,
  scale,
  selected,
  highlighted,
  showImagePreview,
  onBoundaryPreviewChange,
  onOpenContextMenu,
}: {
  page: Page;
  panel: Panel;
  scale: number;
  selected: boolean;
  highlighted: boolean;
  showImagePreview: boolean;
  onBoundaryPreviewChange: (preview: BoundaryOverlayPreview) => void;
  onOpenContextMenu: (
    event: KonvaEventObject<MouseEvent>,
    target: ContextMenuTarget,
  ) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const multiSelection = useEditorStore((state) => state.multiSelection);
  const image = useImageElement(panel.image?.src);
  const { t } = useI18n();
  const isHighlighted = highlighted || selected;
  const isInMultiSelection = multiSelection.some(
    (entry) =>
      entry.pageId === page.id &&
      entry.objectType === "panel" &&
      entry.objectId === panel.id,
  );
  // Track if a drag operation is in progress to prevent click after drag
  const isDraggingRef = useRef(false);
  // Live points for real-time preview during vertex drag
  const [livePoints, setLivePoints] = useState<Point[] | null>(null);
  // Live rect for real-time preview during resize
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Track edge drag state for edge-translation editing
  const edgeDragStateRef = useRef<{
    edgeIndex: number;
    initialPoints: Point[];
    initialX: number;
    initialY: number;
    initialPointerX: number;
    initialPointerY: number;
    lockMode: "x" | "y" | "free";
    lastDeltaX: number;
    lastDeltaY: number;
  } | null>(null);
  const displayPoints = livePoints ?? panel.points;
  const displayRect = liveRect ?? { x: panel.x, y: panel.y, width: panel.width, height: panel.height };
  const clipPoints = displayPoints.flatMap((point) => [point.x * scale, point.y * scale]);

  const translateEdgePoints = (
    points: Point[],
    edgeIndex: number,
    deltaX: number,
    deltaY: number,
  ) => {
    const nextIndex = (edgeIndex + 1) % points.length;
    return points.map((entry, index) =>
      index === edgeIndex || index === nextIndex
        ? { x: entry.x + deltaX, y: entry.y + deltaY }
        : entry,
    );
  };

  const publishBoundaryPreviewForPoints = (points: Point[]) => {
    const absolutePoints = points.map((point) => ({
      x: panel.x + point.x,
      y: panel.y + point.y,
    }));
    const xs = absolutePoints.map((point) => point.x);
    const ys = absolutePoints.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    onBoundaryPreviewChange({
      objectType: "panel",
      objectId: panel.id,
      rect: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
    });
  };

  const getAxisBiasedEdgeDelta = (
    rawDeltaX: number,
    rawDeltaY: number,
    currentMode: "x" | "y" | "free",
  ) => {
    const absX = Math.abs(rawDeltaX);
    const absY = Math.abs(rawDeltaY);
    const dominantAxis = absX >= absY ? "x" : "y";
    const dominantMagnitude = dominantAxis === "x" ? absX : absY;
    const minorMagnitude = dominantAxis === "x" ? absY : absX;
    const dominantMinorRatio =
      dominantMagnitude > 0 ? minorMagnitude / dominantMagnitude : Number.POSITIVE_INFINITY;

    let nextMode = currentMode;
    if (currentMode === "free") {
      if (dominantMinorRatio <= EDGE_AXIS_LOCK_ENTER_RATIO) {
        nextMode = dominantAxis;
      }
    } else {
      const currentMajorMagnitude = currentMode === "x" ? absX : absY;
      const currentMinorMagnitude = currentMode === "x" ? absY : absX;
      const currentMinorRatio =
        currentMajorMagnitude > 0
          ? currentMinorMagnitude / currentMajorMagnitude
          : Number.POSITIVE_INFINITY;

      if (currentMinorRatio >= EDGE_AXIS_LOCK_EXIT_RATIO) {
        nextMode = "free";
      } else if (dominantAxis !== currentMode && dominantMinorRatio <= EDGE_AXIS_LOCK_ENTER_RATIO) {
        nextMode = dominantAxis;
      }
    }

    if (nextMode === "x") {
      return {
        deltaX: snapValue(rawDeltaX),
        deltaY: 0,
        nextMode,
      };
    }
    if (nextMode === "y") {
      return {
        deltaX: 0,
        deltaY: snapValue(rawDeltaY),
        nextMode,
      };
    }
    return {
      deltaX: snapValue(rawDeltaX),
      deltaY: snapValue(rawDeltaY),
      nextMode,
    };
  };

  const handleEdgeDragStart = (
    edgeIndex: number,
    event: KonvaEventObject<MouseEvent>,
  ) => {
    isDraggingRef.current = true;
    const target = event.target;
    const pointer = target.getStage()?.getPointerPosition();
    edgeDragStateRef.current = {
      edgeIndex,
      initialPoints: panel.points.map((entry) => ({ ...entry })),
      initialX: target.x(),
      initialY: target.y(),
      initialPointerX: pointer?.x ?? target.x(),
      initialPointerY: pointer?.y ?? target.y(),
      lockMode: "free",
      lastDeltaX: 0,
      lastDeltaY: 0,
    };
    publishBoundaryPreviewForPoints(panel.points);
  };

  const handleEdgeDragMove = (event: KonvaEventObject<MouseEvent>) => {
    const dragState = edgeDragStateRef.current;
    if (!dragState) {
      return;
    }
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) {
      return;
    }
    const rawDeltaX = (pointer.x - dragState.initialPointerX) / scale;
    const rawDeltaY = (pointer.y - dragState.initialPointerY) / scale;
    const snappedDelta = getAxisBiasedEdgeDelta(
      rawDeltaX,
      rawDeltaY,
      dragState.lockMode,
    );
    dragState.lockMode = snappedDelta.nextMode;
    const { deltaX, deltaY } = snappedDelta;
    dragState.lastDeltaX = deltaX;
    dragState.lastDeltaY = deltaY;
    const nextPoints = translateEdgePoints(
      dragState.initialPoints,
      dragState.edgeIndex,
      deltaX,
      deltaY,
    );
    setLivePoints(nextPoints);
    publishBoundaryPreviewForPoints(nextPoints);
  };

  const handleEdgeDragEnd = (event: KonvaEventObject<MouseEvent>) => {
    const dragState = edgeDragStateRef.current;
    if (!dragState) {
      return;
    }
    const target = event.target;
    target.position({
      x: dragState.initialX,
      y: dragState.initialY,
    });
    const pointer = event.target.getStage()?.getPointerPosition();
    const finalDelta =
      pointer
        ? getAxisBiasedEdgeDelta(
            (pointer.x - dragState.initialPointerX) / scale,
            (pointer.y - dragState.initialPointerY) / scale,
            dragState.lockMode,
          )
        : {
            deltaX: dragState.lastDeltaX,
            deltaY: dragState.lastDeltaY,
          };
    const nextPoints = translateEdgePoints(
      dragState.initialPoints,
      dragState.edgeIndex,
      finalDelta.deltaX,
      finalDelta.deltaY,
    );
    edgeDragStateRef.current = null;
    setLivePoints(null);
    void executeCommand("setPanelPoints", {
      pageId: page.id,
      panelId: panel.id,
      points: nextPoints,
    }).finally(() => {
      onBoundaryPreviewChange(null);
    });
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 50);
  };
  
  const handleSelect = (event: KonvaEventObject<MouseEvent>) => {
    // Don't select if this click is the end of a drag operation
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    event.cancelBubble = true;
    if (event.evt.shiftKey) {
      const currentPageSelection = multiSelection
        .filter((entry) => entry.pageId === page.id)
        .map((entry) => ({
          objectType: entry.objectType,
          objectId: entry.objectId,
        }));
      const alreadySelected = currentPageSelection.some(
        (entry) => entry.objectType === "panel" && entry.objectId === panel.id,
      );
      const nextObjects = alreadySelected
        ? currentPageSelection.filter(
            (entry) => !(entry.objectType === "panel" && entry.objectId === panel.id),
          )
        : [
            ...currentPageSelection,
            {
              objectType: "panel" as const,
              objectId: panel.id,
            },
          ];
      if (nextObjects.length === 0) {
        void executeCommand("clearSelection", {});
      } else {
        void executeCommand("selectObjects", {
          pageId: page.id,
          objects: nextObjects,
        });
      }
      return;
    }
    void executeCommand("selectObject", {
      pageId: page.id,
      objectType: "panel",
      objectId: panel.id,
    });
  };
  const handleContextMenu = (event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    if (!isInMultiSelection) {
      void executeCommand("selectObject", {
        pageId: page.id,
        objectType: "panel",
        objectId: panel.id,
      });
    }
    onOpenContextMenu(event, {
      kind: "panel",
      panelId: panel.id,
    });
  };

  const renderImage = () => {
    const metrics = getPanelImageRenderMetrics(panel, scale);
    if (!image || !metrics) {
      return null;
    }

    return (
      <Group
        clipFunc={(ctx) => {
          ctx.beginPath();
          ctx.moveTo(displayPoints[0].x * scale, displayPoints[0].y * scale);
          for (let index = 1; index < displayPoints.length; index += 1) {
            ctx.lineTo(displayPoints[index].x * scale, displayPoints[index].y * scale);
          }
          ctx.closePath();
        }}
      >
        <KonvaImage
          image={image}
          x={metrics.renderX}
          y={metrics.renderY}
          width={metrics.renderWidth}
          height={metrics.renderHeight}
          listening={false}
        />
      </Group>
    );
  };

  return (
    <>
      <Group
        x={panel.x * scale}
        y={panel.y * scale}
        draggable={activeTool === "select" && !showImagePreview}
        onContextMenu={(event) => {
          event.cancelBubble = true;
          handleContextMenu(event);
        }}
        onDragStart={(event) => {
          // Only handle drag if not showing image preview
          if (showImagePreview) return;
          isDraggingRef.current = true;
          onBoundaryPreviewChange({
            objectType: "panel",
            objectId: panel.id,
            rect: {
              x: panel.x,
              y: panel.y,
              width: panel.width,
              height: panel.height,
            },
          });
        }}
        onDragMove={(event) => {
          if (showImagePreview) return;
          onBoundaryPreviewChange({
            objectType: "panel",
            objectId: panel.id,
            rect: {
              x: event.currentTarget.x() / scale,
              y: event.currentTarget.y() / scale,
              width: panel.width,
              height: panel.height,
            },
          });
        }}
        onClick={handleSelect}
        onDblClick={handleSelect}
        onDragEnd={(event) => {
          if (showImagePreview) return;
          const nextRect = {
            x: event.currentTarget.x() / scale,
            y: event.currentTarget.y() / scale,
            width: panel.width,
            height: panel.height,
          };
          onBoundaryPreviewChange({
            objectType: "panel",
            objectId: panel.id,
            rect: nextRect,
          });
          void executeCommand("movePanel", {
            pageId: page.id,
            panelId: panel.id,
            x: nextRect.x,
            y: nextRect.y,
            selectAfterMove: false,
          }).finally(() => {
            onBoundaryPreviewChange(null);
          });
          // Clear drag flag after a short delay to prevent blocking future clicks
          setTimeout(() => {
            isDraggingRef.current = false;
          }, 50);
        }}
      >
        <Group
          clipFunc={(ctx) => {
            ctx.beginPath();
            ctx.moveTo(displayPoints[0].x * scale, displayPoints[0].y * scale);
            for (let index = 1; index < displayPoints.length; index += 1) {
              ctx.lineTo(displayPoints[index].x * scale, displayPoints[index].y * scale);
            }
            ctx.closePath();
          }}
        >
          <Rect width={panel.width * scale} height={panel.height * scale} fill={panel.style.fill} />
          {!showImagePreview ? renderImage() : null}
        </Group>
        {showImagePreview ? (
          <SelectedPanelImagePreview page={page} panel={panel} scale={scale} image={image} />
        ) : null}
        <Line
          points={clipPoints}
          closed
          stroke={isHighlighted ? "#c36d2f" : panel.style.stroke}
          strokeWidth={isHighlighted ? 3 : panel.style.strokeWidth * 0.5}
          fillEnabled={false}
          listening={false}
        />
        {!panel.image ? (
          <Text
            x={16 * scale}
            y={16 * scale}
            text={t("canvas.panelPlaceholder")}
            fontSize={24 * scale}
            fill="#7b726a"
            listening={false}
          />
        ) : null}
      </Group>

      {selected ? (
        <>
          <Line
            points={displayPoints.flatMap((point) => [
              (panel.x + point.x) * scale,
              (panel.y + point.y) * scale,
            ])}
            closed
            stroke="rgba(0,0,0,0.001)"
            strokeWidth={18}
            fillEnabled={false}
            draggable={activeTool === "select"}
            onMouseDown={(event) => {
              event.cancelBubble = true;
            }}
            onContextMenu={(event) => {
              onOpenContextMenu(event, {
                kind: "panel",
                panelId: panel.id,
              });
            }}
            onDragStart={(event) => {
              const target = event.target;
              target.setAttr('initialX', target.x());
              target.setAttr('initialY', target.y());
              onBoundaryPreviewChange({
                objectType: "panel",
                objectId: panel.id,
                rect: {
                  x: panel.x,
                  y: panel.y,
                  width: panel.width,
                  height: panel.height,
                },
              });
            }}
            onDragMove={(event) => {
              const target = event.target;
              const initialX = target.getAttr('initialX');
              const initialY = target.getAttr('initialY');
              const deltaX = (target.x() - initialX) / scale;
              const deltaY = (target.y() - initialY) / scale;
              onBoundaryPreviewChange({
                objectType: "panel",
                objectId: panel.id,
                rect: {
                  x: panel.x + deltaX,
                  y: panel.y + deltaY,
                  width: panel.width,
                  height: panel.height,
                },
              });
            }}
            onDragEnd={(event) => {
              const target = event.target;
              const initialX = target.getAttr('initialX');
              const initialY = target.getAttr('initialY');
              const deltaX = (target.x() - initialX) / scale;
              const deltaY = (target.y() - initialY) / scale;
              target.position({ x: initialX, y: initialY });
              target.setAttr('initialX', undefined);
              target.setAttr('initialY', undefined);
              void executeCommand("movePanel", {
                pageId: page.id,
                panelId: panel.id,
                x: panel.x + deltaX,
                y: panel.y + deltaY,
                selectAfterMove: false,
              }).finally(() => {
                onBoundaryPreviewChange(null);
              });
            }}
          />
          <Line
            points={displayPoints.flatMap((point) => [
              (panel.x + point.x) * scale,
              (panel.y + point.y) * scale,
            ])}
            closed
            stroke="#c36d2f"
            strokeWidth={2}
            dash={[8, 4]}
            fillEnabled={false}
            listening={false}
          />
          {displayPoints.map((point, edgeIndex) => {
            const nextPoint = displayPoints[(edgeIndex + 1) % displayPoints.length];
            const centerX = panel.x + (point.x + nextPoint.x) * 0.5;
            const centerY = panel.y + (point.y + nextPoint.y) * 0.5;
            const edgeAngle = (Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x) * 180) / Math.PI;
            return (
              <Group key={`${panel.id}-edge-controls-${edgeIndex}`}>
                <Line
                  key={`${panel.id}-edge-drag-${edgeIndex}`}
                  points={[
                    (panel.x + point.x) * scale,
                    (panel.y + point.y) * scale,
                    (panel.x + nextPoint.x) * scale,
                    (panel.y + nextPoint.y) * scale,
                  ]}
                  stroke="rgba(195,109,47,0.001)"
                  strokeWidth={18}
                  lineCap="round"
                  draggable={activeTool === "select" && !showImagePreview}
                  dragBoundFunc={(position) => {
                    const dragState = edgeDragStateRef.current;
                    if (!dragState || dragState.edgeIndex !== edgeIndex) {
                      return {
                        x: 0,
                        y: 0,
                      };
                    }
                    return {
                      x: dragState.initialX,
                      y: dragState.initialY,
                    };
                  }}
                  onMouseEnter={(event) => {
                    const stage = event.target.getStage();
                    if (stage) {
                      stage.container().style.cursor = "move";
                    }
                  }}
                  onMouseLeave={(event) => {
                    const stage = event.target.getStage();
                    if (stage) {
                      stage.container().style.cursor = "default";
                    }
                  }}
                  onMouseDown={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDragStart={(event) => {
                    event.cancelBubble = true;
                    handleEdgeDragStart(edgeIndex, event);
                  }}
                  onDragMove={(event) => {
                    event.cancelBubble = true;
                    handleEdgeDragMove(event);
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                    handleEdgeDragEnd(event);
                  }}
                />
                <Rect
                  key={`${panel.id}-edge-handle-${edgeIndex}`}
                  x={centerX * scale}
                  y={centerY * scale}
                  width={EDGE_HANDLE_LENGTH}
                  height={EDGE_HANDLE_THICKNESS}
                  offsetX={EDGE_HANDLE_LENGTH * 0.5}
                  offsetY={EDGE_HANDLE_THICKNESS * 0.5}
                  cornerRadius={EDGE_HANDLE_THICKNESS * 0.5}
                  rotation={edgeAngle}
                  fill="#ffffff"
                  stroke="#c36d2f"
                  strokeWidth={2}
                  draggable={activeTool === "select"}
                  dragBoundFunc={(position) => {
                    const dragState = edgeDragStateRef.current;
                    if (!dragState || dragState.edgeIndex !== edgeIndex) {
                      return {
                        x: centerX * scale,
                        y: centerY * scale,
                      };
                    }
                    return {
                      x: dragState.initialX,
                      y: dragState.initialY,
                    };
                  }}
                  onMouseEnter={(event) => {
                    const stage = event.target.getStage();
                    if (stage) {
                      stage.container().style.cursor = "move";
                    }
                  }}
                  onMouseLeave={(event) => {
                    const stage = event.target.getStage();
                    if (stage) {
                      stage.container().style.cursor = "default";
                    }
                  }}
                  onMouseDown={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDragStart={(event) => {
                    event.cancelBubble = true;
                    handleEdgeDragStart(edgeIndex, event);
                  }}
                  onDragMove={(event) => {
                    event.cancelBubble = true;
                    handleEdgeDragMove(event);
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                    handleEdgeDragEnd(event);
                  }}
                />
              </Group>
            );
          })}
          {!showImagePreview ? (
            <Circle
              x={(panel.x + panel.width * 0.5) * scale}
              y={(panel.y + panel.height * 0.5) * scale}
              radius={POINT_HANDLE_RADIUS * 1.5}
              fill="#ffffff"
              stroke="#c36d2f"
              strokeWidth={3}
              draggable={activeTool === "select"}
              onMouseEnter={(event) => {
                const stage = event.target.getStage();
                if (stage) {
                  stage.container().style.cursor = "move";
                }
              }}
              onMouseLeave={(event) => {
                const stage = event.target.getStage();
                if (stage) {
                  stage.container().style.cursor = "default";
                }
              }}
              onMouseDown={(event) => {
                if (event.evt.button === 0) {
                  event.cancelBubble = true;
                }
              }}
              onContextMenu={(event) => {
                onOpenContextMenu(event, {
                  kind: "panel",
                  panelId: panel.id,
                });
              }}
              onDragStart={(event) => {
                const target = event.target;
                // Store the initial absolute position
                target.setAttr('initialX', target.x());
                target.setAttr('initialY', target.y());
                onBoundaryPreviewChange({
                  objectType: "panel",
                  objectId: panel.id,
                  rect: {
                    x: panel.x,
                    y: panel.y,
                    width: panel.width,
                    height: panel.height,
                  },
                });
              }}
              onDragMove={(event) => {
                const target = event.target;
                const initialX = target.getAttr('initialX');
                const initialY = target.getAttr('initialY');
                // Calculate delta from initial position
                const deltaX = (target.x() - initialX) / scale;
                const deltaY = (target.y() - initialY) / scale;
                onBoundaryPreviewChange({
                  objectType: "panel",
                  objectId: panel.id,
                  rect: {
                    x: panel.x + deltaX,
                    y: panel.y + deltaY,
                    width: panel.width,
                    height: panel.height,
                  },
                });
              }}
              onDragEnd={(event) => {
                const target = event.target;
                const initialX = target.getAttr('initialX');
                const initialY = target.getAttr('initialY');
                // Calculate delta from initial position
                const deltaX = (target.x() - initialX) / scale;
                const deltaY = (target.y() - initialY) / scale;
                // Reset to initial position
                target.position({ x: initialX, y: initialY });
                target.setAttr('initialX', undefined);
                target.setAttr('initialY', undefined);
                void executeCommand("movePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  x: panel.x + deltaX,
                  y: panel.y + deltaY,
                  selectAfterMove: false,
                }).finally(() => {
                  onBoundaryPreviewChange(null);
                });
              }}
            />
          ) : null}
          <ResizeHandles
            rect={displayRect}
            scale={scale}
            color="#c36d2f"
            onLiveChange={setLiveRect}
            onCommit={(_, nextRect) => {
              setLiveRect(null);
              void executeCommand("resizePanel", {
                pageId: page.id,
                panelId: panel.id,
                x: nextRect.x,
                y: nextRect.y,
                width: Math.max(GRID_SIZE, nextRect.width),
                height: Math.max(GRID_SIZE, nextRect.height),
              });
            }}
          />
          {displayPoints.map((point, index) => (
            <Circle
              key={`${panel.id}-point-${index}`}
              x={(panel.x + point.x) * scale}
              y={(panel.y + point.y) * scale}
              radius={POINT_HANDLE_RADIUS}
              fill="#ffffff"
              stroke="#c36d2f"
              strokeWidth={2}
              draggable
              onMouseDown={(event) => {
                event.cancelBubble = true;
              }}
              onDragMove={(event) => {
                event.target.position({
                  x: snapValue(event.target.x() / scale) * scale,
                  y: snapValue(event.target.y() / scale) * scale,
                });
                // Real-time preview: update live points during drag
                const absoluteX = snapValue(event.target.x() / scale);
                const absoluteY = snapValue(event.target.y() / scale);
                setLivePoints(
                  panel.points.map((entry, pointIndex) =>
                    pointIndex === index
                      ? { x: absoluteX - panel.x, y: absoluteY - panel.y }
                      : entry,
                  ),
                );
              }}
              onDragEnd={(event) => {
                const absoluteX = snapValue(event.target.x() / scale);
                const absoluteY = snapValue(event.target.y() / scale);
                const nextPoints = panel.points.map((entry, pointIndex) =>
                  pointIndex === index
                    ? { x: absoluteX - panel.x, y: absoluteY - panel.y }
                    : entry,
                );
                setLivePoints(null);
                void executeCommand("setPanelPoints", {
                  pageId: page.id,
                  panelId: panel.id,
                  points: nextPoints,
                });
              }}
            />
          ))}
        </>
      ) : null}
    </>
  );
};

const TextNode = ({
  page,
  item,
  scale,
  selected,
  highlighted,
  onBoundaryPreviewChange,
  onSmartGuideChange,
  onOpenContextMenu,
}: {
  page: Page;
  item: TextItem;
  scale: number;
  selected: boolean;
  highlighted: boolean;
  onBoundaryPreviewChange: (preview: BoundaryOverlayPreview) => void;
  onSmartGuideChange: (guide: SmartGuideState) => void;
  onOpenContextMenu: (
    event: KonvaEventObject<MouseEvent>,
    target: ContextMenuTarget,
  ) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const multiSelection = useEditorStore((state) => state.multiSelection);
  const isInMultiSelection = multiSelection.some(
    (entry) =>
      entry.pageId === page.id &&
      entry.objectType === "text" &&
      entry.objectId === item.id,
  );
  const isGrouped = page.groups.some((group) =>
    group.members.some((member) => member.objectType === "text" && member.objectId === item.id),
  );
  const isHighlighted = highlighted || selected;
  const [liveRect, setLiveRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const displayRect = liveRect ?? item;
  const lineHeight = getTextLineHeightByDirection(item.direction);
  const letterSpacing = item.letterSpacing ?? 0;
  const lineSpacing = item.lineSpacing ?? 0;
  const renderLineHeight = Math.max(0.1, lineHeight + lineSpacing / Math.max(item.fontSize, 1));
  const textMeasurer = useMemo(
    () => createCanvasTextMeasurer(item.fontSize, item.fontFamily, item.fontWeight),
    [item.fontSize, item.fontFamily, item.fontWeight],
  );
  const verticalPunctuationOffsetMeasurer = useMemo(
    () =>
      createVerticalPunctuationOffsetMeasurer(
        item.fontSize,
        item.fontFamily,
        item.fontWeight,
      ),
    [item.fontSize, item.fontFamily, item.fontWeight],
  );
  const displayLines = useMemo(
    () =>
      layoutTextForDisplayLines(item.content, {
        direction: item.direction,
        maxWidth: displayRect.width,
        maxHeight: displayRect.height,
        fontSize: item.fontSize,
        lineHeight,
        letterSpacing,
        lineSpacing,
        verticalColumnAlign: resolveVerticalColumnAlignFromTextAlign(item.textAlign),
        measureText: textMeasurer,
      }),
    [
      item.content,
      item.direction,
      displayRect.width,
      displayRect.height,
      item.fontSize,
      item.textAlign,
      letterSpacing,
      lineSpacing,
      lineHeight,
      textMeasurer,
    ],
  );
  const displayContent = useMemo(() => displayLines.join("\n"), [displayLines]);
  const verticalCellGrid = useMemo(() => displayLines.map((line) => Array.from(line)), [displayLines]);
  const verticalRowCount = Math.max(1, displayLines.length);
  const verticalColumnCount = Math.max(1, ...verticalCellGrid.map((row) => row.length));
  const verticalRowAdvance = Math.max(1, item.fontSize * lineHeight + letterSpacing) * scale;
  const verticalSampleCellWidth = Math.max(
    item.fontSize * 0.75,
    textMeasurer("\u56fd"),
    textMeasurer("M"),
    textMeasurer("\u53e3"),
  );
  const verticalColumnAdvance = Math.max(1, verticalSampleCellWidth * 1.04 + lineSpacing) * scale;
  const verticalBlockWidth = verticalColumnCount * verticalColumnAdvance;
  const verticalBlockHeight = verticalRowCount * verticalRowAdvance;
  const verticalOffsetX =
    item.textAlign === "center"
      ? (displayRect.width * scale - verticalBlockWidth) * 0.5
      : item.textAlign === "right"
        ? displayRect.width * scale - verticalBlockWidth
        : 0;
  const verticalOffsetY =
    item.verticalAlign === "middle"
      ? (displayRect.height * scale - verticalBlockHeight) * 0.5
      : item.verticalAlign === "bottom"
        ? displayRect.height * scale - verticalBlockHeight
        : 0;
  const handleSelect = (event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    if (event.evt.shiftKey) {
      const currentPageSelection = multiSelection
        .filter((entry) => entry.pageId === page.id)
        .map((entry) => ({
          objectType: entry.objectType,
          objectId: entry.objectId,
        }));
      const alreadySelected = currentPageSelection.some(
        (entry) => entry.objectType === "text" && entry.objectId === item.id,
      );
      const nextObjects = alreadySelected
        ? currentPageSelection.filter(
            (entry) => !(entry.objectType === "text" && entry.objectId === item.id),
          )
        : [
            ...currentPageSelection,
            {
              objectType: "text" as const,
              objectId: item.id,
            },
          ];
      if (nextObjects.length === 0) {
        void executeCommand("clearSelection", {});
      } else {
        void executeCommand("selectObjects", {
          pageId: page.id,
          objects: nextObjects,
        });
      }
      return;
    }
    void executeCommand("selectObject", {
      pageId: page.id,
      objectType: "text",
      objectId: item.id,
    });
  };

  return (
    <>
      <Group
        x={displayRect.x * scale}
        y={displayRect.y * scale}
        draggable={activeTool === "select" && !liveRect}
        onContextMenu={(event) => {
          if (!isInMultiSelection) {
            event.cancelBubble = true;
            void executeCommand("selectObject", {
              pageId: page.id,
              objectType: "text",
              objectId: item.id,
            });
          } else {
            event.cancelBubble = true;
          }
          onOpenContextMenu(event, {
            kind: "text",
            textId: item.id,
          });
        }}
        onDragStart={() => {
          if (!selected) {
            void executeCommand("selectObject", {
              pageId: page.id,
              objectType: "text",
              objectId: item.id,
            });
          }
          onSmartGuideChange(null);
          onBoundaryPreviewChange({
            objectType: "text",
            objectId: item.id,
            rect: {
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            },
          });
        }}
        onDragMove={(event) => {
          let nextX = event.target.x() / scale;
          let nextY = event.target.y() / scale;
          let nextGuide: SmartGuideState = null;

          if (!isGrouped) {
            const textCenter = {
              x: nextX + item.width * 0.5,
              y: nextY + item.height * 0.5,
            };
            let bestBubbleCenter: { x: number; y: number } | null = null;
            let bestDistance = Number.POSITIVE_INFINITY;
            for (const bubble of page.bubbles) {
              const bubbleCenter = {
                x: bubble.x + bubble.contentCenter.x,
                y: bubble.y + bubble.contentCenter.y,
              };
              const distance = Math.hypot(
                textCenter.x - bubbleCenter.x,
                textCenter.y - bubbleCenter.y,
              );
              if (distance < bestDistance) {
                bestDistance = distance;
                bestBubbleCenter = bubbleCenter;
              }
            }
            if (bestBubbleCenter && bestDistance <= 7) {
              nextX = bestBubbleCenter.x - item.width * 0.5;
              nextY = bestBubbleCenter.y - item.height * 0.5;
              event.target.position({
                x: nextX * scale,
                y: nextY * scale,
              });
              nextGuide = bestBubbleCenter;
            }
          }

          onSmartGuideChange(nextGuide);
          onBoundaryPreviewChange({
            objectType: "text",
            objectId: item.id,
            rect: {
              x: nextX,
              y: nextY,
              width: item.width,
              height: item.height,
            },
          });
        }}
        onClick={handleSelect}
        onDragEnd={(event) => {
          onSmartGuideChange(null);
          const nextRect = {
            x: event.target.x() / scale,
            y: event.target.y() / scale,
            width: item.width,
            height: item.height,
          };
          onBoundaryPreviewChange({
            objectType: "text",
            objectId: item.id,
            rect: nextRect,
          });
          void executeCommand("updateText", {
            pageId: page.id,
            textId: item.id,
            x: nextRect.x,
            y: nextRect.y,
          }).finally(() => {
            onBoundaryPreviewChange(null);
          });
        }}
      >
        <Rect
          x={0}
          y={0}
          width={displayRect.width * scale}
          height={displayRect.height * scale}
          fill="rgba(0,0,0,0.001)"
        />
        {item.direction === "vertical" ? (
          <Group
            clipFunc={(ctx) => {
              ctx.beginPath();
              ctx.rect(0, 0, displayRect.width * scale, displayRect.height * scale);
              ctx.closePath();
            }}
          >
            {Array.from({ length: verticalRowCount }).map((_, rowIndex) => {
              const row = verticalCellGrid[rowIndex] ?? [];
              return Array.from({ length: verticalColumnCount }).map((__, columnIndex) => {
                const unit = row[columnIndex] ?? FULL_WIDTH_SPACE;
                if (unit.length === 0 || unit === FULL_WIDTH_SPACE) {
                  return null;
                }
                const punctuationOffsetX = verticalPunctuationOffsetMeasurer(unit) * scale;
                return (
                  <Text
                    key={`vcell-${rowIndex}-${columnIndex}`}
                    text={unit}
                    fontSize={item.fontSize * scale}
                    fontFamily={item.fontFamily}
                    fontStyle={String(item.fontWeight)}
                    fill={item.color}
                    x={verticalOffsetX + columnIndex * verticalColumnAdvance + punctuationOffsetX}
                    y={verticalOffsetY + rowIndex * verticalRowAdvance}
                    width={verticalColumnAdvance}
                    height={verticalRowAdvance}
                    align="center"
                    verticalAlign="middle"
                    wrap="none"
                    lineHeight={1}
                    listening={false}
                  />
                );
              });
            })}
          </Group>
        ) : (
          <Text
            text={displayContent}
            fontSize={item.fontSize * scale}
            fontFamily={item.fontFamily}
            fontStyle={String(item.fontWeight)}
            letterSpacing={letterSpacing * scale}
            fill={item.color}
            width={displayRect.width * scale}
            height={displayRect.height * scale}
            align={item.textAlign}
            verticalAlign={item.verticalAlign}
            wrap="none"
            lineHeight={renderLineHeight}
          />
        )}
      </Group>

      {selected ? (
        <>
          <Rect
            x={displayRect.x * scale}
            y={displayRect.y * scale}
            width={displayRect.width * scale}
            height={displayRect.height * scale}
            stroke={isHighlighted ? "#c36d2f" : "#8f5b2f"}
            dash={[10, 6]}
            strokeWidth={2}
            fillEnabled={false}
          />
          <ResizeHandles
            rect={displayRect}
            scale={scale}
            color="#c36d2f"
            mode="corners-and-edges"
            resizeBehavior="anchored"
            onLiveChange={setLiveRect}
            onCommit={(_, nextRect) => {
              setLiveRect(null);
              void executeCommand("updateText", {
                pageId: page.id,
                textId: item.id,
                x: nextRect.x,
                y: nextRect.y,
                width: nextRect.width,
                height: nextRect.height,
              });
            }}
          />
        </>
      ) : isHighlighted ? (
        <Rect
          x={displayRect.x * scale}
          y={displayRect.y * scale}
          width={displayRect.width * scale}
          height={displayRect.height * scale}
          stroke="#c36d2f"
          dash={[8, 6]}
          strokeWidth={1.5}
          fillEnabled={false}
          listening={false}
        />
      ) : null}
    </>
  );
};

const BubbleNode = ({
  page,
  bubble,
  scale,
  selected,
  highlighted,
  onOpenContextMenu,
}: {
  page: Page;
  bubble: Bubble;
  scale: number;
  selected: boolean;
  highlighted: boolean;
  onOpenContextMenu: (
    event: KonvaEventObject<MouseEvent>,
    target: ContextMenuTarget,
  ) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const multiSelection = useEditorStore((state) => state.multiSelection);
  const isHighlighted = highlighted || selected;
  const isInMultiSelection = multiSelection.some(
    (entry) =>
      entry.pageId === page.id &&
      entry.objectType === "bubble" &&
      entry.objectId === bubble.id,
  );

  // Live spike positions for real-time preview during drag
  const [liveSpikePositions, setLiveSpikePositions] = useState<Array<{x: number, y: number}> | null>(null);
  // Live rect for real-time resize preview
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Single spike edit mode: which spike is being edited individually
  const [editingSpikeIndex, setEditingSpikeIndex] = useState<number | null>(null);
  // Live spike depth for individual spike editing
  const [liveSpikeDepth, setLiveSpikeDepth] = useState<number | null>(null);
  // Live tail connection point preview (bubble-local coordinates)
  const [liveTailBase, setLiveTailBase] = useState<Point | null>(null);
  // Live tail tip preview (absolute page coordinates)
  const [liveTailTip, setLiveTailTip] = useState<Point | null>(null);
  // Live custom bubble points preview while dragging control points
  const [liveCustomPoints, setLiveCustomPoints] = useState<Point[] | null>(null);
  const customPointDragStateRef = useRef<{
    pointIndex: number;
    sourceAbsolutePoints: Point[];
  } | null>(null);

  useEffect(() => {
    setLiveCustomPoints(null);
    setLiveTailBase(null);
    setLiveTailTip(null);
  }, [bubble.id]);
  
  const handleSelect = (event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    if (event.evt.shiftKey) {
      const currentPageSelection = multiSelection
        .filter((entry) => entry.pageId === page.id)
        .map((entry) => ({
          objectType: entry.objectType,
          objectId: entry.objectId,
        }));
      const alreadySelected = currentPageSelection.some(
        (entry) => entry.objectType === "bubble" && entry.objectId === bubble.id,
      );
      const nextObjects = alreadySelected
        ? currentPageSelection.filter(
            (entry) => !(entry.objectType === "bubble" && entry.objectId === bubble.id),
          )
        : [
            ...currentPageSelection,
            {
              objectType: "bubble" as const,
              objectId: bubble.id,
            },
          ];
      if (nextObjects.length === 0) {
        void executeCommand("clearSelection", {});
      } else {
        void executeCommand("selectObjects", {
          pageId: page.id,
          objects: nextObjects,
        });
      }
      return;
    }
    void executeCommand("selectObject", {
      pageId: page.id,
      objectType: "bubble",
      objectId: bubble.id,
    });
  };
  
  // Use live rect during resize for real-time preview
  const previewSpikePositions =
    liveRect && bubble.bubbleType === "explosion"
      ? scaleExplosionSpikePositions(bubble.spikePositions, bubble, liveRect)
      : [];
  const previewTailBase =
    liveTailBase ??
    (liveRect
      ? scaleBubbleLocalPoint(
          getBubbleTailBaseLocalPoint(bubble),
          bubble.width,
          bubble.height,
          liveRect.width,
          liveRect.height,
        )
      : getBubbleTailBaseLocalPoint(bubble));
  const previewTailTip = liveTailTip ?? bubble.tailTip;
  const previewCustomPoints =
    bubble.bubbleType === "custom"
      ? liveCustomPoints ??
        (liveRect
          ? bubble.customPoints.map((point) =>
              scaleBubbleLocalPoint(
                point,
                bubble.width,
                bubble.height,
                liveRect.width,
                liveRect.height,
              ),
            )
          : bubble.customPoints)
      : [];
  const displayBubble = liveRect
    ? {
        ...bubble,
        ...liveRect,
        tailTip: previewTailTip,
        tailBase: previewTailBase,
        ...(bubble.bubbleType === "custom" ? { customPoints: previewCustomPoints } : {}),
        ...(previewSpikePositions.length > 0 ? { spikePositions: previewSpikePositions } : {}),
      }
    : {
        ...bubble,
        tailTip: previewTailTip,
        tailBase: previewTailBase,
        ...(bubble.bubbleType === "custom" ? { customPoints: previewCustomPoints } : {}),
      };
  const visibleCustomPointIndices = useMemo(() => {
    if (displayBubble.bubbleType !== "custom") {
      return [];
    }
    const totalPoints = displayBubble.customPoints.length;
    if (totalPoints <= 0) {
      return [];
    }
    const profileIndices = displayBubble.customHandleProfile?.movableIndices
      ?.filter((index) => Number.isInteger(index) && index >= 0 && index < totalPoints)
      .filter((index, position, array) => array.indexOf(index) === position);
    if (profileIndices && profileIndices.length > 0) {
      return profileIndices;
    }
    if (totalPoints <= MAX_VISIBLE_CUSTOM_POINT_HANDLES) {
      return Array.from({ length: totalPoints }, (_, index) => index);
    }
    if (totalPoints >= DENSE_CUSTOM_POINT_HANDLE_THRESHOLD) {
      return [0, Math.floor(totalPoints * 0.5)];
    }
    return Array.from({ length: totalPoints }, (_, index) => index);
  }, [
    displayBubble.bubbleType,
    displayBubble.customPoints,
    displayBubble.customHandleProfile?.movableIndices,
  ]);

  const bodyPath = getBubbleBodyPath(displayBubble, liveSpikePositions);
  const explosionSpikes = displayBubble.bubbleType === "explosion" ? getExplosionSpikePoints(displayBubble, liveSpikePositions) : [];
  // When strokeWidth is 0, don't render stroke at all
  const hasStroke = displayBubble.strokeWidth > 0;
  const bubbleFillOpacity = Math.max(0, Math.min(1, displayBubble.opacity));
  const strokeColor = isHighlighted ? "#c36d2f" : (hasStroke ? bubble.strokeColor : undefined);
  const shouldShowTail = displayBubble.showTail && displayBubble.bubbleType !== "explosion";
  const shouldRenderRegularTail = shouldShowTail && displayBubble.bubbleType !== "thought";
  const shouldRenderThoughtTail = shouldShowTail && displayBubble.bubbleType === "thought";
  const tailPath = shouldRenderRegularTail ? getBubbleTailPath(displayBubble) : "";
  const combinedFillPath = shouldRenderRegularTail ? `${bodyPath} ${tailPath}` : bodyPath;
  const strokePath = shouldRenderRegularTail
    ? getBubbleRegularTailStrokeOutlinePath(displayBubble, liveSpikePositions)
    : bodyPath;
  const tailBaseHandle = shouldShowTail ? getBubbleBasePoints(displayBubble).center : null;
  const computeCustomBubbleGeometryFromDraggedPoint = (
    pointIndex: number,
    absolutePoint: Point,
    baseAbsolutePoints?: Point[],
  ) => {
    const sourceAbsolutePoints =
      baseAbsolutePoints?.map((point) => ({ ...point })) ??
      displayBubble.customPoints.map((point) => ({
        x: displayBubble.x + point.x,
        y: displayBubble.y + point.y,
      }));
    if (!sourceAbsolutePoints[pointIndex]) {
      return null;
    }
    const nextAbsolutePoints = sourceAbsolutePoints.map((point, index) =>
      index === pointIndex ? { ...absolutePoint } : { ...point },
    );
    const minX = Math.min(...nextAbsolutePoints.map((point) => point.x));
    const minY = Math.min(...nextAbsolutePoints.map((point) => point.y));
    const maxX = Math.max(...nextAbsolutePoints.map((point) => point.x));
    const maxY = Math.max(...nextAbsolutePoints.map((point) => point.y));
    const nextRect = {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
    const nextLocalPoints = nextAbsolutePoints.map((point) => ({
      x: point.x - nextRect.x,
      y: point.y - nextRect.y,
    }));
    return {
      rect: nextRect,
      localPoints: nextLocalPoints,
    };
  };

  return (
    <>
      <Group
        x={displayBubble.x * scale}
        y={displayBubble.y * scale}
        draggable={activeTool === "select" && !liveRect}
        onClick={handleSelect}
        onContextMenu={(event) => {
          if (!isInMultiSelection) {
            event.cancelBubble = true;
            void executeCommand("selectObject", {
              pageId: page.id,
              objectType: "bubble",
              objectId: bubble.id,
            });
          } else {
            event.cancelBubble = true;
          }
          onOpenContextMenu(event, {
            kind: "bubble",
            bubbleId: bubble.id,
          });
        }}
        onDragStart={() => {
          if (!selected) {
            void executeCommand("selectObject", {
              pageId: page.id,
              objectType: "bubble",
              objectId: bubble.id,
            });
          }
        }}
        onDragEnd={(event) => {
          void executeCommand("updateBubble", {
            pageId: page.id,
            bubbleId: bubble.id,
            x: event.target.x() / scale,
            y: event.target.y() / scale,
          });
        }}
      >
        {/* Bubble body + regular tail are filled as one contour to avoid seam/opacity overlap */}
        <Path
          data-testid="bubble-body"
          data={combinedFillPath}
          fill={displayBubble.backgroundColor}
          opacity={bubbleFillOpacity}
          strokeEnabled={false}
          lineCap="round"
          lineJoin="round"
          scaleX={scale}
          scaleY={scale}
        />
        {hasStroke ? (
          <Path
            data={strokePath}
            fillEnabled={false}
            stroke={strokeColor}
            strokeWidth={displayBubble.strokeWidth}
            lineCap="round"
            lineJoin="round"
            scaleX={scale}
            scaleY={scale}
          />
        ) : null}
        {/* Thought bubble tail circles render above body */}
        {shouldRenderThoughtTail
          ? (() => {
              const base = getBubbleBasePoints(displayBubble);
              const tailTipX = (displayBubble.tailTip.x - displayBubble.x) * scale;
              const tailTipY = (displayBubble.tailTip.y - displayBubble.y) * scale;
              const tailBaseX = (base.center.x - displayBubble.x) * scale;
              const tailBaseY = (base.center.y - displayBubble.y) * scale;

              const circles = [];
              const numCircles = displayBubble.thoughtCircles ?? 3;

              for (let i = 0; i < numCircles; i++) {
                const t = (i + 1) / (numCircles + 1);
                const cx = tailBaseX + (tailTipX - tailBaseX) * t;
                const cy = tailBaseY + (tailTipY - tailBaseY) * t;
                const radius = Math.max(4 * scale, (12 - i * 2) * scale);

                circles.push(
                  <Circle
                    key={`thought-circle-fill-${i}`}
                    x={cx}
                    y={cy}
                    radius={radius}
                    fill={displayBubble.backgroundColor}
                    opacity={bubbleFillOpacity}
                    strokeEnabled={false}
                  />
                );
                if (hasStroke) {
                  circles.push(
                    <Circle
                      key={`thought-circle-stroke-${i}`}
                      x={cx}
                      y={cy}
                      radius={radius}
                      fillEnabled={false}
                      stroke={strokeColor}
                      strokeWidth={displayBubble.strokeWidth}
                    />,
                  );
                }
              }
              return circles;
            })()
          : null}
      </Group>

      {selected ? (
        <>
          <Group data-testid="bubble-selected" />
          <ResizeHandles
            rect={displayBubble}
            scale={scale}
            color="#c36d2f"
            mode="corners-and-edges"
            resizeBehavior="anchored"
            onLiveChange={setLiveRect}
            onCommit={(_, nextRect) => {
              setLiveRect(null);
              setLiveCustomPoints(null);
              const resolvedRect = clampBubbleRectToWorkspace(page, nextRect);
              const scaledSpikePositions = scaleExplosionSpikePositions(
                bubble.spikePositions,
                bubble,
                resolvedRect,
              );
              void executeCommand("updateBubble", {
                pageId: page.id,
                bubbleId: bubble.id,
                x: resolvedRect.x,
                y: resolvedRect.y,
                width: resolvedRect.width,
                height: resolvedRect.height,
                ...(scaledSpikePositions.length > 0 ? { spikePositions: scaledSpikePositions } : {}),
              });
            }}
          />
          {displayBubble.bubbleType === "custom" && visibleCustomPointIndices.length > 0
            ? visibleCustomPointIndices.map((index) => {
                const point = displayBubble.customPoints[index];
                if (!point) {
                  return null;
                }
                return (
                <Circle
                  key={`custom-point-${index}`}
                  x={(displayBubble.x + point.x) * scale}
                  y={(displayBubble.y + point.y) * scale}
                  radius={6}
                  fill="#ffffff"
                  stroke="#c36d2f"
                  strokeWidth={2}
                  draggable
                  onMouseDown={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDragStart={(event) => {
                    event.cancelBubble = true;
                    customPointDragStateRef.current = {
                      pointIndex: index,
                      sourceAbsolutePoints: displayBubble.customPoints.map((sourcePoint) => ({
                        x: displayBubble.x + sourcePoint.x,
                        y: displayBubble.y + sourcePoint.y,
                      })),
                    };
                  }}
                  onDragMove={(event) => {
                    const dragState = customPointDragStateRef.current;
                    const geometry = computeCustomBubbleGeometryFromDraggedPoint(index, {
                      x: event.target.x() / scale,
                      y: event.target.y() / scale,
                    }, dragState?.pointIndex === index ? dragState.sourceAbsolutePoints : undefined);
                    if (!geometry) {
                      return;
                    };
                    setLiveRect(geometry.rect);
                    setLiveCustomPoints(geometry.localPoints);
                  }}
                  onDragEnd={(event) => {
                    const dragState = customPointDragStateRef.current;
                    const geometry = computeCustomBubbleGeometryFromDraggedPoint(index, {
                      x: event.target.x() / scale,
                      y: event.target.y() / scale,
                    }, dragState?.pointIndex === index ? dragState.sourceAbsolutePoints : undefined);
                    customPointDragStateRef.current = null;
                    if (!geometry) {
                      return;
                    }
                    setLiveRect(geometry.rect);
                    setLiveCustomPoints(geometry.localPoints);
                    const contentCenterAbsolute = {
                      x: bubble.x + bubble.contentCenter.x,
                      y: bubble.y + bubble.contentCenter.y,
                    };
                    const nextContentCenter = {
                      x: contentCenterAbsolute.x - geometry.rect.x,
                      y: contentCenterAbsolute.y - geometry.rect.y,
                    };
                    const nextTailBase = bubble.tailBase
                      ? {
                          x: bubble.x + bubble.tailBase.x - geometry.rect.x,
                          y: bubble.y + bubble.tailBase.y - geometry.rect.y,
                        }
                      : undefined;
                    void executeCommand("updateBubble", {
                      pageId: page.id,
                      bubbleId: bubble.id,
                      x: geometry.rect.x,
                      y: geometry.rect.y,
                      width: geometry.rect.width,
                      height: geometry.rect.height,
                      customPoints: geometry.localPoints,
                      contentCenter: nextContentCenter,
                      ...(nextTailBase ? { tailBase: nextTailBase } : {}),
                    }).finally(() => {
                      setLiveCustomPoints(null);
                      setLiveRect(null);
                    });
                  }}
                />
                );
              })
            : null}
          {displayBubble.bubbleType === "explosion" ? (
            // Explosion bubble: each spike tip is draggable with full 2D positioning
            // Note: These circles are rendered OUTSIDE the bubble's Group, so they use absolute coordinates
            explosionSpikes.map((spike) => (
              <Circle
                key={`spike-${spike.index}`}
                x={(displayBubble.x + spike.x) * scale}
                y={(displayBubble.y + spike.y) * scale}
                radius={editingSpikeIndex === spike.index ? 9 : 6}
                fill={editingSpikeIndex === spike.index ? "#ff6b6b" : "#c36d2f"}
                stroke="#ffffff"
                strokeWidth={2}
                draggable
                onMouseDown={(event) => {
                  event.cancelBubble = true;
                }}
                onDblClick={(event) => {
                  event.cancelBubble = true;
                  // Enter single spike edit mode
                  if (editingSpikeIndex === spike.index) {
                    setEditingSpikeIndex(null);
                    setLiveSpikeDepth(null);
                  } else {
                    setEditingSpikeIndex(spike.index);
                    // Calculate current depth from position
                    const centerX = displayBubble.width / 2;
                    const centerY = displayBubble.height / 2;
                    const dx = spike.x - centerX;
                    const dy = spike.y - centerY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const outerRadius = Math.min(displayBubble.width, displayBubble.height) * 0.48;
                    const depth = Math.max(0.1, Math.min(1.0, (distance / outerRadius - 0.3) / 0.7));
                    setLiveSpikeDepth(depth);
                  }
                }}
                onDragStart={(event) => {
                  // Store initial position to calculate delta correctly
                  const target = event.target;
                  target.setAttr('initialX', target.x());
                  target.setAttr('initialY', target.y());
                }}
                onDragMove={(event) => {
                  const target = event.target;
                  const initialX = target.getAttr('initialX');
                  const initialY = target.getAttr('initialY');
                  
                  // Calculate the new absolute position based on drag delta
                  const newAbsX = initialX + target.x() - initialX;
                  const newAbsY = initialY + target.y() - initialY;
                  
                  // Convert to bubble-local coordinates for state update
                  const newX = newAbsX / scale - displayBubble.x;
                  const newY = newAbsY / scale - displayBubble.y;
                  
                  // Update live spike positions for real-time shape preview
                  const currentPositions = liveSpikePositions || explosionSpikes.map(s => ({ x: s.x, y: s.y }));
                  const newPositions = [...currentPositions];
                  newPositions[spike.index] = { x: newX, y: newY };
                  setLiveSpikePositions(newPositions);
                }}
                onDragEnd={(event) => {
                  const target = event.target;
                  const initialX = target.getAttr('initialX');
                  const initialY = target.getAttr('initialY');
                  
                  // Calculate final absolute position
                  const finalAbsX = initialX + target.x() - initialX;
                  const finalAbsY = initialY + target.y() - initialY;
                  
                  // Convert to bubble-local coordinates
                  const finalX = finalAbsX / scale - displayBubble.x;
                  const finalY = finalAbsY / scale - displayBubble.y;
                  
                  // Reset position to initial so it doesn't drift
                  target.position({ x: initialX, y: initialY });
                  target.setAttr('initialX', undefined);
                  target.setAttr('initialY', undefined);
                  
                  // Build new spikePositions array preserving existing positions
                  const currentPositions = bubble.spikePositions || [];
                  const newPositions: Array<{ x: number; y: number }> = [];
                  
                  for (let i = 0; i < bubble.spikeCount; i++) {
                    if (i === spike.index) {
                      newPositions[i] = { x: finalX, y: finalY };
                    } else {
                      newPositions[i] = currentPositions[i] ?? explosionSpikes[i];
                    }
                  }
                  
                  // Clear live positions and commit changes
                  setLiveSpikePositions(null);
                  
                  void executeCommand("updateBubble", {
                    pageId: page.id,
                    bubbleId: bubble.id,
                    spikePositions: newPositions,
                  });
                }}
              />
            ))
          ) : shouldShowTail ? (
            // Regular tail tip for other bubble types
            <Circle
              x={displayBubble.tailTip.x * scale}
              y={displayBubble.tailTip.y * scale}
              radius={8}
              fill="#c36d2f"
              draggable
              onMouseDown={(event) => {
                event.cancelBubble = true;
              }}
              onDragStart={(event) => {
                const target = event.target;
                target.setAttr('initialX', target.x());
                target.setAttr('initialY', target.y());
              }}
              onDragMove={(event) => {
                const target = event.target;
                setLiveTailTip({
                  x: target.x() / scale,
                  y: target.y() / scale,
                });
              }}
              onDragEnd={(event) => {
                const target = event.target;
                const initialX = target.getAttr('initialX');
                const initialY = target.getAttr('initialY');
                // Calculate final absolute position
                const finalX = initialX + (target.x() - initialX);
                const finalY = initialY + (target.y() - initialY);
                // Reset to initial position
                target.position({ x: initialX, y: initialY });
                target.setAttr('initialX', undefined);
                target.setAttr('initialY', undefined);
                setLiveTailTip({
                  x: finalX / scale,
                  y: finalY / scale,
                });
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  tailTip: {
                    x: finalX / scale,
                    y: finalY / scale,
                  },
                }).finally(() => {
                  setLiveTailTip(null);
                });
              }}
            />
          ) : null}
          {displayBubble.bubbleType !== "explosion" && shouldShowTail && tailBaseHandle ? (
            <Circle
              x={tailBaseHandle.x * scale}
              y={tailBaseHandle.y * scale}
              radius={7}
              fill="#ffffff"
              stroke="#c36d2f"
              strokeWidth={2}
              draggable
              onMouseDown={(event) => {
                event.cancelBubble = true;
              }}
              onDragStart={(event) => {
                const target = event.target;
                target.setAttr("initialX", target.x());
                target.setAttr("initialY", target.y());
              }}
              onDragMove={(event) => {
                const target = event.target;
                const nextTailBase = clampBubbleTailBaseLocalPoint(displayBubble, {
                  x: target.x() / scale - displayBubble.x,
                  y: target.y() / scale - displayBubble.y,
                });
                setLiveTailBase(nextTailBase);
              }}
              onDragEnd={(event) => {
                const target = event.target;
                const initialX = target.getAttr("initialX");
                const initialY = target.getAttr("initialY");
                const nextTailBase = clampBubbleTailBaseLocalPoint(displayBubble, {
                  x: target.x() / scale - displayBubble.x,
                  y: target.y() / scale - displayBubble.y,
                });
                target.position({ x: initialX, y: initialY });
                target.setAttr("initialX", undefined);
                target.setAttr("initialY", undefined);
                setLiveTailBase(nextTailBase);
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  tailBase: nextTailBase,
                }).finally(() => {
                  setLiveTailBase(null);
                });
              }}
            />
          ) : null}
          {/* Single spike depth editor - shown when a spike is selected for editing */}
          {displayBubble.bubbleType === "explosion" && editingSpikeIndex !== null && (() => {
            const spike = explosionSpikes[editingSpikeIndex];
            if (!spike) return null;
            
            const centerX = displayBubble.x + displayBubble.width / 2;
            const centerY = displayBubble.y + displayBubble.height / 2;
            
            // Calculate current spike position
            const spikeAbsX = displayBubble.x + spike.x;
            const spikeAbsY = displayBubble.y + spike.y;
            
            // Calculate angle from center to spike
            const angle = Math.atan2(spikeAbsY - centerY, spikeAbsX - centerX);
            
            // Calculate inner and outer positions for the depth slider
            const outerRadius = Math.min(displayBubble.width, displayBubble.height) * 0.48;
            const innerRadius = outerRadius * 0.25;
            
            const currentDepth = liveSpikeDepth ?? 0.5;
            const currentRadius = innerRadius + (outerRadius - innerRadius) * currentDepth;
            
            const innerX = centerX + Math.cos(angle) * innerRadius;
            const innerY = centerY + Math.sin(angle) * innerRadius;
            const outerX = centerX + Math.cos(angle) * outerRadius;
            const outerY = centerY + Math.sin(angle) * outerRadius;
            const currentX = centerX + Math.cos(angle) * currentRadius;
            const currentY = centerY + Math.sin(angle) * currentRadius;
            
            return (
              <>
                {/* Depth track line */}
                <Line
                  points={[
                    innerX * scale, innerY * scale,
                    outerX * scale, outerY * scale,
                  ]}
                  stroke="#ff6b6b"
                  strokeWidth={2}
                  dash={[4, 4]}
                />
                {/* Depth control handle */}
                <Circle
                  x={currentX * scale}
                  y={currentY * scale}
                  radius={8}
                  fill="#ff6b6b"
                  stroke="#ffffff"
                  strokeWidth={2}
                  draggable
                  onMouseDown={(event) => event.cancelBubble = true}
                  onDragMove={(event) => {
                    const stage = event.target.getStage();
                    const pointer = stage?.getPointerPosition();
                    if (!pointer) return;
                    
                    // Calculate distance from center along the angle
                    const px = pointer.x / scale;
                    const py = pointer.y / scale;
                    const dx = px - centerX;
                    const dy = py - centerY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    // Clamp to track range
                    const clampedDist = Math.max(innerRadius, Math.min(outerRadius, dist));
                    
                    // Convert to depth (0.1 - 1.0)
                    const newDepth = (clampedDist - innerRadius) / (outerRadius - innerRadius);
                    setLiveSpikeDepth(newDepth);
                    
                    // Update spike position
                    const newX = displayBubble.width / 2 + Math.cos(angle) * clampedDist;
                    const newY = displayBubble.height / 2 + Math.sin(angle) * clampedDist;
                    
                    const currentPositions = bubble.spikePositions || explosionSpikes.map(s => ({ x: s.x, y: s.y }));
                    const newPositions = [...currentPositions];
                    newPositions[editingSpikeIndex] = { x: newX, y: newY };
                    setLiveSpikePositions(newPositions);
                  }}
                  onDragEnd={() => {
                    // Commit changes
                    const currentPositions = bubble.spikePositions || [];
                    const newPositions: Array<{ x: number; y: number }> = [];
                    const livePositions = liveSpikePositions || explosionSpikes.map(s => ({ x: s.x, y: s.y }));
                    
                    for (let i = 0; i < bubble.spikeCount; i++) {
                      if (i === editingSpikeIndex) {
                        newPositions[i] = livePositions[i];
                      } else {
                        newPositions[i] = currentPositions[i] ?? explosionSpikes[i];
                      }
                    }
                    
                    setLiveSpikePositions(null);
                    void executeCommand("updateBubble", {
                      pageId: page.id,
                      bubbleId: bubble.id,
                      spikePositions: newPositions,
                    });
                  }}
                />
                {/* Close button */}
                <Circle
                  x={(displayBubble.x + displayBubble.width + 20) * scale}
                  y={(displayBubble.y + 20) * scale}
                  radius={10}
                  fill="#666666"
                  stroke="#ffffff"
                  strokeWidth={2}
                  onClick={() => {
                    setEditingSpikeIndex(null);
                    setLiveSpikeDepth(null);
                  }}
                />
                <Text
                  x={(displayBubble.x + displayBubble.width + 20) * scale - 4}
                  y={(displayBubble.y + 20) * scale - 6}
                  text="×"
                  fontSize={14}
                  fill="#ffffff"
                  onClick={() => {
                    setEditingSpikeIndex(null);
                    setLiveSpikeDepth(null);
                  }}
                />
                {/* Hint text */}
                <Text
                  x={(displayBubble.x + displayBubble.width + 35) * scale}
                  y={(displayBubble.y + 15) * scale}
                  text="拖动红点调整尖端深度，点击×退出"
                  fontSize={12}
                  fill="#666666"
                />
              </>
            );
          })()}
        </>
      ) : null}
    </>
  );
};

export const CanvasView = ({
  page,
  onRequestImportImage,
  isLayoutResizing = false,
}: {
  page: Page;
  onRequestImportImage: (pageId: string, panelId: string) => void;
  isLayoutResizing?: boolean;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const projectId = useEditorStore((state) => state.project.id);
  const projectTitle = useEditorStore((state) => state.project.title);
  const projectType = useEditorStore((state) => state.project.type);
  const selection = useEditorStore((state) => state.selection);
  const multiSelection = useEditorStore((state) => state.multiSelection);
  const activeTool = useEditorStore((state) => state.activeTool);
  const bubbleInsert = useEditorStore((state) => state.bubbleInsert);
  const zoom = useEditorStore((state) => state.zoom);
  const [draftShape, setDraftShape] = useState<DraftShape>(null);
  const [marqueeDrag, setMarqueeDrag] = useState<MarqueeDragState>(null);
  const [customBubblePoints, setCustomBubblePoints] = useState<Point[]>([]);
  const [customBubbleHoverPoint, setCustomBubbleHoverPoint] = useState<Point | null>(null);
  const [boundaryOverlayPreview, setBoundaryOverlayPreview] = useState<BoundaryOverlayPreview>(null);
  const [smartGuide, setSmartGuide] = useState<SmartGuideState>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const stableLayoutRef = useRef<CanvasLayoutSnapshot | null>(null);
  const stageScrollStateRef = useRef<{
    pageId: string;
    width: number;
    height: number;
    scrollable: boolean;
  } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const isCustomBubbleInsertMode =
    activeTool === "bubble" && bubbleInsert.mode === "customClickDraw";
  const { t } = useI18n();

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const styles = window.getComputedStyle(element);
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      setViewport({
        width: Math.max(0, element.clientWidth - horizontalPadding),
        height: Math.max(0, element.clientHeight - verticalPadding),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setBoundaryOverlayPreview(null);
    setSmartGuide(null);
  }, [page.id, selection?.objectId, selection?.objectType, selection?.pageId]);

  useEffect(() => {
    setContextMenu(null);
  }, [page.id]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    const handleWindowResize = () => {
      setContextMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [contextMenu]);

  useEffect(() => {
    setMarqueeDrag(null);
    setCustomBubblePoints([]);
    setCustomBubbleHoverPoint(null);
  }, [page.id]);

  useEffect(() => {
    if (isCustomBubbleInsertMode) {
      setDraftShape(null);
      setMarqueeDrag(null);
      return;
    }
    setCustomBubblePoints([]);
    setCustomBubbleHoverPoint(null);
  }, [isCustomBubbleInsertMode]);

  useEffect(() => {
    if (!isCustomBubbleInsertMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setCustomBubblePoints([]);
      setCustomBubbleHoverPoint(null);
      setContextMenu(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCustomBubbleInsertMode]);

  const workspace = getPageWorkspace(page);
  const fitScale =
    viewport.width > 0 && viewport.height > 0
      ? Math.min(viewport.width / workspace.width, viewport.height / workspace.height, 1)
      : 1;
  const coverWorkspaceScale =
    viewport.width > 0 && viewport.height > 0
      ? Math.max(viewport.width / workspace.width, viewport.height / workspace.height)
      : 1;
  const computedScale = Math.max(0.1, fitScale * zoom);
  const computedWorkspaceScale =
    zoom > 1 ? Math.max(coverWorkspaceScale, computedScale) : coverWorkspaceScale;
  const computedWorkspaceCanvasWidth = workspace.width * computedWorkspaceScale;
  const computedWorkspaceCanvasHeight = workspace.height * computedWorkspaceScale;
  const baseStageWidth = Math.max(1, viewport.width);
  const baseStageHeight = Math.max(1, viewport.height);
  const shouldUseScrollableStage =
    zoom > 1 &&
    (computedWorkspaceCanvasWidth > baseStageWidth ||
      computedWorkspaceCanvasHeight > baseStageHeight);
  const stageWidth = shouldUseScrollableStage
    ? Math.max(1, Math.ceil(computedWorkspaceCanvasWidth))
    : baseStageWidth;
  const stageHeight = shouldUseScrollableStage
    ? Math.max(1, Math.ceil(computedWorkspaceCanvasHeight))
    : baseStageHeight;
  const computedWorkspaceCanvasOrigin = {
    x: (stageWidth - computedWorkspaceCanvasWidth) * 0.5,
    y: (stageHeight - computedWorkspaceCanvasHeight) * 0.5,
  };
  const computedContentCanvasOrigin = {
    x: computedWorkspaceCanvasWidth * 0.5 - (workspace.x + workspace.width * 0.5) * computedScale,
    y: computedWorkspaceCanvasHeight * 0.5 - (workspace.y + workspace.height * 0.5) * computedScale,
  };
  const computedPageCanvasOrigin = {
    x: computedWorkspaceCanvasOrigin.x + computedContentCanvasOrigin.x,
    y: computedWorkspaceCanvasOrigin.y + computedContentCanvasOrigin.y,
  };
  const computedLayout: CanvasLayoutSnapshot = {
    scale: computedScale,
    workspaceScale: computedWorkspaceScale,
    workspaceCanvasOrigin: computedWorkspaceCanvasOrigin,
    contentCanvasOrigin: computedContentCanvasOrigin,
    pageCanvasOrigin: computedPageCanvasOrigin,
  };
  if (!isLayoutResizing) {
    stableLayoutRef.current = computedLayout;
  }
  const activeLayout = isLayoutResizing ? stableLayoutRef.current ?? computedLayout : computedLayout;
  const scale = activeLayout.scale;
  const workspaceScale = activeLayout.workspaceScale;
  const workspaceCanvasWidth = workspace.width * workspaceScale;
  const workspaceCanvasHeight = workspace.height * workspaceScale;
  const workspaceCanvasOrigin = activeLayout.workspaceCanvasOrigin;
  const contentCanvasOrigin = activeLayout.contentCanvasOrigin;
  const pageCanvasOrigin = activeLayout.pageCanvasOrigin;
  const customBubbleCloseDistance = CUSTOM_BUBBLE_CLOSE_DISTANCE_PX / Math.max(scale, 0.0001);
  const customBubbleCanFinalize = customBubblePoints.length >= 3;
  const customBubbleHoverNearStart =
    customBubbleCanFinalize &&
    customBubbleHoverPoint !== null &&
    Math.hypot(
      customBubbleHoverPoint.x - customBubblePoints[0].x,
      customBubbleHoverPoint.y - customBubblePoints[0].y,
    ) <= customBubbleCloseDistance;
  const customBubblePreview = useMemo(
    () => buildCustomBubblePreview(customBubblePoints, bubbleInsert.customSmoothness),
    [customBubblePoints, bubbleInsert.customSmoothness],
  );
  const customBubbleHoverPreview = useMemo(() => {
    if (!customBubbleHoverPoint || customBubblePoints.length === 0 || customBubbleHoverNearStart) {
      return null;
    }
    return buildCustomBubblePreview(
      [...customBubblePoints, customBubbleHoverPoint],
      bubbleInsert.customSmoothness,
    );
  }, [
    customBubbleHoverPoint,
    customBubblePoints,
    customBubbleHoverNearStart,
    bubbleInsert.customSmoothness,
  ]);
  const customBubbleGuidePolyline = useMemo(() => {
    if (customBubblePoints.length === 0) {
      return [];
    }
    const guidePoints = [...customBubblePoints];
    if (customBubbleHoverPoint) {
      guidePoints.push(customBubbleHoverNearStart ? customBubblePoints[0] : customBubbleHoverPoint);
    }
    return guidePoints.flatMap((point) => [point.x * scale, point.y * scale]);
  }, [customBubblePoints, customBubbleHoverPoint, customBubbleHoverNearStart, scale]);

  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) {
      return;
    }

    const previousState = stageScrollStateRef.current;
    const maxScrollLeft = Math.max(0, stageWidth - viewport.width);
    const maxScrollTop = Math.max(0, stageHeight - viewport.height);

    if (!shouldUseScrollableStage) {
      if (previousState?.scrollable) {
        element.scrollLeft = 0;
        element.scrollTop = 0;
      }
      stageScrollStateRef.current = {
        pageId: page.id,
        width: stageWidth,
        height: stageHeight,
        scrollable: false,
      };
      return;
    }

    const isNewScrollableContext =
      !previousState || previousState.pageId !== page.id || !previousState.scrollable;

    if (isNewScrollableContext) {
      element.scrollLeft = maxScrollLeft * 0.5;
      element.scrollTop = maxScrollTop * 0.5;
    } else if (
      previousState.width !== stageWidth ||
      previousState.height !== stageHeight
    ) {
      const previousCenterX = element.scrollLeft + viewport.width * 0.5;
      const previousCenterY = element.scrollTop + viewport.height * 0.5;
      const centerRatioX =
        previousState.width > 0 ? previousCenterX / previousState.width : 0.5;
      const centerRatioY =
        previousState.height > 0 ? previousCenterY / previousState.height : 0.5;
      element.scrollLeft = Math.max(
        0,
        Math.min(maxScrollLeft, centerRatioX * stageWidth - viewport.width * 0.5),
      );
      element.scrollTop = Math.max(
        0,
        Math.min(maxScrollTop, centerRatioY * stageHeight - viewport.height * 0.5),
      );
    }

    stageScrollStateRef.current = {
      pageId: page.id,
      width: stageWidth,
      height: stageHeight,
      scrollable: true,
    };
  }, [shouldUseScrollableStage, stageWidth, stageHeight, viewport.width, viewport.height, page.id]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
    };

    const handlePaste = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      const hasImageInClipboardData = Boolean(
        clipboardData &&
          (Array.from(clipboardData.items).some((item) => item.type.startsWith("image/")) ||
            Array.from(clipboardData.files).some((file) => file.type.startsWith("image/"))),
      );
      if (!hasImageInClipboardData && !window.navigator.clipboard?.read) {
        return;
      }
      if (hasImageInClipboardData) {
        event.preventDefault();
      }

      const selectedPanel =
        selection?.pageId === page.id && selection.objectType === "panel"
          ? page.panels.find((panel) => panel.id === selection.objectId) ?? null
          : null;

      const wrapperElement = wrapperRef.current;
      const wrapperRect = wrapperElement?.getBoundingClientRect() ?? null;
      const wrapperScrollLeft = wrapperElement?.scrollLeft ?? 0;
      const wrapperScrollTop = wrapperElement?.scrollTop ?? 0;
      const pointerPoint =
        wrapperRect && lastPointerRef.current
          ? {
              x: Math.max(
                0,
                Math.min(
                  page.width,
                  (lastPointerRef.current.clientX -
                    wrapperRect.left +
                    wrapperScrollLeft -
                    pageCanvasOrigin.x) /
                    scale,
                ),
              ),
              y: Math.max(
                0,
                Math.min(
                  page.height,
                  (lastPointerRef.current.clientY -
                    wrapperRect.top +
                    wrapperScrollTop -
                    pageCanvasOrigin.y) /
                    scale,
                ),
              ),
            }
          : null;

      const topToBottomPanels = getRenderableLayers(page)
        .flatMap((entry) => (entry.objectType === "panel" ? [entry.object] : []))
        .reverse();
      const hoveredPanel = pointerPoint
        ? topToBottomPanels.find((panel) =>
            isPointInPolygon(pointerPoint, getPanelAbsolutePoints(panel)),
          ) ?? null
        : null;

      const targetPanel = selectedPanel ?? hoveredPanel;
      const anchorPoint = pointerPoint ?? {
        x: page.width * 0.5,
        y: page.height * 0.5,
      };

      void (async () => {
        const file = await getClipboardImageFile(event);
        if (!file) {
          return;
        }
        let src = "";
        try {
          src = await persistImportedImageForProject(projectId, projectTitle, file);
        } catch (error) {
          console.warn("Failed to persist pasted image into project assets; paste aborted.", error);
          return;
        }
        if (projectType === "cg") {
          const fullStagePanel = (await executeCommand("createPanel", {
            pageId: page.id,
            x: Math.max(0, (page.width - Math.min(page.width, CG_PAGE_WIDTH)) * 0.5),
            y: Math.max(0, (page.height - Math.min(page.height, CG_PAGE_HEIGHT)) * 0.5),
            width: Math.min(page.width, CG_PAGE_WIDTH),
            height: Math.min(page.height, CG_PAGE_HEIGHT),
          })) as Panel | null;
          if (fullStagePanel) {
            await executeCommand("placeImageInPanel", {
              pageId: page.id,
              panelId: fullStagePanel.id,
              src,
              prompt: file.name,
            });
          }
          return;
        }
        if (targetPanel) {
          await executeCommand("placeImageInPanel", {
            pageId: page.id,
            panelId: targetPanel.id,
            src,
            prompt: file.name,
          });
          return;
        }

        const defaultWidth = 400;
        const defaultHeight = 300;
        const newPanel = (await executeCommand("createPanel", {
          pageId: page.id,
          x: Math.max(0, Math.min(page.width - defaultWidth, anchorPoint.x - defaultWidth * 0.5)),
          y: Math.max(
            0,
            Math.min(page.height - defaultHeight, anchorPoint.y - defaultHeight * 0.5),
          ),
          width: defaultWidth,
          height: defaultHeight,
        })) as Panel | null;
        if (newPanel) {
          await executeCommand("placeImageInPanel", {
            pageId: page.id,
            panelId: newPanel.id,
            src,
            prompt: file.name,
          });
        }
      })();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("paste", handlePaste);
    };
  }, [page, scale, pageCanvasOrigin, executeCommand, projectId, projectTitle, projectType, selection]);

  const selectedObject = getSelectedObject(page, selection);
  const pageMultiSelection = useMemo(
    () => multiSelection.filter((entry) => entry.pageId === page.id),
    [multiSelection, page.id],
  );
  const isObjectHighlighted = (
    objectType: "panel" | "text" | "bubble",
    objectId: string,
  ) =>
    pageMultiSelection.some(
      (entry) => entry.objectType === objectType && entry.objectId === objectId,
    );
  const selectedImagePanel =
    selectedObject && "style" in selectedObject && selectedObject.image ? selectedObject : null;
  const selectedRect =
    selectedObject && "style" in selectedObject
      ? selectedObject
      : selectedObject && "tailTip" in selectedObject
        ? selectedObject
        : selectedObject && "fontFamily" in selectedObject
          ? selectedObject
          : null;

  const showVerticalGuide =
    selectedRect && Math.abs(selectedRect.x + selectedRect.width / 2 - page.width / 2) < 24;
  const showHorizontalGuide =
    selectedRect && Math.abs(selectedRect.y + selectedRect.height / 2 - page.height / 2) < 24;
  const selectedBoundaryRect =
    selection?.pageId === page.id &&
    (selection.objectType === "panel" || selection.objectType === "text")
      ? boundaryOverlayPreview &&
        boundaryOverlayPreview.objectId === selection.objectId &&
        boundaryOverlayPreview.objectType === selection.objectType
        ? boundaryOverlayPreview.rect
        : selectedObject && "style" in selectedObject
          ? {
              x: selectedObject.x,
              y: selectedObject.y,
              width: selectedObject.width,
              height: selectedObject.height,
            }
          : selectedObject && "fontFamily" in selectedObject
            ? {
                x: selectedObject.x,
                y: selectedObject.y,
                width: selectedObject.width,
                height: selectedObject.height,
              }
            : null
      : null;
  const showPageBoundaryOverlay =
    selectedBoundaryRect !== null && isRectCrossingPageBounds(selectedBoundaryRect, page);

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const openContextMenu = (
    event: KonvaEventObject<MouseEvent>,
    target: ContextMenuTarget,
  ) => {
    event.evt.preventDefault();
    event.cancelBubble = true;
    const wrapper = wrapperRef.current;
    const wrapperRect = wrapper?.getBoundingClientRect();
    if (!wrapperRect) {
      return;
    }
    const scrollLeft = wrapper?.scrollLeft ?? 0;
    const scrollTop = wrapper?.scrollTop ?? 0;
    const x = Math.max(
      scrollLeft + 8,
      Math.min(
        event.evt.clientX - wrapperRect.left + scrollLeft,
        scrollLeft + wrapperRect.width - CONTEXT_MENU_WIDTH - 8,
      ),
    );
    const y = Math.max(
      scrollTop + 8,
      Math.min(event.evt.clientY - wrapperRect.top + scrollTop, scrollTop + wrapperRect.height - 260),
    );
    setContextMenu({ x, y, target });
  };

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    closeContextMenu();
    if (!selectedImagePanel?.image) {
      return;
    }

    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    const focusX =
      pointer
        ? Math.max(
            0,
            Math.min(
              1,
              ((pointer.x - pageCanvasOrigin.x) / scale - selectedImagePanel.x) /
                selectedImagePanel.width,
            ),
          )
        : 0.5;
    const focusY =
      pointer
        ? Math.max(
            0,
            Math.min(
              1,
              ((pointer.y - pageCanvasOrigin.y) / scale - selectedImagePanel.y) /
                selectedImagePanel.height,
            ),
          )
        : 0.5;
    const sourceWidth = selectedImagePanel.image.sourceWidth ?? selectedImagePanel.image.viewBox.width;
    const sourceHeight =
      selectedImagePanel.image.sourceHeight ?? selectedImagePanel.image.viewBox.height;
    const nextViewBox = zoomImageViewBox(
      selectedImagePanel,
      sourceWidth,
      sourceHeight,
      selectedImagePanel.image.viewBox,
      event.evt.deltaY < 0 ? 0.9 : 1.1,
      focusX,
      focusY,
    );
    void executeCommand("setPanelImageCrop", {
      pageId: page.id,
      panelId: selectedImagePanel.id,
      viewBox: nextViewBox,
    });
  };

  const finalizeCustomBubble = async (points: Point[]) => {
    const preview = buildCustomBubblePreview(points, bubbleInsert.customSmoothness);
    if (!preview) {
      return;
    }
    setCustomBubblePoints([]);
    setCustomBubbleHoverPoint(null);
    await executeCommand("createBubble", {
      pageId: page.id,
      x: preview.x,
      y: preview.y,
      width: preview.width,
      height: preview.height,
      bubbleType: "custom",
      customPoints: preview.localPoints,
      customSmoothness: bubbleInsert.customSmoothness,
      keepTool: false,
    });
  };

  const handleCanvasDown = async (event: KonvaEventObject<MouseEvent>) => {
    closeContextMenu();
    if (isCustomBubbleInsertMode) {
      if (event.evt.button !== 0) {
        return;
      }
      const point = getPointFromEvent(event, scale, pageCanvasOrigin);
      if (!point) {
        return;
      }
      setCustomBubbleHoverPoint(point);
      if (
        customBubblePoints.length >= 3 &&
        Math.hypot(point.x - customBubblePoints[0].x, point.y - customBubblePoints[0].y) <=
          customBubbleCloseDistance
      ) {
        await finalizeCustomBubble(customBubblePoints);
        return;
      }
      setCustomBubblePoints((previous) => [...previous, point]);
      return;
    }

    if (event.evt.button !== 0) {
      return;
    }
    const point = getPointFromEvent(event, scale, pageCanvasOrigin);
    if (!point) {
      return;
    }

    if (activeTool === "text") {
      await executeCommand("createText", {
        pageId: page.id,
        x: point.x,
        y: point.y,
      });
      return;
    }

    if (activeTool === "select") {
      setSmartGuide(null);
      setMarqueeDrag({
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
      });
      return;
    }

    if (activeTool === "panel" || activeTool === "bubble") {
      setDraftShape({
        kind: activeTool,
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
      });
      return;
    }

    await executeCommand("clearSelection", {});
  };

  const handleCanvasContextMenu = (event: KonvaEventObject<MouseEvent>) => {
    setMarqueeDrag(null);
    if (isCustomBubbleInsertMode) {
      event.evt.preventDefault();
      event.cancelBubble = true;
      closeContextMenu();
      if (customBubblePoints.length >= 3) {
        void finalizeCustomBubble(customBubblePoints);
      } else {
        setCustomBubblePoints([]);
        setCustomBubbleHoverPoint(null);
      }
      return;
    }
    const point = getPointFromEvent(event, scale, pageCanvasOrigin);
    if (!point) {
      return;
    }
    openContextMenu(event, {
      kind: "canvas",
      point,
    });
  };

  const contextMenuTarget = contextMenu?.target ?? null;
  const panelContextTarget = contextMenuTarget?.kind === "panel" ? contextMenuTarget : null;
  const textContextTarget = contextMenuTarget?.kind === "text" ? contextMenuTarget : null;
  const bubbleContextTarget = contextMenuTarget?.kind === "bubble" ? contextMenuTarget : null;
  const canvasContextTarget = contextMenuTarget?.kind === "canvas" ? contextMenuTarget : null;

  const panelForContextMenu = panelContextTarget
    ? page.panels.find((entry) => entry.id === panelContextTarget.panelId) ?? null
    : null;
  const textForContextMenu = textContextTarget
    ? page.texts.find((entry) => entry.id === textContextTarget.textId) ?? null
    : null;
  const bubbleForContextMenu = bubbleContextTarget
    ? page.bubbles.find((entry) => entry.id === bubbleContextTarget.bubbleId) ?? null
    : null;
  const getLayerMoveState = (objectType: "panel" | "text" | "bubble", objectId: string) => {
    const layerRef = `${objectType}:${objectId}`;
    const currentIndex = page.layers.indexOf(layerRef);
    return {
      canMoveUp: currentIndex >= 0 && currentIndex < page.layers.length - 1,
      canMoveDown: currentIndex > 0,
    };
  };
  const panelLayerMoveState = panelForContextMenu
    ? getLayerMoveState("panel", panelForContextMenu.id)
    : null;
  const textLayerMoveState = textForContextMenu
    ? getLayerMoveState("text", textForContextMenu.id)
    : null;
  const bubbleLayerMoveState = bubbleForContextMenu
    ? getLayerMoveState("bubble", bubbleForContextMenu.id)
    : null;
  const pageSelectionObjects = pageMultiSelection.map((entry) => ({
    objectType: entry.objectType,
    objectId: entry.objectId,
  }));
  const pageSelectionKeys = new Set(
    pageSelectionObjects.map((entry) => `${entry.objectType}:${entry.objectId}`),
  );
  const canGroupSelection = pageSelectionObjects.length >= 2;
  const canUngroupSelection = page.groups.some((group) =>
    group.members.some((member) =>
      pageSelectionKeys.has(`${member.objectType}:${member.objectId}`),
    ),
  );
  const groupContextActions: ContextMenuAction[] = [
    {
      label: "Group (Ctrl+G)",
      disabled: !canGroupSelection,
      onSelect: () => {
        if (!canGroupSelection) {
          return;
        }
        closeContextMenu();
        void executeCommand("groupSelection", {
          pageId: page.id,
          objects: pageSelectionObjects,
        });
      },
    },
    {
      label: "Ungroup (Alt+G)",
      disabled: !canUngroupSelection,
      onSelect: () => {
        if (!canUngroupSelection) {
          return;
        }
        closeContextMenu();
        void executeCommand("ungroupSelection", {
          pageId: page.id,
          objects: pageSelectionObjects,
        });
      },
    },
  ];

  const confirmDeleteObject = (objectType: "panel" | "text" | "bubble", objectId: string) => {
    closeContextMenu();
    void executeCommand("deleteObject", {
      pageId: page.id,
      objectType,
      objectId,
    });
  };

  const contextMenuTitle =
    contextMenu?.target.kind === "panel"
      ? t("contextMenu.panel")
      : contextMenu?.target.kind === "text"
        ? t("contextMenu.text")
        : contextMenu?.target.kind === "bubble"
          ? t("contextMenu.bubble")
          : t("contextMenu.canvas");

  const contextMenuActions: ContextMenuAction[] =
    contextMenu?.target.kind === "panel" && panelForContextMenu
      ? [
          {
            label: panelForContextMenu.image
              ? t("contextMenu.replaceImage")
              : t("contextMenu.importImage"),
            onSelect: () => {
              closeContextMenu();
              onRequestImportImage(page.id, panelForContextMenu.id);
            },
          },
          {
            label: t("contextMenu.addVertex"),
            onSelect: () => {
              closeContextMenu();
              void executeCommand("addPanelPoint", {
                pageId: page.id,
                panelId: panelForContextMenu.id,
              });
            },
          },
          {
            label: t("contextMenu.removeVertex"),
            disabled: panelForContextMenu.points.length <= 3,
            onSelect: () => {
              if (panelForContextMenu.points.length <= 3) {
                return;
              }
              closeContextMenu();
              void executeCommand("removePanelPoint", {
                pageId: page.id,
                panelId: panelForContextMenu.id,
                pointIndex: panelForContextMenu.points.length - 1,
              });
            },
          },
          {
            label: t("contextMenu.moveLayerUp"),
            disabled: !panelLayerMoveState?.canMoveUp,
            onSelect: () => {
              if (!panelLayerMoveState?.canMoveUp) {
                return;
              }
              closeContextMenu();
              void executeCommand("moveLayer", {
                pageId: page.id,
                objectType: "panel",
                objectId: panelForContextMenu.id,
                direction: "up",
              });
            },
          },
          {
            label: t("contextMenu.moveLayerDown"),
            disabled: !panelLayerMoveState?.canMoveDown,
            onSelect: () => {
              if (!panelLayerMoveState?.canMoveDown) {
                return;
              }
              closeContextMenu();
              void executeCommand("moveLayer", {
                pageId: page.id,
                objectType: "panel",
                objectId: panelForContextMenu.id,
                direction: "down",
              });
            },
          },
          {
            label: t("contextMenu.deletePanel"),
            danger: true,
            onSelect: () => {
              confirmDeleteObject("panel", panelForContextMenu.id);
            },
          },
          ...groupContextActions,
        ]
      : contextMenu?.target.kind === "text" && textForContextMenu
        ? [
            {
              label:
                textForContextMenu.direction === "vertical"
                  ? t("contextMenu.toHorizontal")
                  : t("contextMenu.toVertical"),
              onSelect: () => {
                closeContextMenu();
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: textForContextMenu.id,
                  direction:
                    textForContextMenu.direction === "vertical" ? "horizontal" : "vertical",
                });
              },
            },
            {
              label: t("contextMenu.moveLayerUp"),
              disabled: !textLayerMoveState?.canMoveUp,
              onSelect: () => {
                if (!textLayerMoveState?.canMoveUp) {
                  return;
                }
                closeContextMenu();
                void executeCommand("moveLayer", {
                  pageId: page.id,
                  objectType: "text",
                  objectId: textForContextMenu.id,
                  direction: "up",
                });
              },
            },
            {
              label: t("contextMenu.moveLayerDown"),
              disabled: !textLayerMoveState?.canMoveDown,
              onSelect: () => {
                if (!textLayerMoveState?.canMoveDown) {
                  return;
                }
                closeContextMenu();
                void executeCommand("moveLayer", {
                  pageId: page.id,
                  objectType: "text",
                  objectId: textForContextMenu.id,
                  direction: "down",
                });
              },
            },
            {
              label: t("contextMenu.deleteText"),
              danger: true,
              onSelect: () => {
                confirmDeleteObject("text", textForContextMenu.id);
              },
            },
            ...groupContextActions,
          ]
        : contextMenu?.target.kind === "bubble" && bubbleForContextMenu
          ? [
              {
                label: t("contextMenu.moveLayerUp"),
                disabled: !bubbleLayerMoveState?.canMoveUp,
                onSelect: () => {
                  if (!bubbleLayerMoveState?.canMoveUp) {
                    return;
                  }
                  closeContextMenu();
                  void executeCommand("moveLayer", {
                    pageId: page.id,
                    objectType: "bubble",
                    objectId: bubbleForContextMenu.id,
                    direction: "up",
                  });
                },
              },
              {
                label: t("contextMenu.moveLayerDown"),
                disabled: !bubbleLayerMoveState?.canMoveDown,
                onSelect: () => {
                  if (!bubbleLayerMoveState?.canMoveDown) {
                    return;
                  }
                  closeContextMenu();
                  void executeCommand("moveLayer", {
                    pageId: page.id,
                    objectType: "bubble",
                    objectId: bubbleForContextMenu.id,
                    direction: "down",
                  });
                },
              },
              {
                label: t("contextMenu.deleteBubble"),
                danger: true,
                onSelect: () => {
                  confirmDeleteObject("bubble", bubbleForContextMenu.id);
                },
              },
              ...groupContextActions,
            ]
          : canvasContextTarget
            ? [
                {
                  label: t("contextMenu.createPanelHere"),
                  onSelect: () => {
                    closeContextMenu();
                    void executeCommand("createPanel", {
                      pageId: page.id,
                      x: canvasContextTarget.point.x,
                      y: canvasContextTarget.point.y,
                      width: 320,
                      height: 320,
                    });
                  },
                },
                {
                  label: t("contextMenu.createTextHere"),
                  onSelect: () => {
                    closeContextMenu();
                    void executeCommand("createText", {
                      pageId: page.id,
                      x: canvasContextTarget.point.x,
                      y: canvasContextTarget.point.y,
                    });
                  },
                },
                {
                  label: t("contextMenu.createBubbleHere"),
                  onSelect: () => {
                    closeContextMenu();
                    void executeCommand("createBubble", {
                      pageId: page.id,
                      x: canvasContextTarget.point.x,
                      y: canvasContextTarget.point.y,
                      width: 320,
                      height: 150,
                    });
                  },
                },
                {
                  label: t("contextMenu.clearSelection"),
                  onSelect: () => {
                    closeContextMenu();
                    void executeCommand("clearSelection", {});
                  },
                },
              ]
            : [];

  const gridStep = GRID_SIZE * 5;
  const minGridX = Math.floor(workspace.x / gridStep);
  const maxGridX = Math.ceil((workspace.x + workspace.width) / gridStep);
  const minGridY = Math.floor(workspace.y / gridStep);
  const maxGridY = Math.ceil((workspace.y + workspace.height) / gridStep);
  const renderableLayers = getRenderableLayers(page);
  const orderedLayers = selectedImagePanel
    ? [
        ...renderableLayers.filter(
          (entry) => entry.objectType !== "panel" || entry.object.id !== selectedImagePanel.id,
        ),
        ...renderableLayers.filter(
          (entry) => entry.objectType === "panel" && entry.object.id === selectedImagePanel.id,
        ),
      ]
    : renderableLayers;
  const nonTextLayers = orderedLayers.filter((entry) => entry.objectType !== "text");
  const textLayers = orderedLayers.filter((entry) => entry.objectType === "text");

  return (
    <div
      ref={wrapperRef}
      className="canvas-wrap"
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <Stage
        width={stageWidth}
        height={stageHeight}
        onWheel={handleWheel}
        onMouseMove={(event) => {
          if (isCustomBubbleInsertMode) {
            const point = getPointFromEvent(event, scale, pageCanvasOrigin);
            setCustomBubbleHoverPoint(point);
            return;
          }
          const point = getPointFromEvent(event, scale, pageCanvasOrigin);
          if (!point) {
            return;
          }
          if (marqueeDrag) {
            setMarqueeDrag({
              ...marqueeDrag,
              x: point.x,
              y: point.y,
            });
            return;
          }
          if (!draftShape) {
            return;
          }
          setDraftShape({
            ...draftShape,
            x: point.x,
            y: point.y,
            width: point.x - draftShape.startX,
            height: point.y - draftShape.startY,
          });
        }}
        onMouseLeave={() => {
          if (isCustomBubbleInsertMode) {
            setCustomBubbleHoverPoint(null);
          }
          if (marqueeDrag) {
            setMarqueeDrag(null);
          }
        }}
        onMouseUp={() => {
          if (isCustomBubbleInsertMode) {
            return;
          }
          const marqueeRect = createRectFromMarquee(marqueeDrag);
          if (marqueeRect) {
            const selectionCandidates = getRenderableLayers(page)
              .map((entry) => {
                if (entry.objectType === "panel") {
                  const absolutePoints = entry.object.points.map((point) => ({
                    x: entry.object.x + point.x,
                    y: entry.object.y + point.y,
                  }));
                  const minX = Math.min(...absolutePoints.map((point) => point.x));
                  const minY = Math.min(...absolutePoints.map((point) => point.y));
                  const maxX = Math.max(...absolutePoints.map((point) => point.x));
                  const maxY = Math.max(...absolutePoints.map((point) => point.y));
                  return {
                    objectType: "panel" as const,
                    objectId: entry.object.id,
                    rect: {
                      x: minX,
                      y: minY,
                      width: maxX - minX,
                      height: maxY - minY,
                    },
                  };
                }
                if (entry.objectType === "text") {
                  return {
                    objectType: "text" as const,
                    objectId: entry.object.id,
                    rect: {
                      x: entry.object.x,
                      y: entry.object.y,
                      width: entry.object.width,
                      height: entry.object.height,
                    },
                  };
                }
                return {
                  objectType: "bubble" as const,
                  objectId: entry.object.id,
                  rect: {
                    x: entry.object.x,
                    y: entry.object.y,
                    width: entry.object.width,
                    height: entry.object.height,
                  },
                };
              })
              .filter((entry) => doRectsIntersect(marqueeRect, entry.rect))
              .map((entry) => ({
                objectType: entry.objectType,
                objectId: entry.objectId,
              }));
            const hasArea = marqueeRect.width > 2 || marqueeRect.height > 2;
            if (hasArea) {
              void executeCommand("selectObjects", {
                pageId: page.id,
                objects: selectionCandidates,
              });
            } else {
              void executeCommand("clearSelection", {});
            }
            setMarqueeDrag(null);
            return;
          }
          const rect = createRectFromDrag(draftShape);
          if (!rect) {
            return;
          }

          const width = rect.width < 40 ? 320 : rect.width;
          const height = rect.height < 40 ? (draftShape?.kind === "bubble" ? 150 : 320) : rect.height;

          if (draftShape?.kind === "panel") {
            void executeCommand("createPanel", {
              pageId: page.id,
              x: rect.x,
              y: rect.y,
              width,
              height,
            });
          }

          if (draftShape?.kind === "bubble") {
            void executeCommand("createBubble", {
              pageId: page.id,
              x: rect.x,
              y: rect.y,
              width,
              height,
              bubbleType: bubbleInsert.presetBubbleType,
              keepTool: true,
            });
          }

          setDraftShape(null);
        }}
      >
        <Layer>
          <Rect
            width={stageWidth}
            height={stageHeight}
            fill="rgba(0,0,0,0.001)"
            onMouseDown={handleCanvasDown}
            onContextMenu={handleCanvasContextMenu}
          />
          <Rect
            x={workspaceCanvasOrigin.x}
            y={workspaceCanvasOrigin.y}
            width={workspaceCanvasWidth}
            height={workspaceCanvasHeight}
            fill="#e9e0d3"
            listening={false}
          />

          <Group
            x={workspaceCanvasOrigin.x}
            y={workspaceCanvasOrigin.y}
            clipFunc={(ctx) => {
              ctx.beginPath();
              ctx.rect(0, 0, workspaceCanvasWidth, workspaceCanvasHeight);
              ctx.closePath();
            }}
          >
            {selectedImagePanel ? (
              <Rect
                x={0}
                y={0}
                width={workspaceCanvasWidth}
                height={workspaceCanvasHeight}
                fill="rgba(255,255,255,0.16)"
                listening={false}
              />
            ) : null}

            <Group x={contentCanvasOrigin.x} y={contentCanvasOrigin.y}>
              {Array.from({ length: maxGridX - minGridX + 1 }).map((_, index) => {
                const x = (minGridX + index) * gridStep;
                return (
                  <Line
                    key={`grid-v-${x}`}
                    points={[
                      x * scale,
                      workspace.y * scale,
                      x * scale,
                      (workspace.y + workspace.height) * scale,
                    ]}
                    stroke="#ddcfbf"
                    strokeWidth={1}
                    listening={false}
                  />
                );
              })}

              {Array.from({ length: maxGridY - minGridY + 1 }).map((_, index) => {
                const y = (minGridY + index) * gridStep;
                return (
                  <Line
                    key={`grid-h-${y}`}
                    points={[
                      workspace.x * scale,
                      y * scale,
                      (workspace.x + workspace.width) * scale,
                      y * scale,
                    ]}
                    stroke="#ddcfbf"
                    strokeWidth={1}
                    listening={false}
                  />
                );
              })}

              <Rect
                x={0}
                y={0}
                width={page.width * scale}
                height={page.height * scale}
                fill={page.background}
                stroke="#c7b6a3"
                strokeWidth={2}
                shadowColor="rgba(45,36,27,0.24)"
                shadowBlur={28}
                shadowOffset={{ x: 0, y: 14 }}
                shadowOpacity={0.7}
                listening={false}
              />

              {showVerticalGuide ? (
                <Line
                  points={[page.width * scale * 0.5, 0, page.width * scale * 0.5, page.height * scale]}
                  stroke="#7bb7c9"
                  dash={[10, 6]}
                  strokeWidth={2}
                  listening={false}
                />
              ) : null}
              {showHorizontalGuide ? (
                <Line
                  points={[0, page.height * scale * 0.5, page.width * scale, page.height * scale * 0.5]}
                  stroke="#7bb7c9"
                  dash={[10, 6]}
                  strokeWidth={2}
                  listening={false}
                />
              ) : null}
              {smartGuide ? (
                <>
                  <Line
                    points={[smartGuide.x * scale, 0, smartGuide.x * scale, page.height * scale]}
                    stroke="#00c8d7"
                    dash={[8, 6]}
                    strokeWidth={2}
                    listening={false}
                  />
                  <Line
                    points={[0, smartGuide.y * scale, page.width * scale, smartGuide.y * scale]}
                    stroke="#00c8d7"
                    dash={[8, 6]}
                    strokeWidth={2}
                    listening={false}
                  />
                </>
              ) : null}

              {nonTextLayers.map((entry) => {
                if (entry.objectType === "panel") {
                  return (
                    <PanelNode
                      key={entry.layer}
                      page={page}
                      panel={entry.object}
                      scale={scale}
                      selected={
                        selection?.pageId === page.id &&
                        selection.objectType === "panel" &&
                        selection.objectId === entry.object.id
                      }
                      highlighted={isObjectHighlighted("panel", entry.object.id)}
                      showImagePreview={selectedImagePanel?.id === entry.object.id}
                      onBoundaryPreviewChange={(preview) => setBoundaryOverlayPreview(preview)}
                      onOpenContextMenu={openContextMenu}
                    />
                  );
                }

                return (
                  <BubbleNode
                    key={entry.layer}
                    page={page}
                    bubble={entry.object}
                    scale={scale}
                    selected={
                      selection?.pageId === page.id &&
                      selection.objectType === "bubble" &&
                      selection.objectId === entry.object.id
                    }
                    highlighted={isObjectHighlighted("bubble", entry.object.id)}
                    onOpenContextMenu={openContextMenu}
                  />
                );
              })}
              {textLayers.map((entry) => (
                <TextNode
                  key={entry.layer}
                  page={page}
                  item={entry.object}
                  scale={scale}
                  selected={
                    selection?.pageId === page.id &&
                    selection.objectType === "text" &&
                    selection.objectId === entry.object.id
                  }
                  highlighted={isObjectHighlighted("text", entry.object.id)}
                  onBoundaryPreviewChange={(preview) => setBoundaryOverlayPreview(preview)}
                  onSmartGuideChange={setSmartGuide}
                  onOpenContextMenu={openContextMenu}
                />
              ))}

              {draftShape ? (
                <Rect
                  x={Math.min(draftShape.startX, draftShape.x) * scale}
                  y={Math.min(draftShape.startY, draftShape.y) * scale}
                  width={Math.abs(draftShape.width) * scale}
                  height={Math.abs(draftShape.height) * scale}
                  stroke="#c36d2f"
                  dash={[10, 8]}
                  strokeWidth={2}
                  fill={
                    draftShape.kind === "bubble"
                      ? "rgba(255,255,255,0.5)"
                      : "rgba(195,109,47,0.08)"
                  }
                />
              ) : null}
              {marqueeDrag ? (
                <Rect
                  x={Math.min(marqueeDrag.startX, marqueeDrag.x) * scale}
                  y={Math.min(marqueeDrag.startY, marqueeDrag.y) * scale}
                  width={Math.abs(marqueeDrag.x - marqueeDrag.startX) * scale}
                  height={Math.abs(marqueeDrag.y - marqueeDrag.startY) * scale}
                  stroke="#30b9d8"
                  dash={[8, 6]}
                  strokeWidth={2}
                  fill="rgba(48,185,216,0.12)"
                  listening={false}
                />
              ) : null}

              {isCustomBubbleInsertMode ? (
                <>
                  {customBubblePreview ? (
                    <Group
                      x={customBubblePreview.x * scale}
                      y={customBubblePreview.y * scale}
                      scaleX={scale}
                      scaleY={scale}
                      listening={false}
                    >
                      <Path
                        data={customBubblePreview.path}
                        fill="rgba(255,255,255,0.6)"
                        stroke="#c36d2f"
                        strokeWidth={2}
                        strokeScaleEnabled={false}
                      />
                    </Group>
                  ) : null}
                  {customBubbleHoverPreview ? (
                    <Group
                      x={customBubbleHoverPreview.x * scale}
                      y={customBubbleHoverPreview.y * scale}
                      scaleX={scale}
                      scaleY={scale}
                      listening={false}
                    >
                      <Path
                        data={customBubbleHoverPreview.path}
                        fillEnabled={false}
                        stroke="#c36d2f"
                        strokeWidth={2}
                        strokeScaleEnabled={false}
                        dash={[8, 6]}
                      />
                    </Group>
                  ) : null}
                  {customBubbleGuidePolyline.length >= 4 ? (
                    <Line
                      points={customBubbleGuidePolyline}
                      stroke="#8f5b2f"
                      strokeWidth={2}
                      dash={[6, 5]}
                      lineCap="round"
                      listening={false}
                    />
                  ) : null}
                  {customBubblePoints.map((point, index) => (
                    <Circle
                      key={`custom-bubble-point-${index}`}
                      x={point.x * scale}
                      y={point.y * scale}
                      radius={index === 0 ? 5 : 4}
                      fill={index === 0 ? "#ffe9d5" : "#ffffff"}
                      stroke="#c36d2f"
                      strokeWidth={2}
                      listening={false}
                    />
                  ))}
                  {customBubblePoints.length > 0 ? (
                    <Circle
                      x={customBubblePoints[0].x * scale}
                      y={customBubblePoints[0].y * scale}
                      radius={customBubbleHoverNearStart ? 13 : 9}
                      fill={customBubbleHoverNearStart ? "rgba(195,109,47,0.22)" : "rgba(195,109,47,0.08)"}
                      stroke="#c36d2f"
                      strokeWidth={1.5}
                      dash={customBubbleHoverNearStart ? [4, 3] : [2, 4]}
                      listening={false}
                    />
                  ) : null}
                  {customBubbleHoverNearStart && customBubblePoints.length > 0 ? (
                    <Text
                      x={(customBubblePoints[0].x + 12) * scale}
                      y={(customBubblePoints[0].y - 18) * scale}
                      text={t("canvas.customBubbleCloseHint")}
                      fontSize={12}
                      fill="#8f5b2f"
                      listening={false}
                    />
                  ) : null}
                </>
              ) : null}

              {showPageBoundaryOverlay ? (
                <Line
                  points={[
                    0,
                    0,
                    page.width * scale,
                    0,
                    page.width * scale,
                    page.height * scale,
                    0,
                    page.height * scale,
                  ]}
                  closed
                  stroke="#7bb7c9"
                  strokeWidth={3}
                  dash={[14, 10]}
                  fillEnabled={false}
                  listening={false}
                />
              ) : null}
            </Group>
          </Group>
          {isCustomBubbleInsertMode ? (
            <Rect
              width={stageWidth}
              height={stageHeight}
              fill="rgba(0,0,0,0.001)"
              onMouseDown={handleCanvasDown}
              onContextMenu={handleCanvasContextMenu}
            />
          ) : null}
          {isCustomBubbleInsertMode ? (
            <Text
              x={16}
              y={14}
              text={t("canvas.customBubbleDrawHint")}
              fontSize={13}
              fill="#6f4a2c"
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
      {contextMenu && contextMenuActions.length > 0 ? (
        <div ref={menuRef}>
          <CanvasContextMenu
            title={contextMenuTitle}
            actions={contextMenuActions}
            x={contextMenu.x}
            y={contextMenu.y}
          />
        </div>
      ) : null}
    </div>
  );
};
