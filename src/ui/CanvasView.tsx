import { useEffect, useRef, useState } from "react";
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
import { GRID_SIZE } from "../domain/defaults";
import {
  clampBubbleRectToWorkspace,
  getBubbleBasePoints,
  getDisplayedTextContent,
  getPageWorkspace,
  getPanelAbsolutePoints,
  getRenderableLayers,
  getSelectedObject,
  isPointInPolygon,
  panImageViewBox,
  snapValue,
  zoomImageViewBox,
} from "../domain/helpers";
import type { Bubble, Page, Panel, Point, Rect as PanelRect, TextItem } from "../domain/schema";
import { useI18n } from "../i18n/useI18n";
import { persistImportedImageForProject } from "../storage/projectFiles";
import { useEditorStore } from "../state/editorStore";
import { getBubbleBodyPath, getBubbleTailPath, getExplosionSpikePoints, getThoughtCircles } from "./bubbleShapes";

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

type BoundaryOverlayPreview =
  | {
      objectType: "panel" | "text";
      objectId: string;
      rect: { x: number; y: number; width: number; height: number };
    }
  | null;

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
}: {
  rect: { x: number; y: number; width: number; height: number };
  scale: number;
  color: string;
  onCommit: (handle: ResizeHandle, newRect: { x: number; y: number; width: number; height: number }) => void;
  onLiveChange?: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  mode?: "corners" | "corners-and-edges";
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
    
    const nextRect = computeScaledRect(dragStateRef.current.handleKey, pointer.x, pointer.y, initialRect);
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

    const nextRect = computeScaledRect(handleKey, pointer.x, pointer.y, initialRect);
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
  showImagePreview,
  onBoundaryPreviewChange,
  onOpenContextMenu,
}: {
  page: Page;
  panel: Panel;
  scale: number;
  selected: boolean;
  showImagePreview: boolean;
  onBoundaryPreviewChange: (preview: BoundaryOverlayPreview) => void;
  onOpenContextMenu: (
    event: KonvaEventObject<MouseEvent>,
    target: ContextMenuTarget,
  ) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const image = useImageElement(panel.image?.src);
  const { t } = useI18n();
  // Track if a drag operation is in progress to prevent click after drag
  const isDraggingRef = useRef(false);
  // Live points for real-time preview during vertex drag
  const [livePoints, setLivePoints] = useState<Point[] | null>(null);
  // Live rect for real-time preview during resize
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const displayPoints = livePoints ?? panel.points;
  const displayRect = liveRect ?? { x: panel.x, y: panel.y, width: panel.width, height: panel.height };
  const clipPoints = displayPoints.flatMap((point) => [point.x * scale, point.y * scale]);
  
  const handleSelect = (event: KonvaEventObject<MouseEvent>) => {
    // Don't select if this click is the end of a drag operation
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    event.cancelBubble = true;
    void executeCommand("selectObject", {
      pageId: page.id,
      objectType: "panel",
      objectId: panel.id,
    });
  };
  const handleContextMenu = (event: KonvaEventObject<MouseEvent>) => {
    // Always select panel on right-click (context menu should always show for the clicked panel)
    event.cancelBubble = true;
    void executeCommand("selectObject", {
      pageId: page.id,
      objectType: "panel",
      objectId: panel.id,
    });
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
          stroke={selected ? "#c36d2f" : panel.style.stroke}
          strokeWidth={selected ? 3 : panel.style.strokeWidth * 0.5}
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
  onBoundaryPreviewChange,
  onOpenContextMenu,
}: {
  page: Page;
  item: TextItem;
  scale: number;
  selected: boolean;
  onBoundaryPreviewChange: (preview: BoundaryOverlayPreview) => void;
  onOpenContextMenu: (
    event: KonvaEventObject<MouseEvent>,
    target: ContextMenuTarget,
  ) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const displayContent = getDisplayedTextContent(item);
  const handleSelect = (event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    void executeCommand("selectObject", {
      pageId: page.id,
      objectType: "text",
      objectId: item.id,
    });
  };

  return (
    <>
      <Group
        x={item.x * scale}
        y={item.y * scale}
        draggable={activeTool === "select"}
        onContextMenu={(event) => {
          handleSelect(event);
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
          onBoundaryPreviewChange({
            objectType: "text",
            objectId: item.id,
            rect: {
              x: event.target.x() / scale,
              y: event.target.y() / scale,
              width: item.width,
              height: item.height,
            },
          });
        }}
        onClick={handleSelect}
        onDragEnd={(event) => {
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
        <Text
          text={displayContent}
          fontSize={item.fontSize * scale}
          fontFamily={item.fontFamily}
          fill={item.color}
          width={item.width * scale}
          height={item.height * scale}
          align={item.textAlign}
          verticalAlign={item.verticalAlign}
          wrap={item.direction === "vertical" ? "char" : "word"}
          lineHeight={item.direction === "vertical" ? 1.1 : 1.35}
        />
      </Group>

      {selected ? (
        <>
          <Rect
            x={item.x * scale}
            y={item.y * scale}
            width={item.width * scale}
            height={item.height * scale}
            stroke="#c36d2f"
            dash={[10, 6]}
            strokeWidth={2}
            fillEnabled={false}
          />
          <ResizeHandles
            rect={item}
            scale={scale}
            color="#c36d2f"
            onCommit={(_, nextRect) => {
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
      ) : null}
    </>
  );
};

const BubbleNode = ({
  page,
  bubble,
  scale,
  selected,
  onOpenContextMenu,
}: {
  page: Page;
  bubble: Bubble;
  scale: number;
  selected: boolean;
  onOpenContextMenu: (
    event: KonvaEventObject<MouseEvent>,
    target: ContextMenuTarget,
  ) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const base = getBubbleBasePoints(bubble);

  // Live spike positions for real-time preview during drag
  const [liveSpikePositions, setLiveSpikePositions] = useState<Array<{x: number, y: number}> | null>(null);
  // Live rect for real-time resize preview
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Single spike edit mode: which spike is being edited individually
  const [editingSpikeIndex, setEditingSpikeIndex] = useState<number | null>(null);
  // Live spike depth for individual spike editing
  const [liveSpikeDepth, setLiveSpikeDepth] = useState<number | null>(null);
  
  const handleSelect = (event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
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
  const displayBubble = liveRect
    ? {
        ...bubble,
        ...liveRect,
        ...(previewSpikePositions.length > 0 ? { spikePositions: previewSpikePositions } : {}),
      }
    : bubble;

  const bodyPath = getBubbleBodyPath(displayBubble, liveSpikePositions);
  const tailPath = getBubbleTailPath(displayBubble);
  const thoughtCircles = displayBubble.bubbleType === "thought" ? getThoughtCircles(displayBubble) : [];
  const explosionSpikes = displayBubble.bubbleType === "explosion" ? getExplosionSpikePoints(displayBubble, liveSpikePositions) : [];
  // When strokeWidth is 0, don't render stroke at all
  const hasStroke = displayBubble.strokeWidth > 0;
  const strokeColor = selected ? "#c36d2f" : (hasStroke ? bubble.strokeColor : undefined);
  const padding = 24;

  return (
    <>
      <Group
        x={displayBubble.x * scale}
        y={displayBubble.y * scale}
        draggable={activeTool === "select" && !liveRect}
        onClick={handleSelect}
        onContextMenu={(event) => {
          handleSelect(event);
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
        {/* Bubble body */}
        <Path
          data-testid="bubble-body"
          data={bodyPath}
          fill={displayBubble.backgroundColor}
          stroke={strokeColor}
          strokeWidth={hasStroke ? displayBubble.strokeWidth : 0}
          scaleX={scale}
          scaleY={scale}
        />
        {/* Bubble tail - regular tail, thought circles, or explosion spikes (none for explosion) */}
        {displayBubble.bubbleType === "thought" ? (() => {
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
                key={`thought-circle-${i}`}
                x={cx}
                y={cy}
                radius={radius}
                fill={displayBubble.backgroundColor}
                stroke={strokeColor}
                strokeWidth={hasStroke ? displayBubble.strokeWidth : 0}
              />
            );
          }
          return circles;
        })() : displayBubble.bubbleType !== "explosion" ? (
          <Path
            data={tailPath}
            fill={displayBubble.backgroundColor}
            stroke={strokeColor}
            strokeWidth={hasStroke ? displayBubble.strokeWidth : 0}
            scaleX={scale}
            scaleY={scale}
          />
        ) : null}
        {/* Text */}
        <Text
          x={padding * scale}
          y={padding * scale}
          width={(displayBubble.width - padding * 2) * scale}
          height={(displayBubble.height - padding * 2) * scale}
          text={displayBubble.text}
          fontSize={displayBubble.fontSize * scale}
          fontFamily={displayBubble.fontFamily}
          fill="#111111"
          align={displayBubble.textAlign}
          verticalAlign={displayBubble.verticalAlign}
        />
      </Group>

      {selected ? (
        <>
          <Group data-testid="bubble-selected" />
          <ResizeHandles
            rect={displayBubble}
            scale={scale}
            color="#c36d2f"
            mode="corners-and-edges"
            onLiveChange={setLiveRect}
            onCommit={(_, nextRect) => {
              setLiveRect(null);
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
          ) : (
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
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  tailTip: {
                    x: finalX / scale,
                    y: finalY / scale,
                  },
                });
              }}
            />
          )}
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
}: {
  page: Page;
  onRequestImportImage: (pageId: string, panelId: string) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const projectId = useEditorStore((state) => state.project.id);
  const selection = useEditorStore((state) => state.selection);
  const activeTool = useEditorStore((state) => state.activeTool);
  const zoom = useEditorStore((state) => state.zoom);
  const [draftShape, setDraftShape] = useState<DraftShape>(null);
  const [boundaryOverlayPreview, setBoundaryOverlayPreview] = useState<BoundaryOverlayPreview>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
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

  const workspace = getPageWorkspace(page);
  const fitScale =
    viewport.width > 0 && viewport.height > 0
      ? Math.min(viewport.width / workspace.width, viewport.height / workspace.height, 1)
      : 1;
  const workspaceScale = fitScale;
  const scale = Math.max(0.1, fitScale * zoom);
  const stageWidth = Math.max(1, viewport.width);
  const stageHeight = Math.max(1, viewport.height);
  const workspaceCanvasWidth = workspace.width * workspaceScale;
  const workspaceCanvasHeight = workspace.height * workspaceScale;
  const workspaceCanvasOrigin = {
    x: (stageWidth - workspaceCanvasWidth) * 0.5,
    y: (stageHeight - workspaceCanvasHeight) * 0.5,
  };
  const contentCanvasOrigin = {
    x: workspaceCanvasWidth * 0.5 - (workspace.x + workspace.width * 0.5) * scale,
    y: workspaceCanvasHeight * 0.5 - (workspace.y + workspace.height * 0.5) * scale,
  };
  const pageCanvasOrigin = {
    x: workspaceCanvasOrigin.x + contentCanvasOrigin.x,
    y: workspaceCanvasOrigin.y + contentCanvasOrigin.y,
  };

  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
    };

    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) {
            continue;
          }
          const wrapperRect = wrapperRef.current?.getBoundingClientRect();
          if (!wrapperRect || !lastPointerRef.current) {
            continue;
          }
          
          const stageX = lastPointerRef.current.clientX - wrapperRect.left;
          const stageY = lastPointerRef.current.clientY - wrapperRect.top;
          
          const pageX = (stageX - pageCanvasOrigin.x) / scale;
          const pageY = (stageY - pageCanvasOrigin.y) / scale;
          const pointerPoint = { x: pageX, y: pageY };

          const targetPanel = [...page.panels].reverse().find((panel) => {
            const polygon = getPanelAbsolutePoints(panel);
            return isPointInPolygon(pointerPoint, polygon);
          });

          void (async () => {
            let src = URL.createObjectURL(file);
            try {
              src = await persistImportedImageForProject(projectId, file);
            } catch (error) {
              console.warn("Failed to persist pasted image; using session blob URL.", error);
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
            const newPanel = (await executeCommand("createPanel", {
              pageId: page.id,
              x: pointerPoint.x - 200,
              y: pointerPoint.y - 150,
              width: 400,
              height: 300,
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
          event.preventDefault();
          break;
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("paste", handlePaste);
    };
  }, [page, scale, pageCanvasOrigin, executeCommand, projectId]);

  const selectedObject = getSelectedObject(page, selection);
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
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    if (!wrapperRect) {
      return;
    }
    const x = Math.max(
      8,
      Math.min(event.evt.clientX - wrapperRect.left, wrapperRect.width - CONTEXT_MENU_WIDTH - 8),
    );
    const y = Math.max(8, Math.min(event.evt.clientY - wrapperRect.top, wrapperRect.height - 260));
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

  const handleCanvasDown = async (event: KonvaEventObject<MouseEvent>) => {
    closeContextMenu();
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
          if (!draftShape) {
            return;
          }
          const point = getPointFromEvent(event, scale, pageCanvasOrigin);
          if (!point) {
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
        onMouseUp={() => {
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

              {orderedLayers.map((entry) => {
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
                      showImagePreview={selectedImagePanel?.id === entry.object.id}
                      onBoundaryPreviewChange={(preview) => setBoundaryOverlayPreview(preview)}
                      onOpenContextMenu={openContextMenu}
                    />
                  );
                }

                if (entry.objectType === "text") {
                  return (
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
                    onOpenContextMenu={openContextMenu}
                  />
                );
              })}

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
