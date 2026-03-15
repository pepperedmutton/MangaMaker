import { useEffect, useRef, useState } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from "react-konva";
import { GRID_SIZE } from "../domain/defaults";
import {
  getBubbleBasePoints,
  getDisplayedTextContent,
  getPageWorkspace,
  getPageWorkspaceOffset,
  getRenderableLayers,
  getSelectedObject,
  panImageViewBox,
  snapValue,
  zoomImageViewBox,
} from "../domain/helpers";
import type { Bubble, Page, Panel, Rect as PanelRect, TextItem } from "../domain/schema";
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

type ResizeHandle = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const HANDLE_SIZE = 12;
const POINT_HANDLE_RADIUS = 7;

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
  workspaceOffset: { x: number; y: number },
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
    x: point.x / scale - workspaceOffset.x,
    y: point.y / scale - workspaceOffset.y,
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
          if (!dragState) {
            return;
          }
          const nextViewBox = panImageViewBox(
            panel,
            dragState.sourceWidth,
            dragState.sourceHeight,
            dragState.viewBox,
            (event.target.x() - dragState.renderX) / scale,
            (event.target.y() - dragState.renderY) / scale,
          );
          const nextMetrics = getPanelImageRenderMetrics(panel, scale, nextViewBox);
          if (!nextMetrics) {
            return;
          }
          setLiveViewBox(nextViewBox);
          event.target.position({ x: nextMetrics.renderX, y: nextMetrics.renderY });
        }}
        onMouseDown={(event) => {
          event.cancelBubble = true;
        }}
        onClick={(event) => {
          event.cancelBubble = true;
        }}
        onDragEnd={(event) => {
          event.cancelBubble = true;
          const dragState = dragStateRef.current;
          if (!dragState) {
            return;
          }
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
}: {
  page: Page;
  panel: Panel;
  scale: number;
  selected: boolean;
  showImagePreview: boolean;
  onBoundaryPreviewChange: (preview: BoundaryOverlayPreview) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const image = useImageElement(panel.image?.src);
  const { t } = useI18n();
  const clipPoints = panel.points.flatMap((point) => [point.x * scale, point.y * scale]);
  const handleSelect = (event: KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    void executeCommand("selectObject", {
      pageId: page.id,
      objectType: "panel",
      objectId: panel.id,
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
          ctx.moveTo(panel.points[0].x * scale, panel.points[0].y * scale);
          for (let index = 1; index < panel.points.length; index += 1) {
            ctx.lineTo(panel.points[index].x * scale, panel.points[index].y * scale);
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
        onMouseDown={handleSelect}
        onDragStart={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
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
          if (event.target !== event.currentTarget) {
            return;
          }
          onBoundaryPreviewChange({
            objectType: "panel",
            objectId: panel.id,
            rect: {
              x: event.target.x() / scale,
              y: event.target.y() / scale,
              width: panel.width,
              height: panel.height,
            },
          });
        }}
        onClick={handleSelect}
        onDblClick={handleSelect}
        onDragEnd={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          const nextRect = {
            x: event.target.x() / scale,
            y: event.target.y() / scale,
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
          }).finally(() => {
            onBoundaryPreviewChange(null);
          });
        }}
      >
        <Group
          clipFunc={(ctx) => {
            ctx.beginPath();
            ctx.moveTo(panel.points[0].x * scale, panel.points[0].y * scale);
            for (let index = 1; index < panel.points.length; index += 1) {
              ctx.lineTo(panel.points[index].x * scale, panel.points[index].y * scale);
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
            points={panel.points.flatMap((point) => [
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
          {panel.points.map((point, index) => (
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
              }}
              onDragEnd={(event) => {
                const absoluteX = snapValue(event.target.x() / scale);
                const absoluteY = snapValue(event.target.y() / scale);
                const nextPoints = panel.points.map((entry, pointIndex) =>
                  pointIndex === index
                    ? { x: absoluteX - panel.x, y: absoluteY - panel.y }
                    : entry,
                );
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
}: {
  page: Page;
  item: TextItem;
  scale: number;
  selected: boolean;
  onBoundaryPreviewChange: (preview: BoundaryOverlayPreview) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const displayContent = getDisplayedTextContent(item);

  return (
    <>
      <Group
        x={item.x * scale}
        y={item.y * scale}
        draggable={activeTool === "select"}
        onDragStart={() => {
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
        onClick={(event) => {
          event.cancelBubble = true;
          void executeCommand("selectObject", {
            pageId: page.id,
            objectType: "text",
            objectId: item.id,
          });
        }}
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

const BubbleNode = ({
  page,
  bubble,
  scale,
  selected,
}: {
  page: Page;
  bubble: Bubble;
  scale: number;
  selected: boolean;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const activeTool = useEditorStore((state) => state.activeTool);
  const base = getBubbleBasePoints(bubble);

  return (
    <>
      <Group
        x={bubble.x * scale}
        y={bubble.y * scale}
        draggable={activeTool === "select"}
        onClick={(event) => {
          event.cancelBubble = true;
          void executeCommand("selectObject", {
            pageId: page.id,
            objectType: "bubble",
            objectId: bubble.id,
          });
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
        <Rect
          width={bubble.width * scale}
          height={bubble.height * scale}
          fill="#ffffff"
          stroke={selected ? "#c36d2f" : "#111111"}
          strokeWidth={3}
          cornerRadius={26}
        />
        <Text
          x={24 * scale}
          y={20 * scale}
          width={(bubble.width - 48) * scale}
          text={bubble.text}
          fontSize={bubble.fontSize * scale}
          fill="#111111"
        />
      </Group>

      <Line
        points={[
          base.left.x * scale,
          base.left.y * scale,
          bubble.tailTip.x * scale,
          bubble.tailTip.y * scale,
          base.right.x * scale,
          base.right.y * scale,
        ]}
        fill="#ffffff"
        stroke={selected ? "#c36d2f" : "#111111"}
        strokeWidth={3}
        closed
        listening={false}
      />

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

export const CanvasView = ({ page }: { page: Page }) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const selection = useEditorStore((state) => state.selection);
  const activeTool = useEditorStore((state) => state.activeTool);
  const zoom = useEditorStore((state) => state.zoom);
  const [draftShape, setDraftShape] = useState<DraftShape>(null);
  const [boundaryOverlayPreview, setBoundaryOverlayPreview] = useState<BoundaryOverlayPreview>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

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

  const workspace = getPageWorkspace(page);
  const workspaceOffset = getPageWorkspaceOffset(page);
  const fitScale =
    viewport.width > 0 && viewport.height > 0
      ? Math.min(viewport.width / workspace.width, viewport.height / workspace.height, 1)
      : 1;
  const scale = Math.max(0.1, fitScale * zoom);

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

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
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
              (pointer.x / scale - workspaceOffset.x - selectedImagePanel.x) /
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
              (pointer.y / scale - workspaceOffset.y - selectedImagePanel.y) /
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
    const point = getPointFromEvent(event, scale, workspaceOffset);
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
    <div ref={wrapperRef} className="canvas-wrap">
      <Stage
        width={Math.max(1, workspace.width * scale)}
        height={Math.max(1, workspace.height * scale)}
        onWheel={handleWheel}
        onMouseMove={(event) => {
          if (!draftShape) {
            return;
          }
          const point = getPointFromEvent(event, scale, workspaceOffset);
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
            width={workspace.width * scale}
            height={workspace.height * scale}
            fill="#e9e0d3"
            onMouseDown={handleCanvasDown}
          />

          <Group x={workspaceOffset.x * scale} y={workspaceOffset.y * scale}>
            {selectedImagePanel ? (
              <Rect
                x={workspace.x * scale}
                y={workspace.y * scale}
                width={workspace.width * scale}
                height={workspace.height * scale}
                fill="rgba(255,255,255,0.16)"
                listening={false}
              />
            ) : null}

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
                fill={draftShape.kind === "bubble" ? "rgba(255,255,255,0.5)" : "rgba(195,109,47,0.08)"}
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
        </Layer>
      </Stage>
    </div>
  );
};
