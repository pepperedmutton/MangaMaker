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
  getBubbleBasePoints,
  getDisplayedTextContent,
  getPageWorkspace,
  getRenderableLayers,
  getSelectedObject,
  panImageViewBox,
  snapValue,
  zoomImageViewBox,
} from "../domain/helpers";
import type { Bubble, Page, Panel, Point, Rect as PanelRect, TextItem } from "../domain/schema";
import { useI18n } from "../i18n/useI18n";
import { useEditorStore } from "../state/editorStore";

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

type ResizeHandle = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const HANDLE_SIZE = 12;
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

const applyHandleToRect = (
  handle: ResizeHandle,
  rect: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
) => {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  if (handle === "top-left") {
    return { x: point.x, y: point.y, width: right - point.x, height: bottom - point.y };
  }
  if (handle === "top-right") {
    return { x: rect.x, y: point.y, width: point.x - rect.x, height: bottom - point.y };
  }
  if (handle === "bottom-left") {
    return { x: point.x, y: rect.y, width: right - point.x, height: point.y - rect.y };
  }
  return { x: rect.x, y: rect.y, width: point.x - rect.x, height: point.y - rect.y };
};

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
}: {
  rect: { x: number; y: number; width: number; height: number };
  scale: number;
  color: string;
  onCommit: (handle: ResizeHandle, point: { x: number; y: number }) => void;
}) => {
  const size = HANDLE_SIZE;
  const handles: Array<{ key: ResizeHandle; x: number; y: number }> = [
    { key: "top-left", x: rect.x, y: rect.y },
    { key: "top-right", x: rect.x + rect.width, y: rect.y },
    { key: "bottom-left", x: rect.x, y: rect.y + rect.height },
    { key: "bottom-right", x: rect.x + rect.width, y: rect.y + rect.height },
  ];

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
          strokeWidth={2}
          cornerRadius={4}
          draggable
          onMouseDown={(event) => {
            event.cancelBubble = true;
          }}
          onDragEnd={(event) => {
            onCommit(handle.key, {
              x: event.target.x() / scale + size / 2 / scale,
              y: event.target.y() / scale + size / 2 / scale,
            });
          }}
        />
      ))}
    </>
  );
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
  const displayPoints = livePoints ?? panel.points;
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
          strokeWidth={selected ? 3 : Math.max(1, panel.style.strokeWidth * 0.5)}
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
            onDragStart={() => {
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
              onBoundaryPreviewChange({
                objectType: "panel",
                objectId: panel.id,
                rect: {
                  x: panel.x + event.target.x() / scale,
                  y: panel.y + event.target.y() / scale,
                  width: panel.width,
                  height: panel.height,
                },
              });
            }}
            onDragEnd={(event) => {
              const deltaX = event.target.x() / scale;
              const deltaY = event.target.y() / scale;
              event.target.position({ x: 0, y: 0 });
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
          <ResizeHandles
            rect={panel}
            scale={scale}
            color="#c36d2f"
            onCommit={(handle, point) => {
              const nextRect = applyHandleToRect(handle, panel, point);
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
            onCommit={(handle, point) => {
              const nextRect = applyHandleToRect(handle, item, point);
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

// Generate bubble body path based on type
const getBubbleBodyPath = (width: number, height: number, type: Bubble["bubbleType"]): string => {
  const w = width;
  const h = height;
  
  switch (type) {
    case "round":
      // Rounded rectangle with tail notch at bottom
      const r = Math.min(26, w * 0.2, h * 0.2);
      return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
    
    case "ellipse":
      // Ellipse
      return `M ${w * 0.5} 0 A ${w * 0.5} ${h * 0.5} 0 1 1 ${w * 0.5} ${h} A ${w * 0.5} ${h * 0.5} 0 1 1 ${w * 0.5} 0 Z`;
    
    case "cloud":
      // Cloud shape with multiple bumps
      const bump = Math.min(w, h) * 0.15;
      return `M ${w * 0.2} ${h * 0.3} 
              Q ${w * 0.1} ${h * 0.1} ${w * 0.3} ${h * 0.15}
              Q ${w * 0.4} 0 ${w * 0.55} ${h * 0.1}
              Q ${w * 0.7} 0 ${w * 0.8} ${h * 0.15}
              Q ${w * 0.95} ${h * 0.1} ${w * 0.85} ${h * 0.35}
              Q ${w} ${h * 0.5} ${w * 0.85} ${h * 0.65}
              Q ${w * 0.9} ${h * 0.85} ${w * 0.7} ${h * 0.8}
              Q ${w * 0.2} ${h * 0.9} ${w * 0.15} ${h * 0.7}
              Q 0 ${h * 0.5} ${w * 0.15} ${h * 0.35}
              Q ${w * 0.05} ${h * 0.15} ${w * 0.2} ${h * 0.3} Z`;
    
    case "square":
      // Square
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
    
    case "roundedSquare":
      // Larger rounded corners
      const rr = Math.min(40, w * 0.25, h * 0.25);
      return `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 ${rr} Q 0 0 ${rr} 0 Z`;
    
    case "oval":
      // Tall oval
      return `M ${w * 0.5} 0 C ${w * 0.85} 0 ${w} ${h * 0.25} ${w} ${h * 0.5} C ${w} ${h * 0.75} ${w * 0.85} ${h} ${w * 0.5} ${h} C ${w * 0.15} ${h} 0 ${h * 0.75} 0 ${h * 0.5} C 0 ${h * 0.25} ${w * 0.15} 0 ${w * 0.5} 0 Z`;
    
    case "explosion":
      // Explosion/jagged shape
      const spikes = 8;
      let explosionPath = "";
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? Math.min(w, h) * 0.45 : Math.min(w, h) * 0.35;
        const x = w * 0.5 + Math.cos(angle) * radius;
        const y = h * 0.45 + Math.sin(angle) * radius;
        explosionPath += (i === 0 ? "M " : "L ") + `${x} ${y} `;
      }
      explosionPath += `Z`;
      return explosionPath;
    
    case "thought":
      // Thought bubble
      return `M ${w * 0.25} ${h * 0.2} Q ${w * 0.1} ${h * 0.15} ${w * 0.2} ${h * 0.05} Q ${w * 0.3} 0 ${w * 0.45} ${h * 0.08} Q ${w * 0.55} 0 ${w * 0.7} ${h * 0.05} Q ${w * 0.85} ${h * 0.1} ${w * 0.8} ${h * 0.25} Q ${w * 0.95} ${h * 0.35} ${w * 0.85} ${h * 0.5} Q ${w * 0.9} ${h * 0.7} ${w * 0.75} ${h * 0.75} Q ${w * 0.1} ${h * 0.7} ${w * 0.15} ${h * 0.5} Q ${w * 0.05} ${h * 0.35} ${w * 0.25} ${h * 0.2} Z`;
    
    case "jagged":
      // Jagged/sharp edges
      return `M ${w * 0.1} 0 L ${w * 0.25} ${h * 0.1} L ${w * 0.5} 0 L ${w * 0.75} ${h * 0.1} L ${w} 0 L ${w * 0.9} ${h * 0.3} L ${w} ${h * 0.5} L ${w * 0.9} ${h * 0.7} L ${w} ${h * 0.9} L ${w * 0.75} ${h * 0.8} L ${w * 0.25} ${h * 0.8} L 0 ${h * 0.9} L ${w * 0.1} ${h * 0.7} L 0 ${h * 0.5} L ${w * 0.1} ${h * 0.3} L 0 ${h * 0.1} Z`;
    
    case "bubbleRound":
      // Perfect circle
      const radius = Math.min(w, h) * 0.5;
      const cx = w * 0.5;
      const cy = h * 0.45;
      return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`;
    
    default:
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  }
};

// Generate tail path for bubble
const getBubbleTailPath = (bubble: Bubble, scale: number): string => {
  const w = bubble.width * scale;
  const h = bubble.height * scale;
  const base = getBubbleBasePoints(bubble);
  
  // tailTip and base are in absolute page coordinates. 
  // We need them relative to the bubble's top-left corner (bubble.x, bubble.y)
  const tailTipX = (bubble.tailTip.x - bubble.x) * scale;
  const tailTipY = (bubble.tailTip.y - bubble.y) * scale;
  const baseLeftX = (base.left.x - bubble.x) * scale;
  const baseLeftY = (base.left.y - bubble.y) * scale;
  const baseRightX = (base.right.x - bubble.x) * scale;
  const baseRightY = (base.right.y - bubble.y) * scale;
  
  // Calculate tail base position based on bubble type
  let tailBaseY = h;
  if (bubble.bubbleType === "ellipse" || bubble.bubbleType === "oval") {
    tailBaseY = h * 0.9;
  } else if (bubble.bubbleType === "cloud" || bubble.bubbleType === "thought") {
    tailBaseY = h * 0.85;
  } else if (bubble.bubbleType === "bubbleRound") {
    tailBaseY = h * 0.9;
  }
  
  return `M ${baseLeftX} ${Math.min(baseLeftY, tailBaseY)} L ${tailTipX} ${tailTipY} L ${baseRightX} ${Math.min(baseRightY, tailBaseY)} Z`;
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
  const handleSelect = (event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    void executeCommand("selectObject", {
      pageId: page.id,
      objectType: "bubble",
      objectId: bubble.id,
    });
  };

  const bodyPath = getBubbleBodyPath(bubble.width, bubble.height, bubble.bubbleType);
  const tailPath = getBubbleTailPath(bubble, 1);
  const strokeColor = selected ? "#c36d2f" : bubble.strokeColor;
  const padding = 24;

  return (
    <>
      <Group
        x={bubble.x * scale}
        y={bubble.y * scale}
        draggable={activeTool === "select"}
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
          data={bodyPath}
          fill={bubble.backgroundColor}
          stroke={strokeColor}
          strokeWidth={bubble.strokeWidth}
          scaleX={scale}
          scaleY={scale}
        />
        {/* Bubble tail - regular tail or thought circles */}
        {bubble.bubbleType === "thought" ? (() => {
          const tailTipX = (bubble.tailTip.x - bubble.x) * scale;
          const tailTipY = (bubble.tailTip.y - bubble.y) * scale;
          const tailBaseX = bubble.width * 0.5 * scale;
          const tailBaseY = bubble.height * 0.85 * scale; // Assuming thought clouds have base at ~0.85h
          
          const circles = [];
          const numCircles = bubble.thoughtCircles ?? 3;
          
          for (let i = 0; i < numCircles; i++) {
            const t = (i + 1) / (numCircles + 1); // Parameter along the line (0 to 1)
            const cx = tailBaseX + (tailTipX - tailBaseX) * t;
            const cy = tailBaseY + (tailTipY - tailBaseY) * t;
            // Radius gets smaller towards the tip
            const radius = Math.max(4 * scale, (15 - i * 3) * scale);
            
            circles.push(
              <Circle
                key={`thought-circle-${i}`}
                x={cx}
                y={cy}
                radius={radius}
                fill={bubble.backgroundColor}
                stroke={strokeColor}
                strokeWidth={bubble.strokeWidth}
              />
            );
          }
          return circles;
        })() : (
          <Path
            data={tailPath}
            fill={bubble.backgroundColor}
            stroke={strokeColor}
            strokeWidth={bubble.strokeWidth}
          />
        )}
        {/* Text */}
        <Text
          x={padding * scale}
          y={padding * scale}
          width={(bubble.width - padding * 2) * scale}
          height={(bubble.height - padding * 2) * scale}
          text={bubble.text}
          fontSize={bubble.fontSize * scale}
          fontFamily={bubble.fontFamily}
          fill="#111111"
          align={bubble.textAlign}
          verticalAlign={bubble.verticalAlign}
        />
      </Group>

      {selected ? (
        <>
          <ResizeHandles
            rect={bubble}
            scale={scale}
            color="#c36d2f"
            onCommit={(handle, point) => {
              const nextRect = applyHandleToRect(handle, bubble, point);
              void executeCommand("updateBubble", {
                pageId: page.id,
                bubbleId: bubble.id,
                x: nextRect.x,
                y: nextRect.y,
                width: nextRect.width,
                height: nextRect.height,
              });
            }}
          />
          <Circle
            x={bubble.tailTip.x * scale}
            y={bubble.tailTip.y * scale}
            radius={8}
            fill="#c36d2f"
            draggable
            onMouseDown={(event) => {
              event.cancelBubble = true;
            }}
            onDragEnd={(event) => {
              void executeCommand("updateBubble", {
                pageId: page.id,
                bubbleId: bubble.id,
                tailTip: {
                  x: event.target.x() / scale,
                  y: event.target.y() / scale,
                },
              });
            }}
          />
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

  const confirmDeleteObject = (objectType: "panel" | "text" | "bubble", objectId: string) => {
    if (!window.confirm(t("dialog.deleteObject"))) {
      return;
    }
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
