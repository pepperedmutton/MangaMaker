import { z } from "zod";
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from "polygon-clipping";
import { svgPathProperties } from "svg-path-properties";
import {
  createBlankProject,
  createDefaultBubble,
  createDefaultElement,
  createDefaultPage,
  createDefaultPanelStyle,
  createDefaultText,
  createId,
  clonePage,
  MAX_ZOOM,
  MIN_ZOOM,
} from "../domain/defaults";
import {
  clamp,
  clampBubbleRectToWorkspace,
  clampElementRectToWorkspace,
  clampBubbleTailBaseLocalPoint,
  clampPanelRectToWorkspace,
  clampPointToWorkspace,
  clampTextBoxToWorkspace,
  clampImageViewBox,
  createInitialPanelViewBox,
  fitViewBoxToPanelAspect,
  getBubbleTailBaseAngleFromLocalPoint,
  getPageWorkspace,
  getPageById,
  getBubbleTailBaseLocalPoint,
  insertPanelPoint,
  preservePanelImageViewBox,
  removePanelPoint,
  removeLayerRef,
  shiftBubbleTail,
  scaleBubbleLocalPoint,
  scalePanelPoints,
  snapValue,
  toLayerRef,
} from "../domain/helpers";
import {
  MANGAMAKER_CLIPBOARD_SIGNATURE,
  clipboardItemSchema,
  type ClipboardEnvelope,
} from "../domain/clipboard";
import {
  bubbleTypeSchema,
  objectRefSchema,
  objectTypeSchema,
  pointSchema,
  projectSchema,
  projectTypeSchema,
  type ObjectRef,
  type Project,
} from "../domain/schema";
import {
  renderPageToPngDataUrl,
  renderProjectToJpgZipDataUrl,
  renderProjectToPdfDataUrl,
} from "../export/render";
import {
  DEFAULT_LOCALE,
  getDefaultPageName,
  getDuplicatedPageName,
  localeSchema,
  persistLocale,
  translate,
  type Locale,
} from "../i18n";
import {
  deleteLocalProject,
  listLocalProjects,
  loadLocalDraft,
  saveLocalDraft,
} from "../storage/localDraft";
import { normalizeProjectForCurrentVersion } from "../storage/projectMigration";
import type {
  EditorMultiSelection,
  EditorSelection,
  EditorSelectionItem,
  HistoryEntry,
} from "../state/types";
import type { CommandDefinition } from "./types";
import {
  getBubbleBodyPath,
  getBubbleTailPath,
  getThoughtCircles,
} from "../ui/bubbleShapes";

const ensureProject = (project: unknown) => projectSchema.parse(project);

const touch = (project: Project): Project => ({
  ...project,
  updatedAt: new Date().toISOString(),
});

const sanitizeFileName = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";

const createStatus = (
  tone: "info" | "success" | "error",
  text: string,
) => ({
  tone,
  text,
});

const getLocale = (context: Parameters<CommandDefinition["execute"]>[0]): Locale =>
  context.getSession().locale ?? DEFAULT_LOCALE;

const createLocalizedStatus = (
  locale: Locale,
  tone: "info" | "success" | "error",
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
) => createStatus(tone, translate(locale, key, params));

const createContextStatus = (
  context: Parameters<CommandDefinition["execute"]>[0],
  tone: "info" | "success" | "error",
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
) => createLocalizedStatus(getLocale(context), tone, key, params);

const getToolLabel = (locale: Locale, tool: "select" | "panel" | "text" | "bubble" | "element") =>
  translate(locale, `toolbar.${tool}`);

const snapshotSession = (
  project: Project,
  selectedPageId: string | null,
  selection: EditorSelection,
  multiSelection: EditorMultiSelection | undefined,
  panelImageEditing: HistoryEntry["panelImageEditing"],
): HistoryEntry => ({
  project: structuredClone(project),
  selectedPageId,
  selection: selection ? { ...selection } : null,
  multiSelection: (multiSelection ?? []).map((entry) => ({ ...entry })),
  panelImageEditing: panelImageEditing ? { ...panelImageEditing } : null,
});

const selectionKey = (entry: Pick<EditorSelectionItem, "objectType" | "objectId">) =>
  `${entry.objectType}:${entry.objectId}`;

const uniqueSelections = (entries: EditorSelectionItem[]) => {
  const seen = new Set<string>();
  const deduped: EditorSelectionItem[] = [];
  for (const entry of entries) {
    const key = selectionKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
};

const isSelectionMember = (
  selection: EditorSelectionItem[],
  objectType: "panel" | "text" | "bubble" | "element",
  objectId: string,
) => selection.some((entry) => entry.objectType === objectType && entry.objectId === objectId);

const updatePage = (
  project: Project,
  pageId: string,
  updater: (page: Project["pages"][number]) => Project["pages"][number],
) => ({
  ...project,
  pages: project.pages.map((page) => (page.id === pageId ? updater(page) : page)),
});

const withPage = <T>(project: Project, pageId: string, selector: (page: Project["pages"][number]) => T) =>
  selector(getPageById(project, pageId));

const getPanel = (project: Project, pageId: string, panelId: string) => {
  const panel = getPageById(project, pageId).panels.find((entry) => entry.id === panelId);
  if (!panel) {
    throw new Error(`Panel not found: ${panelId}`);
  }
  return panel;
};

const getText = (project: Project, pageId: string, textId: string) => {
  const text = getPageById(project, pageId).texts.find((entry) => entry.id === textId);
  if (!text) {
    throw new Error(`Text not found: ${textId}`);
  }
  return text;
};

const readImageMetadata = async (
  src: string,
  fallbackWidth: number,
  fallbackHeight: number,
) => {
  if (typeof window === "undefined" || typeof window.Image === "undefined" || src.length === 0) {
    return {
      sourceWidth: fallbackWidth,
      sourceHeight: fallbackHeight,
    };
  }

  return new Promise<{ sourceWidth: number; sourceHeight: number }>((resolve) => {
    const image = new window.Image();
    image.onload = () =>
      resolve({
        sourceWidth: image.naturalWidth || fallbackWidth,
        sourceHeight: image.naturalHeight || fallbackHeight,
      });
    image.onerror = () =>
      resolve({
        sourceWidth: fallbackWidth,
        sourceHeight: fallbackHeight,
      });
    image.src = src;
  });
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const srcToDataUrl = async (src: string) => {
  if (src.startsWith("data:")) {
    return src;
  }
  const response = await fetch(src);
  const blob = await response.blob();
  return blobToDataUrl(blob);
};

const inlinePanelImageForClipboard = async (
  panel: Project["pages"][number]["panels"][number],
) => {
  if (!panel.image) {
    return panel;
  }
  try {
    const inlinedSrc = await srcToDataUrl(panel.image.src);
    return {
      ...panel,
      image: {
        ...panel.image,
        src: inlinedSrc,
      },
    };
  } catch (error) {
    console.warn("Failed to inline panel image for clipboard payload:", error);
    return panel;
  }
};

const inlinePageForClipboard = async (page: Project["pages"][number]) => {
  const panels = await Promise.all(page.panels.map((panel) => inlinePanelImageForClipboard(panel)));
  return {
    ...page,
    panels,
  };
};

const buildClipboardEnvelopeForSession = async (
  context: Parameters<CommandDefinition["execute"]>[0],
): Promise<ClipboardEnvelope | null> => {
  const session = context.getSession();
  const project = context.getProject();
  let item: ClipboardEnvelope["item"] | null = null;

  if (session.selection) {
    const selectionPage =
      project.pages.find((page) => page.id === session.selection?.pageId) ?? null;
    if (!selectionPage) {
      return null;
    }
    if (session.selection.objectType === "panel") {
      const panel =
        selectionPage.panels.find((entry) => entry.id === session.selection?.objectId) ?? null;
      item = panel ? { kind: "panel", panel: await inlinePanelImageForClipboard(panel) } : null;
    } else if (session.selection.objectType === "text") {
      const text =
        selectionPage.texts.find((entry) => entry.id === session.selection?.objectId) ?? null;
      item = text ? { kind: "text", text } : null;
    } else {
      const bubble =
        selectionPage.bubbles.find((entry) => entry.id === session.selection?.objectId) ?? null;
      item = bubble ? { kind: "bubble", bubble } : null;
    }
  } else {
    const page =
      (session.selectedPageId
        ? project.pages.find((entry) => entry.id === session.selectedPageId)
        : null) ??
      project.pages[0] ??
      null;
    item = page ? { kind: "page", page: await inlinePageForClipboard(page) } : null;
  }

  if (!item) {
    return null;
  }

  return {
    signature: MANGAMAKER_CLIPBOARD_SIGNATURE,
    copiedAt: new Date().toISOString(),
    sourceProjectId: project.id,
    item,
  };
};

const assertObjectExists = (
  project: Project,
  pageId: string,
  objectType: z.infer<typeof objectTypeSchema>,
  objectId: string,
) => {
  const page = getPageById(project, pageId);
  const exists =
    objectType === "panel"
      ? page.panels.some((item) => item.id === objectId)
      : objectType === "text"
        ? page.texts.some((item) => item.id === objectId)
        : objectType === "element"
          ? (page.elements ?? []).some((item) => item.id === objectId)
          : page.bubbles.some((item) => item.id === objectId);
  if (!exists) {
    throw new Error(`Object not found: ${objectType}:${objectId}`);
  }
};

type ObjectSelectionRef = z.infer<typeof objectRefSchema>;

const objectRefKey = (ref: ObjectSelectionRef) => `${ref.objectType}:${ref.objectId}`;

const getObjectRect = (
  page: Project["pages"][number],
  ref: ObjectSelectionRef,
) => {
  if (ref.objectType === "panel") {
    const panel = page.panels.find((entry) => entry.id === ref.objectId);
    return panel ? { x: panel.x, y: panel.y, width: panel.width, height: panel.height } : null;
  }
  if (ref.objectType === "text") {
    const text = page.texts.find((entry) => entry.id === ref.objectId);
    return text ? { x: text.x, y: text.y, width: text.width, height: text.height } : null;
  }
  if (ref.objectType === "element") {
    const element = (page.elements ?? []).find((entry) => entry.id === ref.objectId);
    return element ? { x: element.x, y: element.y, width: element.width, height: element.height } : null;
  }
  const bubble = page.bubbles.find((entry) => entry.id === ref.objectId);
  return bubble ? { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height } : null;
};

const dedupeObjectRefs = (refs: ObjectSelectionRef[]) => {
  const seen = new Set<string>();
  const deduped: ObjectSelectionRef[] = [];
  for (const ref of refs) {
    const key = objectRefKey(ref);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
};

const sanitizeGroupList = (
  page: Project["pages"][number],
  groups: Project["pages"][number]["groups"],
) => {
  const panelIds = new Set(page.panels.map((panel) => panel.id));
  const textIds = new Set(page.texts.map((text) => text.id));
  const bubbleIds = new Set(page.bubbles.map((bubble) => bubble.id));
  const elementIds = new Set((page.elements ?? []).map((element) => element.id));
  return groups
    .map((group) => {
      const members = dedupeObjectRefs(
        group.members.filter((member) => {
          if (member.objectType === "panel") {
            return panelIds.has(member.objectId);
          }
          if (member.objectType === "text") {
            return textIds.has(member.objectId);
          }
          if (member.objectType === "element") {
            return elementIds.has(member.objectId);
          }
          return bubbleIds.has(member.objectId);
        }),
      );
      if (members.length < 2) {
        return null;
      }
      return {
        ...group,
        members,
      };
    })
    .filter((group): group is Project["pages"][number]["groups"][number] => group !== null);
};

const getGroupForObject = (
  page: Project["pages"][number],
  objectType: "panel" | "text" | "bubble" | "element",
  objectId: string,
) =>
  page.groups.find((group) =>
    group.members.some((member) => member.objectType === objectType && member.objectId === objectId),
  ) ?? null;

const getMoveMembersForObject = (
  page: Project["pages"][number],
  objectType: "panel" | "text" | "bubble" | "element",
  objectId: string,
): ObjectSelectionRef[] => {
  const group = getGroupForObject(page, objectType, objectId);
  if (!group) {
    return [{ objectType, objectId }];
  }
  return dedupeObjectRefs(group.members.map((member) => ({ ...member })));
};

const clampGroupMoveDelta = (
  page: Project["pages"][number],
  members: ObjectSelectionRef[],
  requestedDeltaX: number,
  requestedDeltaY: number,
) => {
  const workspace = getPageWorkspace(page);
  let minAllowedDeltaX = Number.NEGATIVE_INFINITY;
  let maxAllowedDeltaX = Number.POSITIVE_INFINITY;
  let minAllowedDeltaY = Number.NEGATIVE_INFINITY;
  let maxAllowedDeltaY = Number.POSITIVE_INFINITY;

  for (const member of members) {
    const rect = getObjectRect(page, member);
    if (!rect) {
      continue;
    }
    minAllowedDeltaX = Math.max(minAllowedDeltaX, workspace.x - rect.x);
    maxAllowedDeltaX = Math.min(
      maxAllowedDeltaX,
      workspace.x + workspace.width - rect.width - rect.x,
    );
    minAllowedDeltaY = Math.max(minAllowedDeltaY, workspace.y - rect.y);
    maxAllowedDeltaY = Math.min(
      maxAllowedDeltaY,
      workspace.y + workspace.height - rect.height - rect.y,
    );
  }

  if (!Number.isFinite(minAllowedDeltaX) || !Number.isFinite(maxAllowedDeltaX)) {
    return { deltaX: 0, deltaY: 0 };
  }

  const deltaX = clamp(requestedDeltaX, minAllowedDeltaX, maxAllowedDeltaX);
  const deltaY = clamp(requestedDeltaY, minAllowedDeltaY, maxAllowedDeltaY);
  return {
    deltaX,
    deltaY,
  };
};

const applyMoveDeltaToPage = (
  page: Project["pages"][number],
  members: ObjectSelectionRef[],
  deltaX: number,
  deltaY: number,
) => {
  if (Math.abs(deltaX) < 0.0001 && Math.abs(deltaY) < 0.0001) {
    return page;
  }

  const memberKeys = new Set(members.map(objectRefKey));
  return {
    ...page,
    panels: page.panels.map((panel) =>
      memberKeys.has(`panel:${panel.id}`)
        ? {
            ...panel,
            x: panel.x + deltaX,
            y: panel.y + deltaY,
          }
        : panel,
    ),
    texts: page.texts.map((text) =>
      memberKeys.has(`text:${text.id}`)
        ? {
            ...text,
            x: text.x + deltaX,
            y: text.y + deltaY,
          }
        : text,
    ),
    bubbles: page.bubbles.map((bubble) =>
      memberKeys.has(`bubble:${bubble.id}`)
        ? shiftBubbleTail(
            {
              ...bubble,
              x: bubble.x + deltaX,
              y: bubble.y + deltaY,
            },
            deltaX,
            deltaY,
          )
        : bubble,
    ),
    elements: (page.elements ?? []).map((element) =>
      memberKeys.has(`element:${element.id}`)
        ? {
            ...element,
            x: element.x + deltaX,
            y: element.y + deltaY,
          }
        : element,
    ),
  };
};

const doRectsOverlapByArea = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) =>
  Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x) > 0 &&
  Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y) > 0;

type MergePoint = [number, number];
type BubbleEntity = Project["pages"][number]["bubbles"][number];
type BubbleCustomHandleProfile = {
  movableIndices: number[];
  lockedIndices: number[];
};

const MERGE_SAMPLE_STEP = 2;
const MERGE_MIN_SAMPLES = 72;
const MERGE_MAX_SAMPLES = 960;
const MERGE_POINT_EPSILON = 0.2;
const MERGE_MIN_AREA = 1;
const MERGE_MAX_CUSTOM_POINTS = 420;
const MERGE_DEFAULT_CUSTOM_SMOOTHNESS = 0.42;
const MERGE_INTERSECTION_ENDPOINT_COUNT = 2;
const MERGE_SEGMENT_EPSILON = 0.000001;
const MERGE_POINT_PRECISION = 1000;

const toMergePrecision = (value: number) =>
  Math.round(value * MERGE_POINT_PRECISION) / MERGE_POINT_PRECISION;

const toSquaredDistance = (left: MergePoint, right: MergePoint) => {
  const deltaX = left[0] - right[0];
  const deltaY = left[1] - right[1];
  return deltaX * deltaX + deltaY * deltaY;
};

const normalizeRing = (ring: MergePoint[]): MergePoint[] => {
  const cleaned: MergePoint[] = [];
  const epsilonSquared = MERGE_POINT_EPSILON * MERGE_POINT_EPSILON;
  for (const point of ring) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      continue;
    }
    const candidate: MergePoint = [point[0], point[1]];
    if (cleaned.length === 0) {
      cleaned.push(candidate);
      continue;
    }
    if (toSquaredDistance(cleaned[cleaned.length - 1], candidate) > epsilonSquared) {
      cleaned.push(candidate);
    }
  }
  if (cleaned.length >= 2 && toSquaredDistance(cleaned[0], cleaned[cleaned.length - 1]) <= epsilonSquared) {
    cleaned.pop();
  }
  return cleaned;
};

const getRingArea = (ring: MergePoint[]) => {
  if (ring.length < 3) {
    return 0;
  }
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea * 0.5;
};

const getMultiPolygonArea = (multiPolygon: MultiPolygon | null) => {
  if (!multiPolygon || multiPolygon.length === 0) {
    return 0;
  }
  let totalArea = 0;
  for (const polygon of multiPolygon) {
    if (polygon.length === 0) {
      continue;
    }
    const outerArea = Math.abs(getRingArea(normalizeRing(polygon[0] as MergePoint[])));
    const holeArea = polygon
      .slice(1)
      .reduce((sum, hole) => sum + Math.abs(getRingArea(normalizeRing(hole as MergePoint[]))), 0);
    totalArea += Math.max(0, outerArea - holeArea);
  }
  return totalArea;
};

const sampleClosedPathRing = (pathData: string): MergePoint[] => {
  try {
    const properties = new svgPathProperties(pathData);
    const totalLength = properties.getTotalLength();
    if (!Number.isFinite(totalLength) || totalLength <= 0.001) {
      return [];
    }
    const sampleCount = Math.round(
      clamp(Math.ceil(totalLength / MERGE_SAMPLE_STEP), MERGE_MIN_SAMPLES, MERGE_MAX_SAMPLES),
    );
    const positions = new Set<number>();
    for (let index = 0; index < sampleCount; index += 1) {
      positions.add((index / sampleCount) * totalLength);
    }
    let cursor = 0;
    for (const part of properties.getParts()) {
      positions.add(cursor);
      cursor += part.length;
      positions.add(cursor);
    }
    const orderedPositions = [...positions]
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= totalLength)
      .sort((left, right) => left - right);
    const sampledPoints = orderedPositions.map((distance) => {
      const point = properties.getPointAtLength(distance);
      return [point.x, point.y] as MergePoint;
    });
    return normalizeRing(sampledPoints);
  } catch {
    return [];
  }
};

const translateRing = (ring: MergePoint[], deltaX: number, deltaY: number) =>
  ring.map((point) => [point[0] + deltaX, point[1] + deltaY] as MergePoint);

const createCircleRing = (
  centerX: number,
  centerY: number,
  radius: number,
  segmentCount = 36,
) => {
  const points: MergePoint[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const angle = (index / segmentCount) * Math.PI * 2;
    points.push([
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius,
    ]);
  }
  return normalizeRing(points);
};

const ringToPolygon = (ring: MergePoint[]): Polygon | null => {
  const normalized = normalizeRing(ring);
  if (normalized.length < 3) {
    return null;
  }
  if (Math.abs(getRingArea(normalized)) <= MERGE_MIN_AREA) {
    return null;
  }
  return [normalized as Ring];
};

const unionPolygons = (polygons: Polygon[]): MultiPolygon | null => {
  if (polygons.length === 0) {
    return null;
  }
  if (polygons.length === 1) {
    return [polygons[0]];
  }
  try {
    const result = polygonClipping.union(polygons[0], ...polygons.slice(1));
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
};

const limitRingPointCount = (ring: MergePoint[], maxPoints: number): MergePoint[] => {
  const normalized = normalizeRing(ring);
  if (normalized.length <= maxPoints) {
    return normalized;
  }
  if (maxPoints <= 2) {
    return normalized.slice(0, maxPoints);
  }
  const closed = [...normalized, normalized[0]];
  const cumulativeLengths: number[] = [0];
  for (let index = 1; index < closed.length; index += 1) {
    const previous = closed[index - 1];
    const current = closed[index];
    const segmentLength = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    cumulativeLengths.push(cumulativeLengths[index - 1] + segmentLength);
  }
  const perimeter = cumulativeLengths[cumulativeLengths.length - 1];
  if (!Number.isFinite(perimeter) || perimeter <= MERGE_POINT_EPSILON) {
    return normalized.slice(0, maxPoints);
  }

  const resampled: MergePoint[] = [];
  const stepLength = perimeter / maxPoints;
  let segmentIndex = 1;
  for (let sampleIndex = 0; sampleIndex < maxPoints; sampleIndex += 1) {
    const targetDistance = sampleIndex * stepLength;
    while (
      segmentIndex < cumulativeLengths.length - 1 &&
      cumulativeLengths[segmentIndex] < targetDistance
    ) {
      segmentIndex += 1;
    }
    const segmentStartDistance = cumulativeLengths[segmentIndex - 1];
    const segmentEndDistance = cumulativeLengths[segmentIndex];
    const segmentLength = Math.max(
      MERGE_POINT_EPSILON,
      segmentEndDistance - segmentStartDistance,
    );
    const ratio = clamp(
      (targetDistance - segmentStartDistance) / segmentLength,
      0,
      1,
    );
    const start = closed[segmentIndex - 1];
    const end = closed[segmentIndex];
    resampled.push([
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
    ]);
  }
  return normalizeRing(resampled);
};

const getLargestOuterRing = (multiPolygon: MultiPolygon | null): MergePoint[] | null => {
  if (!multiPolygon || multiPolygon.length === 0) {
    return null;
  }
  let largestRing: MergePoint[] | null = null;
  let largestArea = 0;
  for (const polygon of multiPolygon) {
    if (polygon.length === 0) {
      continue;
    }
    const outerRing = normalizeRing(polygon[0] as MergePoint[]);
    const area = Math.abs(getRingArea(outerRing));
    if (area > largestArea) {
      largestArea = area;
      largestRing = outerRing;
    }
  }
  return largestRing;
};

const sanitizeBubbleCustomHandleProfile = (
  profile: BubbleCustomHandleProfile | undefined,
  pointCount: number,
): BubbleCustomHandleProfile | undefined => {
  if (!profile || pointCount <= 0) {
    return undefined;
  }
  const normalizeIndices = (indices: number[]) => {
    const seen = new Set<number>();
    const normalized: number[] = [];
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= pointCount) {
        continue;
      }
      if (seen.has(index)) {
        continue;
      }
      seen.add(index);
      normalized.push(index);
    }
    return normalized;
  };
  const movableIndices = normalizeIndices(profile.movableIndices);
  const lockedIndices = normalizeIndices(profile.lockedIndices)
    .filter((index) => !movableIndices.includes(index));
  if (movableIndices.length === 0 && lockedIndices.length === 0) {
    return undefined;
  }
  return {
    movableIndices,
    lockedIndices,
  };
};

const resolveCustomPointSmoothness = (
  pointCount: number,
  fallbackSmoothness: number,
  source?: number[],
) => {
  if (pointCount <= 0) {
    return [];
  }
  if (!source || source.length === 0) {
    return Array.from({ length: pointCount }, () => clamp(fallbackSmoothness, 0, 1));
  }
  const fallbackValue = clamp(
    source[source.length - 1] ?? fallbackSmoothness,
    0,
    1,
  );
  return Array.from({ length: pointCount }, (_, index) =>
    clamp(source[index] ?? fallbackValue, 0, 1),
  );
};

const getSegmentIntersectionPoint = (
  aStart: MergePoint,
  aEnd: MergePoint,
  bStart: MergePoint,
  bEnd: MergePoint,
): MergePoint | null => {
  const denominator =
    (aEnd[0] - aStart[0]) * (bEnd[1] - bStart[1]) -
    (aEnd[1] - aStart[1]) * (bEnd[0] - bStart[0]);
  if (Math.abs(denominator) <= MERGE_SEGMENT_EPSILON) {
    return null;
  }
  const ua =
    ((bEnd[0] - bStart[0]) * (aStart[1] - bStart[1]) -
      (bEnd[1] - bStart[1]) * (aStart[0] - bStart[0])) /
    denominator;
  const ub =
    ((aEnd[0] - aStart[0]) * (aStart[1] - bStart[1]) -
      (aEnd[1] - aStart[1]) * (aStart[0] - bStart[0])) /
    denominator;
  const withinRange = (value: number) =>
    value >= -MERGE_SEGMENT_EPSILON && value <= 1 + MERGE_SEGMENT_EPSILON;
  if (!withinRange(ua) || !withinRange(ub)) {
    return null;
  }
  return [
    aStart[0] + ua * (aEnd[0] - aStart[0]),
    aStart[1] + ua * (aEnd[1] - aStart[1]),
  ];
};

const dedupeMergePoints = (points: MergePoint[], epsilon = 0.6) => {
  const epsilonSquared = epsilon * epsilon;
  const deduped: MergePoint[] = [];
  for (const point of points) {
    const isDuplicate = deduped.some(
      (existing) => toSquaredDistance(existing, point) <= epsilonSquared,
    );
    if (!isDuplicate) {
      deduped.push(point);
    }
  }
  return deduped;
};

const getRingIntersectionPoints = (left: MergePoint[], right: MergePoint[]) => {
  if (left.length < 2 || right.length < 2) {
    return [];
  }
  const intersections: MergePoint[] = [];
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex];
    const leftEnd = left[(leftIndex + 1) % left.length];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightStart = right[rightIndex];
      const rightEnd = right[(rightIndex + 1) % right.length];
      const intersection = getSegmentIntersectionPoint(
        leftStart,
        leftEnd,
        rightStart,
        rightEnd,
      );
      if (intersection) {
        intersections.push(intersection);
      }
    }
  }
  return dedupeMergePoints(intersections);
};

const pickFarthestPointPair = (points: MergePoint[]) => {
  if (points.length <= 2) {
    return points;
  }
  let bestPair: [MergePoint, MergePoint] = [points[0], points[1]];
  let bestDistance = -1;
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const distance = toSquaredDistance(points[leftIndex], points[rightIndex]);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestPair = [points[leftIndex], points[rightIndex]];
      }
    }
  }
  return bestPair;
};

const findNearestRingIndex = (
  ring: MergePoint[],
  target: MergePoint,
  excludedIndices?: Set<number>,
) => {
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    if (excludedIndices?.has(index)) {
      continue;
    }
    const distance = toSquaredDistance(ring[index], target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
};

const dedupeNumberList = (values: number[]) => {
  const seen = new Set<number>();
  const deduped: number[] = [];
  for (const value of values) {
    if (!Number.isInteger(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
};

const mapPointsToRingIndices = (ring: MergePoint[], points: MergePoint[]) => {
  if (ring.length === 0 || points.length === 0) {
    return [];
  }
  const mapped: number[] = [];
  for (const point of points) {
    const nearestIndex = findNearestRingIndex(ring, point);
    if (nearestIndex >= 0) {
      mapped.push(nearestIndex);
    }
  }
  return dedupeNumberList(mapped).sort((left, right) => left - right);
};

const buildBubbleFillRingsInWorld = (bubble: BubbleEntity): MergePoint[][] => {
  const rings: MergePoint[][] = [];

  const bodyRing = sampleClosedPathRing(getBubbleBodyPath(bubble));
  if (bodyRing.length >= 3) {
    rings.push(translateRing(bodyRing, bubble.x, bubble.y));
  }

  const shouldShowTail = bubble.showTail && bubble.bubbleType !== "explosion";
  const shouldRenderRegularTail = shouldShowTail && bubble.bubbleType !== "thought";
  const shouldRenderThoughtTail = shouldShowTail && bubble.bubbleType === "thought";

  if (shouldRenderRegularTail) {
    const tailRing = sampleClosedPathRing(getBubbleTailPath(bubble));
    if (tailRing.length >= 3) {
      rings.push(translateRing(tailRing, bubble.x, bubble.y));
    }
  }

  if (shouldRenderThoughtTail) {
    for (const circle of getThoughtCircles(bubble)) {
      const circleRing = createCircleRing(
        bubble.x + circle.cx,
        bubble.y + circle.cy,
        circle.r,
      );
      if (circleRing.length >= 3) {
        rings.push(circleRing);
      }
    }
  }

  return rings;
};

type BubbleMergeGeometry = {
  fillMultiPolygon: MultiPolygon | null;
};

const createBubbleMergeGeometry = (bubble: BubbleEntity): BubbleMergeGeometry => {
  const rings = buildBubbleFillRingsInWorld(bubble);
  const polygons = rings
    .map((ring) => ringToPolygon(ring))
    .filter((polygon): polygon is Polygon => polygon !== null);
  return {
    fillMultiPolygon: unionPolygons(polygons),
  };
};

const doMergeGeometriesOverlap = (
  left: MultiPolygon | null,
  right: MultiPolygon | null,
) => {
  if (!left || !right) {
    return false;
  }
  try {
    const overlapGeometry = polygonClipping.intersection(left, right);
    return getMultiPolygonArea(overlapGeometry) > MERGE_MIN_AREA;
  } catch {
    return false;
  }
};

const getBubbleBodyRingInWorld = (bubble: BubbleEntity) => {
  const bodyRing = sampleClosedPathRing(getBubbleBodyPath(bubble));
  if (bodyRing.length < 3) {
    return null;
  }
  return translateRing(bodyRing, bubble.x, bubble.y);
};

const getBubbleEndpointCandidates = (
  bubble: BubbleEntity,
) => {
  if (bubble.bubbleType !== "custom" || bubble.customPoints.length === 0) {
    return [];
  }
  return bubble.customPoints.map((point) => [bubble.x + point.x, bubble.y + point.y] as MergePoint);
};

const collectComponentIntersectionPoints = (
  componentBubbles: BubbleEntity[],
): MergePoint[] => {
  const intersectionPoints: MergePoint[] = [];
  for (let sourceIndex = 0; sourceIndex < componentBubbles.length; sourceIndex += 1) {
    const sourceBubble = componentBubbles[sourceIndex];
    for (
      let targetIndex = sourceIndex + 1;
      targetIndex < componentBubbles.length;
      targetIndex += 1
    ) {
      const targetBubble = componentBubbles[targetIndex];
      const sourceRing = getBubbleBodyRingInWorld(sourceBubble);
      const targetRing = getBubbleBodyRingInWorld(targetBubble);
      if (!sourceRing || !targetRing) {
        continue;
      }
      intersectionPoints.push(...getRingIntersectionPoints(sourceRing, targetRing));
    }
  }
  return dedupeMergePoints(intersectionPoints);
};

const createMergedBubbleHandleProfile = (
  componentBubbles: BubbleEntity[],
  mergedRing: MergePoint[],
): BubbleCustomHandleProfile | undefined => {
  if (mergedRing.length === 0) {
    return undefined;
  }
  const originalEndpointPoints = componentBubbles.flatMap((bubble) =>
    getBubbleEndpointCandidates(bubble),
  );
  const intersectionCandidates = collectComponentIntersectionPoints(componentBubbles);
  const intersectionEndpoints =
    intersectionCandidates.length > MERGE_INTERSECTION_ENDPOINT_COUNT
      ? pickFarthestPointPair(intersectionCandidates)
      : intersectionCandidates;
  let movableIndices = dedupeNumberList([
    ...mapPointsToRingIndices(mergedRing, originalEndpointPoints),
    ...mapPointsToRingIndices(mergedRing, intersectionEndpoints),
  ]).sort((left, right) => left - right);
  if (movableIndices.length === 0 && mergedRing.length > 0) {
    // Fallback: ensure at least one opposite control pair remains draggable after merge.
    movableIndices = dedupeNumberList([0, Math.floor(mergedRing.length * 0.5)]);
  }
  return sanitizeBubbleCustomHandleProfile(
    {
      movableIndices,
      lockedIndices: [],
    },
    mergedRing.length,
  );
};

const createMergedBubbleFromComponent = (
  page: Project["pages"][number],
  bubbles: Project["pages"][number]["bubbles"],
  geometryByBubbleId: Map<string, BubbleMergeGeometry>,
) => {
  if (bubbles.length === 0) {
    return null;
  }
  const prototype = bubbles[0];
  const componentGeometries = bubbles
    .map((bubble) => geometryByBubbleId.get(bubble.id)?.fillMultiPolygon)
    .filter((geometry): geometry is MultiPolygon => geometry !== null);
  if (componentGeometries.length === 0) {
    return null;
  }

  let mergedGeometry: MultiPolygon | null;
  if (componentGeometries.length === 1) {
    mergedGeometry = componentGeometries[0];
  } else {
    try {
      mergedGeometry = polygonClipping.union(
        componentGeometries[0],
        ...componentGeometries.slice(1),
      );
    } catch {
      mergedGeometry = null;
    }
  }
  if (!mergedGeometry || getMultiPolygonArea(mergedGeometry) <= MERGE_MIN_AREA) {
    return null;
  }

  const mergedOuterRing = getLargestOuterRing(mergedGeometry);
  if (!mergedOuterRing || mergedOuterRing.length < 3) {
    return null;
  }
  const simplifiedOuterRing = limitRingPointCount(mergedOuterRing, MERGE_MAX_CUSTOM_POINTS);
  if (simplifiedOuterRing.length < 3) {
    return null;
  }
  const customHandleProfile = createMergedBubbleHandleProfile(
    bubbles,
    simplifiedOuterRing,
  );

  const minX = Math.min(...simplifiedOuterRing.map((point) => point[0]));
  const minY = Math.min(...simplifiedOuterRing.map((point) => point[1]));
  const maxX = Math.max(...simplifiedOuterRing.map((point) => point[0]));
  const maxY = Math.max(...simplifiedOuterRing.map((point) => point[1]));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const customPoints = simplifiedOuterRing.map((point) => ({
    x: toMergePrecision(clamp(point[0] - minX, 0, width)),
    y: toMergePrecision(clamp(point[1] - minY, 0, height)),
  }));

  const defaultTailTip = clampPointToWorkspace(page, {
    x: minX + width * 0.5,
    y: minY + height + 60,
  });
  const mergedCustomSmoothness =
    prototype.bubbleType === "custom"
      ? clamp(prototype.customSmoothness, 0.25, 1)
      : MERGE_DEFAULT_CUSTOM_SMOOTHNESS;
  const mergedPointSmoothness = resolveCustomPointSmoothness(
    customPoints.length,
    mergedCustomSmoothness,
    prototype.customPointSmoothness,
  );
  return {
    id: createId("bubble"),
    ...createDefaultBubble({
      x: minX,
      y: minY,
      width,
      height,
      contentCenter: {
        x: width * 0.5,
        y: height * 0.5,
      },
      showTail: false,
      tailTip: defaultTailTip,
      tailBaseAngle: prototype.tailBaseAngle,
      tailWidth: prototype.tailWidth,
      bubbleType: "custom",
      strokeWidth: prototype.strokeWidth,
      backgroundColor: prototype.backgroundColor,
      strokeColor: prototype.strokeColor,
      opacity: prototype.opacity,
      cornerRadius: prototype.cornerRadius,
      bumpiness: prototype.bumpiness,
      spikeCount: prototype.spikeCount,
      spikeDepth: prototype.spikeDepth,
      spikeDepths: [...(prototype.spikeDepths ?? [])],
      spikePositions: [],
      activeSpikeIndex: -1,
      jaggedness: prototype.jaggedness,
      thoughtCircles: prototype.thoughtCircles,
      customPoints,
      customSmoothness: mergedCustomSmoothness,
      customPointSmoothness: mergedPointSmoothness,
      ...(customHandleProfile ? { customHandleProfile } : {}),
    }),
  };
};

const mergeOverlappingSelectedBubbles = (
  page: Project["pages"][number],
  members: ObjectSelectionRef[],
) => {
  const selectedBubbleIds = dedupeObjectRefs(
    members.filter((member) => member.objectType === "bubble"),
  )
    .map((member) => member.objectId)
    .filter((bubbleId) => page.bubbles.some((bubble) => bubble.id === bubbleId));
  if (selectedBubbleIds.length < 2) {
    return {
      page,
      replacements: new Map<string, string>(),
    };
  }

  const bubbleById = new Map(page.bubbles.map((bubble) => [bubble.id, bubble]));
  const geometryByBubbleId = new Map<string, BubbleMergeGeometry>();
  for (const bubbleId of selectedBubbleIds) {
    const bubble = bubbleById.get(bubbleId);
    if (!bubble) {
      continue;
    }
    geometryByBubbleId.set(bubbleId, createBubbleMergeGeometry(bubble));
  }
  const neighborMap = new Map<string, string[]>();
  for (const bubbleId of selectedBubbleIds) {
    neighborMap.set(bubbleId, []);
  }
  for (let index = 0; index < selectedBubbleIds.length; index += 1) {
    const sourceId = selectedBubbleIds[index];
    const source = bubbleById.get(sourceId);
    if (!source) {
      continue;
    }
    const sourceRect = {
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
    };
    for (let nextIndex = index + 1; nextIndex < selectedBubbleIds.length; nextIndex += 1) {
      const targetId = selectedBubbleIds[nextIndex];
      const target = bubbleById.get(targetId);
      if (!target) {
        continue;
      }
      const targetRect = {
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
      };
      if (!doRectsOverlapByArea(sourceRect, targetRect)) {
        continue;
      }
      const sourceGeometry = geometryByBubbleId.get(sourceId)?.fillMultiPolygon ?? null;
      const targetGeometry = geometryByBubbleId.get(targetId)?.fillMultiPolygon ?? null;
      if (!doMergeGeometriesOverlap(sourceGeometry, targetGeometry)) {
        continue;
      }
      neighborMap.get(sourceId)?.push(targetId);
      neighborMap.get(targetId)?.push(sourceId);
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const bubbleId of selectedBubbleIds) {
    if (visited.has(bubbleId)) {
      continue;
    }
    const stack = [bubbleId];
    visited.add(bubbleId);
    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      component.push(current);
      for (const neighbor of neighborMap.get(current) ?? []) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    components.push(component);
  }

  const mergeComponents = components.filter((component) => component.length >= 2);
  if (mergeComponents.length === 0) {
    return {
      page,
      replacements: new Map<string, string>(),
    };
  }

  const mergedBubbles: Project["pages"][number]["bubbles"] = [];
  const effectiveMergeComponents: string[][] = [];
  for (const component of mergeComponents) {
    const componentBubbles = component
      .map((bubbleId) => bubbleById.get(bubbleId))
      .filter((bubble): bubble is Project["pages"][number]["bubbles"][number] => bubble !== undefined);
    const mergedBubble = createMergedBubbleFromComponent(
      page,
      componentBubbles,
      geometryByBubbleId,
    );
    if (!mergedBubble) {
      continue;
    }
    effectiveMergeComponents.push(component);
    mergedBubbles.push(mergedBubble);
  }
  if (effectiveMergeComponents.length === 0) {
    return {
      page,
      replacements: new Map<string, string>(),
    };
  }

  const componentByBubbleId = new Map<string, number>();
  effectiveMergeComponents.forEach((component, componentIndex) => {
    component.forEach((bubbleId) => {
      componentByBubbleId.set(bubbleId, componentIndex);
    });
  });
  const mergedLayerRefs = mergedBubbles.map((bubble) => toLayerRef("bubble", bubble.id));
  const insertedComponents = new Set<number>();
  const nextLayers: string[] = [];
  for (const layer of page.layers) {
    if (!layer.startsWith("bubble:")) {
      nextLayers.push(layer);
      continue;
    }
    const bubbleId = layer.slice("bubble:".length);
    const componentIndex = componentByBubbleId.get(bubbleId);
    if (componentIndex === undefined) {
      nextLayers.push(layer);
      continue;
    }
    if (!insertedComponents.has(componentIndex)) {
      nextLayers.push(mergedLayerRefs[componentIndex]);
      insertedComponents.add(componentIndex);
    }
  }
  mergedLayerRefs.forEach((layerRef, componentIndex) => {
    if (!insertedComponents.has(componentIndex)) {
      nextLayers.push(layerRef);
    }
  });

  const removedIds = new Set(componentByBubbleId.keys());
  const nextBubbles = [
    ...page.bubbles.filter((bubble) => !removedIds.has(bubble.id)),
    ...mergedBubbles,
  ];
  const replacements = new Map<string, string>();
  effectiveMergeComponents.forEach((component, componentIndex) => {
    const mergedBubbleId = mergedBubbles[componentIndex]?.id;
    if (!mergedBubbleId) {
      return;
    }
    component.forEach((bubbleId) => {
      replacements.set(bubbleId, mergedBubbleId);
    });
  });

  const mergedPage = {
    ...page,
    bubbles: nextBubbles,
    layers: nextLayers,
  };
  return {
    page: {
      ...mergedPage,
      groups: sanitizeGroupList(mergedPage, mergedPage.groups),
    },
    replacements,
  };
};

const moveLayerByDirection = (
  layers: string[],
  layerRef: string,
  direction: "up" | "down",
) => {
  const fromIndex = layers.indexOf(layerRef);
  if (fromIndex < 0) {
    return null;
  }
  const toIndex =
    direction === "up"
      ? Math.min(layers.length - 1, fromIndex + 1)
      : Math.max(0, fromIndex - 1);
  if (toIndex === fromIndex) {
    return {
      layers: [...layers],
      fromIndex,
      toIndex,
    };
  }
  const nextLayers = [...layers];
  const [moved] = nextLayers.splice(fromIndex, 1);
  nextLayers.splice(toIndex, 0, moved);
  return {
    layers: nextLayers,
    fromIndex,
    toIndex,
  };
};

const CLIPBOARD_PASTE_OFFSET = 40;

const createPastedPanel = (
  page: Project["pages"][number],
  panel: Project["pages"][number]["panels"][number],
) => {
  const rect = clampPanelRectToWorkspace(page, {
    x: panel.x + CLIPBOARD_PASTE_OFFSET,
    y: panel.y + CLIPBOARD_PASTE_OFFSET,
    width: panel.width,
    height: panel.height,
  });
  const nextPoints = scalePanelPoints(
    panel.points,
    panel.width,
    panel.height,
    rect.width,
    rect.height,
  );
  return {
    ...panel,
    id: createId("panel"),
    ...rect,
    points: nextPoints,
    image: panel.image
      ? {
          ...panel.image,
          viewBox: preservePanelImageViewBox(
            panel,
            rect,
            panel.image.sourceWidth ?? panel.image.viewBox.width,
            panel.image.sourceHeight ?? panel.image.viewBox.height,
            panel.image.viewBox,
          ),
        }
      : null,
  };
};

const createPastedText = (
  page: Project["pages"][number],
  text: Project["pages"][number]["texts"][number],
) => {
  const rect = clampTextBoxToWorkspace(page, {
    x: text.x + CLIPBOARD_PASTE_OFFSET,
    y: text.y + CLIPBOARD_PASTE_OFFSET,
    width: text.width,
    height: text.height,
  });
  return {
    ...text,
    id: createId("text"),
    ...rect,
  };
};

const createPastedBubble = (
  page: Project["pages"][number],
  bubble: Project["pages"][number]["bubbles"][number],
) => {
  const rect = clampBubbleRectToWorkspace(page, {
    x: bubble.x + CLIPBOARD_PASTE_OFFSET,
    y: bubble.y + CLIPBOARD_PASTE_OFFSET,
    width: bubble.width,
    height: bubble.height,
  });
  const deltaX = rect.x - bubble.x;
  const deltaY = rect.y - bubble.y;
  return {
    ...bubble,
    id: createId("bubble"),
    ...rect,
    contentCenter: scaleBubbleLocalPoint(
      bubble.contentCenter,
      bubble.width,
      bubble.height,
      rect.width,
      rect.height,
    ),
    tailTip: clampPointToWorkspace(page, {
      x: bubble.tailTip.x + deltaX,
      y: bubble.tailTip.y + deltaY,
    }),
    ...(bubble.tailBase
      ? {
          tailBase: scaleBubbleLocalPoint(
            bubble.tailBase,
            bubble.width,
            bubble.height,
            rect.width,
            rect.height,
          ),
        }
      : {}),
    customPoints: bubble.customPoints.map((point) =>
      scaleBubbleLocalPoint(point, bubble.width, bubble.height, rect.width, rect.height),
    ),
    customPointSmoothness: [...bubble.customPointSmoothness],
    ...(bubble.customHandleProfile
      ? {
          customHandleProfile: {
            movableIndices: [...bubble.customHandleProfile.movableIndices],
            lockedIndices: [...bubble.customHandleProfile.lockedIndices],
          },
        }
      : {}),
  };
};

const commands = {
  createProject: {
    id: "createProject",
    label: "Create Project",
    inputSchema: z.object({
      title: z.string().trim().min(1),
      type: projectTypeSchema.default("manga"),
    }),
    execute: (context, input) => {
      const project = ensureProject(createBlankProject(input.title, input.type));
      context.setProject(project);
      context.setSession({
        selectedPageId: null,
        selection: null,
        multiSelection: [],
        panelImageEditing: null,
        activeTool: "select",
        lastExport: null,
        appView: "editor",
        statusMessage: createContextStatus(context, "success", "command.projectCreated"),
      });
      context.setHistory({ past: [], future: [] });
      return project;
    },
  },
  setProjectType: {
    id: "setProjectType",
    label: "Set Project Type",
    recordHistory: true,
    inputSchema: z.object({
      type: projectTypeSchema,
    }),
    execute: (context, input) => {
      const current = context.getProject();
      if (current.type === input.type) {
        return current;
      }
      const nextProject = ensureProject(
        touch({
          ...current,
          type: input.type,
        }),
      );
      context.setProject(nextProject);
      context.setSession({
        statusMessage: createContextStatus(context, "success", "command.projectTypeUpdated"),
      });
      return nextProject;
    },
  },
  renameProject: {
    id: "renameProject",
    label: "Rename Project",
    recordHistory: true,
    inputSchema: z.object({
      title: z.string().trim().min(1),
    }),
    execute: (context, input) => {
      const nextProject = ensureProject(
        touch({
          ...context.getProject(),
          title: input.title,
        }),
      );
      context.setProject(nextProject);
      context.setSession({
        statusMessage: createContextStatus(context, "success", "command.projectRenamed"),
      });
      return nextProject;
    },
  },
  saveProject: {
    id: "saveProject",
    label: "Save Project",
    inputSchema: z.object({
      target: z.enum(["localDraft"]).default("localDraft"),
    }),
    execute: async (context, input) => {
      const savedAt = await saveLocalDraft(context.getProject());
      context.setSession({
        saveStatus: {
          target: input.target,
          lastSavedAt: savedAt,
          hasUnsavedChanges: false,
        },
        statusMessage: createContextStatus(context, "info", "command.projectSaved"),
      });
      return {
        target: input.target,
        lastSavedAt: savedAt,
      };
    },
  },
  loadProject: {
    id: "loadProject",
    label: "Load Project",
    inputSchema: z.object({
      project: z.unknown().optional(),
      source: z.enum(["localDraft"]).optional(),
    }),
    execute: async (context, input) => {
      const project = input.project ?? (await loadLocalDraft());
      if (!project) {
        throw new Error("No saved draft was found.");
      }
      const parsed = ensureProject(normalizeProjectForCurrentVersion(project));
      context.setProject(parsed);
      context.setSession({
        selectedPageId: parsed.pages[0]?.id ?? null,
        selection: null,
        multiSelection: [],
        panelImageEditing: null,
        activeTool: "select",
        lastExport: null,
        appView: "editor",
        saveStatus: {
          target: "localDraft",
          lastSavedAt: null,
          hasUnsavedChanges: false,
        },
        statusMessage: createContextStatus(context, "success", "command.projectLoaded"),
      });
      context.setHistory({ past: [], future: [] });
      return parsed;
    },
  },
  goHome: {
    id: "goHome",
    label: "Go Home",
    inputSchema: z.object({}),
    execute: async (context) => {
      const project = context.getProject();
      const saveStatus = context.getSession().saveStatus;
      if (saveStatus.hasUnsavedChanges && project.title.trim().length > 0) {
        const savedAt = await saveLocalDraft(project);
        context.setSession({
          saveStatus: {
            target: "localDraft",
            lastSavedAt: savedAt,
            hasUnsavedChanges: false,
          },
        });
      }
      context.setSession({
        appView: "welcome",
        statusMessage: null,
      });
      return {
        appView: "welcome" as const,
      };
    },
  },
  listStoredProjects: {
    id: "listStoredProjects",
    label: "List Stored Projects",
    inputSchema: z.object({}),
    execute: async () => listLocalProjects(),
  },
  deleteStoredProject: {
    id: "deleteStoredProject",
    label: "Delete Stored Project",
    inputSchema: z.object({
      projectId: z.string().min(1),
    }),
    execute: async (context, input) => {
      const deleted = await deleteLocalProject(input.projectId);
      context.setSession({
        statusMessage: createContextStatus(context, "info", "command.storedProjectDeleted"),
      });
      return {
        projectId: input.projectId,
        deleted,
      };
    },
  },
  duplicateStoredProject: {
    id: "duplicateStoredProject",
    label: "Duplicate Stored Project",
    inputSchema: z
      .object({
        projectId: z.string().min(1).optional(),
        project: z.unknown().optional(),
      })
      .refine((input) => input.projectId !== undefined || input.project !== undefined, {
        message: "Either projectId or project is required.",
      }),
    execute: async (context, input) => {
      let sourceProject: Project | null = input.project
        ? ensureProject(normalizeProjectForCurrentVersion(input.project))
        : null;

      if (!sourceProject && input.projectId) {
        const projects = await listLocalProjects();
        sourceProject = projects.find((entry) => entry.id === input.projectId) ?? null;
      }

      if (!sourceProject) {
        throw new Error(`Stored project not found: ${input.projectId ?? "project payload"}`);
      }

      const now = new Date().toISOString();
      const baseTitle = sourceProject.title.trim() || translate(getLocale(context), "sidebar.untitledProject");
      const copySuffix = getLocale(context) === "zh-CN" ? "副本" : "Copy";
      const duplicatedProject = ensureProject({
        ...structuredClone(sourceProject),
        id: createId("project"),
        title: `${baseTitle} ${copySuffix}`,
        createdAt: now,
        updatedAt: now,
      });

      await saveLocalDraft(duplicatedProject);
      context.setSession({
        statusMessage: createContextStatus(context, "success", "command.storedProjectDuplicated"),
      });
      return duplicatedProject;
    },
  },
  addPage: {
    id: "addPage",
    label: "Add Page",
    recordHistory: true,
    inputSchema: z.object({
      name: z.string().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      insertAfterPageId: z.string().optional(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      const insertAfterIndex =
        input.insertAfterPageId !== undefined
          ? current.pages.findIndex((page) => page.id === input.insertAfterPageId)
          : -1;
      if (input.insertAfterPageId !== undefined && insertAfterIndex < 0) {
        throw new Error(`Page not found: ${input.insertAfterPageId}`);
      }
      const insertIndex = insertAfterIndex >= 0 ? insertAfterIndex + 1 : current.pages.length;
      const draft = createDefaultPage(current.pages.length, current.type);
      const locale = getLocale(context);
      const page = {
        ...draft,
        name: getDefaultPageName(locale, insertIndex + 1),
        ...(input.name ? { name: input.name } : {}),
        ...(input.width ? { width: input.width } : {}),
        ...(input.height ? { height: input.height } : {}),
      };
      const pages = [...current.pages];
      pages.splice(insertIndex, 0, page);
      context.setProject(ensureProject(touch({ ...current, pages })));
      context.setSession({
        selectedPageId: page.id,
        selection: null,
        multiSelection: [],
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.pageAdded", {
          name: page.name,
        }),
      });
      return page;
    },
  },
  setPageBackground: {
    id: "setPageBackground",
    label: "Set Page Background",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      background: z.string(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      withPage(current, input.pageId, (page) => page);
      const nextProject = ensureProject(
        touch(
          updatePage(current, input.pageId, (entry) => ({
            ...entry,
            background: input.background,
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: input.pageId,
        statusMessage: createContextStatus(context, "success", "command.pageBackgroundUpdated"),
      });
      return withPage(nextProject, input.pageId, (entry) => entry);
    },
  },
  duplicatePage: {
    id: "duplicatePage",
    label: "Duplicate Page",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      const index = current.pages.findIndex((page) => page.id === input.pageId);
      if (index < 0) {
        throw new Error(`Page not found: ${input.pageId}`);
      }
      const duplicate = {
        ...clonePage(current.pages[index]),
        name: getDuplicatedPageName(getLocale(context), current.pages[index].name),
      };
      const pages = [...current.pages];
      pages.splice(index + 1, 0, duplicate);
      context.setProject(ensureProject(touch({ ...current, pages })));
      context.setSession({
        selectedPageId: duplicate.id,
        selection: null,
        multiSelection: [],
        statusMessage: createContextStatus(context, "success", "command.pageDuplicated", {
          name: duplicate.name,
        }),
      });
      return duplicate;
    },
  },
  removePage: {
    id: "removePage",
    label: "Remove Page",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      const index = current.pages.findIndex((page) => page.id === input.pageId);
      if (index < 0) {
        throw new Error(`Page not found: ${input.pageId}`);
      }
      const nextPages = current.pages.filter((page) => page.id !== input.pageId);
      const nextProject = ensureProject(touch({ ...current, pages: nextPages }));
      const nextSelectedPageId =
        nextPages[index]?.id ?? nextPages[index - 1]?.id ?? nextPages[0]?.id ?? null;
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: nextSelectedPageId,
        selection: null,
        multiSelection: [],
        statusMessage: createContextStatus(context, "info", "command.pageRemoved"),
      });
      return {
        pageId: input.pageId,
        remainingPages: nextPages.length,
      };
    },
  },
  reorderPage: {
    id: "reorderPage",
    label: "Reorder Page",
    recordHistory: true,
    inputSchema: z.object({
      fromIndex: z.number().int().nonnegative(),
      toIndex: z.number().int().nonnegative(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      const pages = [...current.pages];
      if (!pages[input.fromIndex] || input.toIndex > pages.length - 1) {
        throw new Error("Page reorder index is out of bounds.");
      }
      const [page] = pages.splice(input.fromIndex, 1);
      pages.splice(input.toIndex, 0, page);
      context.setProject(ensureProject(touch({ ...current, pages })));
      context.setSession({
        statusMessage: createContextStatus(context, "info", "command.pageReordered"),
      });
      return pages.map((entry) => entry.id);
    },
  },
  moveLayer: {
    id: "moveLayer",
    label: "Move Layer",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      objectType: objectTypeSchema,
      objectId: z.string(),
      direction: z.enum(["up", "down"]),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      assertObjectExists(current, input.pageId, input.objectType, input.objectId);
      const page = getPageById(current, input.pageId);
      const layerRef = toLayerRef(input.objectType, input.objectId);
      const moved = moveLayerByDirection(page.layers, layerRef, input.direction);
      if (!moved) {
        throw new Error(`Layer not found: ${layerRef}`);
      }
      if (moved.toIndex === moved.fromIndex) {
        throw new Error("Layer move is out of bounds.");
      }
      const nextProject = ensureProject(
        touch(
          updatePage(current, input.pageId, (entry) => ({
            ...entry,
            layers: moved.layers,
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: input.pageId,
      });
      return moved;
    },
  },
  pasteClipboardItem: {
    id: "pasteClipboardItem",
    label: "Paste Clipboard Item",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string().optional(),
      item: clipboardItemSchema,
    }),
    execute: (context, input) => {
      const current = context.getProject();

      if (input.item.kind === "page") {
        const anchorPageId =
          input.pageId ?? context.getSession().selectedPageId ?? current.pages[0]?.id ?? null;
        const anchorIndex = anchorPageId
          ? current.pages.findIndex((page) => page.id === anchorPageId)
          : current.pages.length - 1;
        const insertIndex =
          anchorIndex >= 0 ? Math.min(anchorIndex + 1, current.pages.length) : current.pages.length;
        const pastedPage = {
          ...clonePage(input.item.page),
          name: getDuplicatedPageName(getLocale(context), input.item.page.name),
        };
        const pages = [...current.pages];
        pages.splice(insertIndex, 0, pastedPage);
        const nextProject = ensureProject(touch({ ...current, pages }));
        context.setProject(nextProject);
        context.setSession({
          selectedPageId: pastedPage.id,
          selection: null,
          multiSelection: [],
          panelImageEditing: null,
          activeTool: "select",
          statusMessage: createContextStatus(context, "success", "command.pageDuplicated", {
            name: pastedPage.name,
          }),
        });
        return {
          kind: "page" as const,
          pageId: pastedPage.id,
        };
      }

      const targetPageId =
        input.pageId ?? context.getSession().selectedPageId ?? current.pages[0]?.id ?? null;
      if (!targetPageId) {
        throw new Error("No target page is available for paste.");
      }
      const page = getPageById(current, targetPageId);

      if (input.item.kind === "panel") {
        const panel = createPastedPanel(page, input.item.panel);
        const nextProject = ensureProject(
          touch(
            updatePage(current, targetPageId, (entry) => ({
              ...entry,
              panels: [...entry.panels, panel],
              layers: [...entry.layers, toLayerRef("panel", panel.id)],
            })),
          ),
        );
        context.setProject(nextProject);
        context.setSession({
          selectedPageId: targetPageId,
          selection: {
            pageId: targetPageId,
            objectType: "panel",
            objectId: panel.id,
          },
          multiSelection: [
            {
              pageId: targetPageId,
              objectType: "panel",
              objectId: panel.id,
            },
          ],
          panelImageEditing: null,
          activeTool: "select",
          statusMessage: createContextStatus(context, "success", "command.panelCreated"),
        });
        return {
          kind: "panel" as const,
          pageId: targetPageId,
          objectId: panel.id,
        };
      }

      if (input.item.kind === "text") {
        const text = createPastedText(page, input.item.text);
        const nextProject = ensureProject(
          touch(
            updatePage(current, targetPageId, (entry) => ({
              ...entry,
              texts: [...entry.texts, text],
              layers: [...entry.layers, toLayerRef("text", text.id)],
            })),
          ),
        );
        context.setProject(nextProject);
        context.setSession({
          selectedPageId: targetPageId,
          selection: {
            pageId: targetPageId,
            objectType: "text",
            objectId: text.id,
          },
          multiSelection: [
            {
              pageId: targetPageId,
              objectType: "text",
              objectId: text.id,
            },
          ],
          panelImageEditing: null,
          activeTool: "select",
          statusMessage: createContextStatus(context, "success", "command.textAdded"),
        });
        return {
          kind: "text" as const,
          pageId: targetPageId,
          objectId: text.id,
        };
      }

      const bubble = createPastedBubble(page, input.item.bubble);
      const nextProject = ensureProject(
        touch(
          updatePage(current, targetPageId, (entry) => ({
            ...entry,
            bubbles: [...entry.bubbles, bubble],
            layers: [...entry.layers, toLayerRef("bubble", bubble.id)],
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: targetPageId,
        selection: {
          pageId: targetPageId,
          objectType: "bubble",
          objectId: bubble.id,
        },
        multiSelection: [
          {
            pageId: targetPageId,
            objectType: "bubble",
            objectId: bubble.id,
          },
        ],
        panelImageEditing: null,
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.bubbleAdded"),
      });
      return {
        kind: "bubble" as const,
        pageId: targetPageId,
        objectId: bubble.id,
      };
    },
  },
  createClipboardEnvelope: {
    id: "createClipboardEnvelope",
    label: "Create Clipboard Envelope",
    inputSchema: z.object({}),
    execute: async (context) => buildClipboardEnvelopeForSession(context),
  },
  selectPage: {
    id: "selectPage",
    label: "Select Page",
    inputSchema: z.object({
      pageId: z.string(),
    }),
    execute: (context, input) => {
      withPage(context.getProject(), input.pageId, (page) => page);
      context.setSession({
        selectedPageId: input.pageId,
        selection: null,
        multiSelection: [],
        panelImageEditing: null,
        activeTool: "select",
      });
      return { pageId: input.pageId };
    },
  },
  setTool: {
    id: "setTool",
    label: "Set Tool",
    inputSchema: z.object({
      tool: z.enum(["select", "panel", "text", "bubble", "element"]),
    }),
    execute: (context, input) => {
      const locale = getLocale(context);
      context.setSession({
        activeTool: input.tool,
        statusMessage:
          input.tool === "select"
            ? null
            : createLocalizedStatus(locale, "info", "command.toolActive", {
                tool: getToolLabel(locale, input.tool),
              }),
      });
      return { tool: input.tool };
    },
  },
  setBubbleInsertState: {
    id: "setBubbleInsertState",
    label: "Set Bubble Insert State",
    inputSchema: z.object({
      mode: z.enum(["preset", "customClickDraw"]).optional(),
      presetBubbleType: bubbleTypeSchema.refine((type) => type !== "custom").optional(),
      customSmoothness: z.number().min(0).max(1).optional(),
    }),
    execute: (context, input) => {
      const current = context.getSession().bubbleInsert;
      context.setSession({
        bubbleInsert: {
          ...current,
          ...(input.mode !== undefined ? { mode: input.mode } : {}),
          ...(input.presetBubbleType !== undefined
            ? { presetBubbleType: input.presetBubbleType }
            : {}),
          ...(input.customSmoothness !== undefined
            ? { customSmoothness: input.customSmoothness }
            : {}),
        },
      });
      return context.getSession().bubbleInsert;
    },
  },
  setLocale: {
    id: "setLocale",
    label: "Set Locale",
    inputSchema: z.object({
      locale: localeSchema,
    }),
    execute: (context, input) => {
      persistLocale(input.locale);
      context.setSession({
        locale: input.locale,
        statusMessage: createLocalizedStatus(input.locale, "info", "command.localeChanged"),
      });
      return { locale: input.locale };
    },
  },
  selectObject: {
    id: "selectObject",
    label: "Select Object",
    inputSchema: z.object({
      pageId: z.string(),
      objectType: objectTypeSchema,
      objectId: z.string(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const exists =
        input.objectType === "panel"
          ? page.panels.some((panel) => panel.id === input.objectId)
          : input.objectType === "text"
            ? page.texts.some((text) => text.id === input.objectId)
            : input.objectType === "element"
              ? (page.elements ?? []).some((element) => element.id === input.objectId)
              : page.bubbles.some((bubble) => bubble.id === input.objectId);
      if (!exists) {
        throw new Error(`Object not found: ${input.objectType}:${input.objectId}`);
      }
      const selection = {
        pageId: input.pageId,
        objectType: input.objectType,
        objectId: input.objectId,
      };
      context.setSession({
        selectedPageId: input.pageId,
        selection,
        multiSelection: [selection],
        panelImageEditing: null,
        activeTool: "select",
      });
      return selection;
    },
  },
  selectObjects: {
    id: "selectObjects",
    label: "Select Objects",
    inputSchema: z.object({
      pageId: z.string(),
      objects: z.array(objectRefSchema),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const nextSelections = uniqueSelections(
        input.objects
          .filter((object: ObjectRef) => {
            if (object.objectType === "panel") {
              return page.panels.some((panel) => panel.id === object.objectId);
            }
            if (object.objectType === "text") {
              return page.texts.some((text) => text.id === object.objectId);
            }
            if (object.objectType === "element") {
              return (page.elements ?? []).some((element) => element.id === object.objectId);
            }
            return page.bubbles.some((bubble) => bubble.id === object.objectId);
          })
          .map((object: ObjectRef) => ({
            pageId: input.pageId,
            objectType: object.objectType,
            objectId: object.objectId,
          })),
      );
      const primarySelection = nextSelections[0] ?? null;
      context.setSession({
        selectedPageId: input.pageId,
        selection: primarySelection,
        multiSelection: nextSelections,
        panelImageEditing: null,
        activeTool: "select",
      });
      return nextSelections;
    },
  },
  clearSelection: {
    id: "clearSelection",
    label: "Clear Selection",
    inputSchema: z.object({}),
    execute: (context) => {
      context.setSession({
        selection: null,
        multiSelection: [],
        panelImageEditing: null,
      });
      return null;
    },
  },
  groupSelection: {
    id: "groupSelection",
    label: "Group Selection",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string().optional(),
      objects: z.array(objectRefSchema).optional(),
    }),
    execute: (context, input) => {
      const session = context.getSession();
      const project = context.getProject();
      const pageId =
        input.pageId ??
        session.selection?.pageId ??
        session.selectedPageId ??
        project.pages[0]?.id ??
        null;
      if (!pageId) {
        throw new Error("No page is available for grouping.");
      }
      const page = getPageById(project, pageId);
      const sourceObjects: ObjectRef[] =
        input.objects ??
        session.multiSelection
          .filter((entry) => entry.pageId === pageId)
          .map((entry) => ({
            objectType: entry.objectType,
            objectId: entry.objectId,
          }));
      const members = dedupeObjectRefs(
        sourceObjects.filter((member: ObjectRef) => {
          if (member.objectType === "panel") {
            return page.panels.some((panel) => panel.id === member.objectId);
          }
          if (member.objectType === "text") {
            return page.texts.some((text) => text.id === member.objectId);
          }
          return page.bubbles.some((bubble) => bubble.id === member.objectId);
        }),
      );
      if (members.length < 2) {
        return null;
      }

      let nextGroup: Project["pages"][number]["groups"][number] | null = null;
      let nextMultiSelection: EditorSelectionItem[] = [];
      const nextProject = ensureProject(
        touch(
          updatePage(project, pageId, (entry) => {
            const { page: mergedPage, replacements } = mergeOverlappingSelectedBubbles(entry, members);
            const resolvedMembers = dedupeObjectRefs(
              members
                .map((member) => {
                  if (member.objectType !== "bubble") {
                    return member;
                  }
                  const replacementId = replacements.get(member.objectId);
                  return replacementId
                    ? {
                        objectType: "bubble" as const,
                        objectId: replacementId,
                      }
                    : member;
                })
                .filter((member) => {
                  if (member.objectType === "panel") {
                    return mergedPage.panels.some((panel) => panel.id === member.objectId);
                  }
                  if (member.objectType === "text") {
                    return mergedPage.texts.some((text) => text.id === member.objectId);
                  }
                  return mergedPage.bubbles.some((bubble) => bubble.id === member.objectId);
                }),
            );
            const selectedKeys = new Set(resolvedMembers.map(objectRefKey));
            const detachedGroups = mergedPage.groups
              .map((group) => ({
                ...group,
                members: group.members.filter((member) => !selectedKeys.has(objectRefKey(member))),
              }))
              .filter((group) => group.members.length >= 2);
            const groups =
              resolvedMembers.length >= 2
                ? (() => {
                    nextGroup = {
                      id: createId("group"),
                      members: resolvedMembers,
                    };
                    return sanitizeGroupList(mergedPage, [...detachedGroups, nextGroup]);
                  })()
                : sanitizeGroupList(mergedPage, detachedGroups);
            nextMultiSelection = resolvedMembers.map((member) => ({
              pageId,
              objectType: member.objectType,
              objectId: member.objectId,
            }));
            return {
              ...mergedPage,
              groups,
            };
          }),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: pageId,
        selection: nextMultiSelection[0] ?? null,
        multiSelection: nextMultiSelection,
      });
      return nextGroup;
    },
  },
  ungroupSelection: {
    id: "ungroupSelection",
    label: "Ungroup Selection",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string().optional(),
      groupId: z.string().optional(),
      objects: z.array(objectRefSchema).optional(),
    }),
    execute: (context, input) => {
      const session = context.getSession();
      const pageId =
        input.pageId ??
        session.selection?.pageId ??
        session.selectedPageId ??
        context.getProject().pages[0]?.id ??
        null;
      if (!pageId) {
        throw new Error("No page is available for ungrouping.");
      }
      const page = getPageById(context.getProject(), pageId);
      const selectedObjects =
        input.objects ??
        session.multiSelection
          .filter((entry) => entry.pageId === pageId)
          .map((entry) => ({
            objectType: entry.objectType,
            objectId: entry.objectId,
          }));
      const selectedKeys = new Set(selectedObjects.map(objectRefKey));
      const nextGroups = page.groups.filter((group) => {
        if (input.groupId && group.id === input.groupId) {
          return false;
        }
        if (selectedKeys.size === 0) {
          return true;
        }
        return !group.members.some((member) => selectedKeys.has(objectRefKey(member)));
      });
      const removedCount = page.groups.length - nextGroups.length;
      if (removedCount <= 0) {
        return {
          removedCount: 0,
        };
      }
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), pageId, (entry) => ({
            ...entry,
            groups: sanitizeGroupList(entry, nextGroups),
          })),
        ),
      );
      context.setProject(nextProject);
      return {
        removedCount,
      };
    },
  },
  setZoom: {
    id: "setZoom",
    label: "Set Zoom",
    inputSchema: z.object({
      zoom: z.number(),
    }),
    execute: (context, input) => {
      const zoom = clamp(input.zoom, MIN_ZOOM, MAX_ZOOM);
      context.setSession({
        zoom,
      });
      return { zoom };
    },
  },
  undo: {
    id: "undo",
    label: "Undo",
    inputSchema: z.object({}),
    execute: (context) => {
      const { past, future } = context.getHistory();
      if (past.length === 0) {
        return null;
      }
      const previous = past[past.length - 1];
      const current = context.getSession();
      context.setHistory({
        past: past.slice(0, -1),
        future: [
          snapshotSession(
            current.project,
            current.selectedPageId,
            current.selection,
            current.multiSelection,
            current.panelImageEditing,
          ),
          ...future,
        ],
      });
      context.setProject(previous.project);
      context.setSession({
        selectedPageId: previous.selectedPageId,
        selection: previous.selection,
        multiSelection: previous.multiSelection ?? [],
        panelImageEditing: previous.panelImageEditing,
        activeTool: "select",
        statusMessage: createContextStatus(context, "info", "command.undo"),
      });
      return previous;
    },
  },
  redo: {
    id: "redo",
    label: "Redo",
    inputSchema: z.object({}),
    execute: (context) => {
      const { past, future } = context.getHistory();
      if (future.length === 0) {
        return null;
      }
      const [next, ...remainingFuture] = future;
      const current = context.getSession();
      context.setHistory({
        past: [
          ...past,
          snapshotSession(
            current.project,
            current.selectedPageId,
            current.selection,
            current.multiSelection,
            current.panelImageEditing,
          ),
        ],
        future: remainingFuture,
      });
      context.setProject(next.project);
      context.setSession({
        selectedPageId: next.selectedPageId,
        selection: next.selection,
        multiSelection: next.multiSelection ?? [],
        panelImageEditing: next.panelImageEditing,
        activeTool: "select",
        statusMessage: createContextStatus(context, "info", "command.redo"),
      });
      return next;
    },
  },
  createPanel: {
    id: "createPanel",
    label: "Create Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const rect = clampPanelRectToWorkspace(page, input);
      const panel = {
        id: createId("panel"),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        rotation: 0,
        points: [
          { x: 0, y: 0 },
          { x: rect.width, y: 0 },
          { x: rect.width, y: rect.height },
          { x: 0, y: rect.height },
        ],
        style: createDefaultPanelStyle(),
        image: null,
        description: "",
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: [...entry.panels, panel],
            layers: [...entry.layers, toLayerRef("panel", panel.id)],
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: input.pageId,
        selection: {
          pageId: input.pageId,
          objectType: "panel",
          objectId: panel.id,
        },
        multiSelection: [
          {
            pageId: input.pageId,
            objectType: "panel",
            objectId: panel.id,
          },
        ],
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.panelCreated"),
      });
      return panel;
    },
  },
  movePanel: {
    id: "movePanel",
    label: "Move Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      x: z.number(),
      y: z.number(),
      selectAfterMove: z.boolean().optional().default(true),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const rect = clampPanelRectToWorkspace(page, {
        x: input.x,
        y: input.y,
        width: panel.width,
        height: panel.height,
      });
      const requestedDeltaX = rect.x - panel.x;
      const requestedDeltaY = rect.y - panel.y;
      const moveMembers = getMoveMembersForObject(page, "panel", input.panelId);
      const clampedDelta = clampGroupMoveDelta(page, moveMembers, requestedDeltaX, requestedDeltaY);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) =>
            applyMoveDeltaToPage(entry, moveMembers, clampedDelta.deltaX, clampedDelta.deltaY),
          ),
        ),
      );
      context.setProject(nextProject);
      // Only update selection if selectAfterMove is true (default behavior)
      // When dragging, we pass false to prevent auto-selection after drag
      if (input.selectAfterMove) {
        context.setSession({
          selection: {
            pageId: input.pageId,
            objectType: "panel",
            objectId: input.panelId,
          },
          multiSelection: [
            {
              pageId: input.pageId,
              objectType: "panel",
              objectId: input.panelId,
            },
          ],
        });
      }
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((item) => item.id === input.panelId),
      );
    },
  },
  resizePanel: {
    id: "resizePanel",
    label: "Resize Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const rect = clampPanelRectToWorkspace(page, {
        x: input.x ?? panel.x,
        y: input.y ?? panel.y,
        width: input.width,
        height: input.height,
      });
      const nextPoints = scalePanelPoints(
        panel.points,
        panel.width,
        panel.height,
        rect.width,
        rect.height,
      );
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((item) =>
              item.id === input.panelId
                ? {
                    ...item,
                    ...rect,
                    points: nextPoints,
                    image: item.image
                      ? {
                          ...item.image,
                          viewBox: preservePanelImageViewBox(
                            item,
                            rect,
                            item.image.sourceWidth ?? item.image.viewBox.width,
                            item.image.sourceHeight ?? item.image.viewBox.height,
                            item.image.viewBox,
                          ),
                        }
                      : null,
                  }
                : item,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((item) => item.id === input.panelId),
      );
    },
  },
  setPanelStyle: {
    id: "setPanelStyle",
    label: "Set Panel Style",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      fill: z.string().optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
      cornerRadius: z.number().nonnegative().optional(),
    }),
    execute: (context, input) => {
      getPanel(context.getProject(), input.pageId, input.panelId);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((panel) =>
              panel.id === input.panelId
                ? {
                    ...panel,
                    style: {
                      ...panel.style,
                      ...(input.fill !== undefined ? { fill: input.fill } : {}),
                      ...(input.stroke !== undefined ? { stroke: input.stroke } : {}),
                      ...(input.strokeWidth !== undefined ? { strokeWidth: input.strokeWidth } : {}),
                      ...(input.cornerRadius !== undefined ? { cornerRadius: input.cornerRadius } : {}),
                    },
                  }
                : panel,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((panel) => panel.id === input.panelId),
      );
    },
  },
  setPanelDescription: {
    id: "setPanelDescription",
    label: "Set Panel Description",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      description: z.string(),
    }),
    execute: (context, input) => {
      getPanel(context.getProject(), input.pageId, input.panelId);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((panel) =>
              panel.id === input.panelId
                ? {
                    ...panel,
                    description: input.description,
                  }
                : panel,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((panel) => panel.id === input.panelId),
      );
    },
  },
  placeImageInPanel: {
    id: "placeImageInPanel",
    label: "Place Image In Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      src: z.string(),
      prompt: z.string().optional(),
    }),
    execute: async (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const { sourceWidth, sourceHeight } = await readImageMetadata(
        input.src,
        panel.width,
        panel.height,
      );
      const image = {
        src: input.src,
        prompt: input.prompt ?? "",
        sourceWidth,
        sourceHeight,
        viewBox: createInitialPanelViewBox(panel, sourceWidth, sourceHeight),
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((item) =>
              item.id === input.panelId ? { ...item, image } : item,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selection: {
          pageId: input.pageId,
          objectType: "panel",
          objectId: input.panelId,
        },
        multiSelection: [
          {
            pageId: input.pageId,
            objectType: "panel",
            objectId: input.panelId,
          },
        ],
        panelImageEditing: null,
        statusMessage: createContextStatus(context, "success", "command.imagePlaced"),
      });
      return image;
    },
  },
  transformImageInPanel: {
    id: "transformImageInPanel",
    label: "Transform Image In Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      x: z.number(),
      y: z.number(),
      scaleX: z.number(),
      scaleY: z.number(),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      if (!panel.image) {
        throw new Error(`Panel image not found: ${input.panelId}`);
      }
      const zoomFactor = 1 / Math.max(0.1, (input.scaleX + input.scaleY) / 2);
      const sourceWidth = panel.image.sourceWidth ?? panel.image.viewBox.width;
      const sourceHeight = panel.image.sourceHeight ?? panel.image.viewBox.height;
      const nextViewBox = clampImageViewBox(
        sourceWidth,
        sourceHeight,
        fitViewBoxToPanelAspect(
          panel,
          sourceWidth,
          sourceHeight,
          {
            x: input.x,
            y: input.y,
            width: panel.image.viewBox.width * zoomFactor,
            height: panel.image.viewBox.height * zoomFactor,
          },
        ),
      );
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((panel) =>
              panel.id === input.panelId && panel.image
                ? {
                    ...panel,
                    image: {
                      ...panel.image,
                      viewBox: nextViewBox,
                      transform: {
                        x: input.x,
                        y: input.y,
                        scaleX: input.scaleX,
                        scaleY: input.scaleY,
                      },
                    },
                  }
                : panel,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((panel) => panel.id === input.panelId)?.image,
      );
    },
  },
  setPanelImageCrop: {
    id: "setPanelImageCrop",
    label: "Set Panel Image Crop",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      viewBox: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      if (!panel.image) {
        throw new Error(`Panel image not found: ${input.panelId}`);
      }
      const sourceWidth = panel.image.sourceWidth ?? panel.image.viewBox.width;
      const sourceHeight = panel.image.sourceHeight ?? panel.image.viewBox.height;
      const nextViewBox = fitViewBoxToPanelAspect(
        panel,
        sourceWidth,
        sourceHeight,
        clampImageViewBox(sourceWidth, sourceHeight, input.viewBox),
      );
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((p) =>
              p.id === input.panelId && p.image
                ? { ...p, image: { ...p.image, viewBox: nextViewBox } }
                : p,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((p) => p.id === input.panelId)?.image,
      );
    },
  },
  enterPanelImageEdit: {
    id: "enterPanelImageEdit",
    label: "Enter Panel Image Edit",
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      if (!panel.image) {
        throw new Error(`Panel image not found: ${input.panelId}`);
      }
      context.setSession({
        panelImageEditing: {
          pageId: input.pageId,
          panelId: input.panelId,
        },
      });
      return { pageId: input.pageId, panelId: input.panelId };
    },
  },
  exitPanelImageEdit: {
    id: "exitPanelImageEdit",
    label: "Exit Panel Image Edit",
    inputSchema: z.object({}),
    execute: (context) => {
      context.setSession({ panelImageEditing: null });
      return null;
    },
  },
  setPanelPoints: {
    id: "setPanelPoints",
    label: "Set Panel Points",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      points: z.array(z.object({ x: z.number(), y: z.number() })).min(3),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const absolutePoints = input.points.map((p: { x: number; y: number }) =>
        clampPointToWorkspace(page, {
          x: panel.x + p.x,
          y: panel.y + p.y,
        }),
      );
      const xs = absolutePoints.map((p: { x: number; y: number }) => p.x);
      const ys = absolutePoints.map((p: { x: number; y: number }) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const normalizedPoints = absolutePoints.map((p: { x: number; y: number }) => ({
        x: snapValue(p.x - minX),
        y: snapValue(p.y - minY),
      }));
      const newWidth = Math.max(20, snapValue(maxX - minX));
      const newHeight = Math.max(20, snapValue(maxY - minY));
      const newX = minX;
      const newY = minY;
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((p) =>
              p.id === input.panelId
                ? {
                    ...p,
                    x: newX,
                    y: newY,
                    width: newWidth,
                    height: newHeight,
                    points: normalizedPoints,
                    image: p.image
                      ? {
                          ...p.image,
                          viewBox: preservePanelImageViewBox(
                            p,
                            {
                              x: newX,
                              y: newY,
                              width: newWidth,
                              height: newHeight,
                            },
                            p.image.sourceWidth ?? p.image.viewBox.width,
                            p.image.sourceHeight ?? p.image.viewBox.height,
                            p.image.viewBox,
                          ),
                        }
                      : null,
                  }
                : p,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((p) => p.id === input.panelId),
      );
    },
  },
  addPanelPoint: {
    id: "addPanelPoint",
    label: "Add Panel Point",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const nextPoints = insertPanelPoint(panel);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((p) =>
              p.id === input.panelId ? { ...p, points: nextPoints } : p,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((p) => p.id === input.panelId),
      );
    },
  },
  removePanelPoint: {
    id: "removePanelPoint",
    label: "Remove Panel Point",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      pointIndex: z.number().int().nonnegative(),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const nextPoints = removePanelPoint(panel, input.pointIndex);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((p) =>
              p.id === input.panelId ? { ...p, points: nextPoints } : p,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((p) => p.id === input.panelId),
      );
    },
  },
  createElement: {
    id: "createElement",
    label: "Create Element",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      src: z.string(),
      title: z.string(),
      category: z.enum(["text", "symbols", "artWords", "effects", "balloons"]).optional(),
      rotation: z.number().optional(),
      opacity: z.number().min(0).max(1).optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const defaults = createDefaultElement({
        width: input.width ?? 240,
        height: input.height ?? 180,
        src: input.src,
        title: input.title,
        category: input.category ?? "symbols",
        rotation: input.rotation ?? 0,
        opacity: input.opacity ?? 1,
      });
      const rect = clampElementRectToWorkspace(page, {
        x: input.x,
        y: input.y,
        width: defaults.width,
        height: defaults.height,
      });
      const element = {
        id: createId("element"),
        ...defaults,
        ...rect,
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            elements: [...(entry.elements ?? []), element],
            layers: [...entry.layers, toLayerRef("element", element.id)],
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selection: {
          pageId: input.pageId,
          objectType: "element",
          objectId: element.id,
        },
        multiSelection: [
          {
            pageId: input.pageId,
            objectType: "element",
            objectId: element.id,
          },
        ],
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.elementAdded"),
      });
      return element;
    },
  },
  updateElement: {
    id: "updateElement",
    label: "Update Element",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      elementId: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      rotation: z.number().optional(),
      opacity: z.number().min(0).max(1).optional(),
      title: z.string().optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const currentElement = (page.elements ?? []).find((element) => element.id === input.elementId);
      if (!currentElement) {
        throw new Error(`Element not found: ${input.elementId}`);
      }
      const nextRect = clampElementRectToWorkspace(page, {
        x: input.x ?? currentElement.x,
        y: input.y ?? currentElement.y,
        width: input.width ?? currentElement.width,
        height: input.height ?? currentElement.height,
      });
      const shouldApplyGroupedMove =
        (input.x !== undefined || input.y !== undefined) &&
        input.width === undefined &&
        input.height === undefined;
      const moveMembers = shouldApplyGroupedMove
        ? getMoveMembersForObject(page, "element", input.elementId)
        : [{ objectType: "element" as const, objectId: input.elementId }];
      const requestedDelta = {
        x: nextRect.x - currentElement.x,
        y: nextRect.y - currentElement.y,
      };
      const clampedDelta = shouldApplyGroupedMove
        ? clampGroupMoveDelta(page, moveMembers, requestedDelta.x, requestedDelta.y)
        : { deltaX: requestedDelta.x, deltaY: requestedDelta.y };
      const resolvedRect = {
        x: currentElement.x + clampedDelta.deltaX,
        y: currentElement.y + clampedDelta.deltaY,
        width: nextRect.width,
        height: nextRect.height,
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => {
            const movedPage =
              shouldApplyGroupedMove && moveMembers.length > 1
                ? applyMoveDeltaToPage(entry, moveMembers, clampedDelta.deltaX, clampedDelta.deltaY)
                : entry;
            return {
              ...movedPage,
              elements: (movedPage.elements ?? []).map((element) =>
                element.id === input.elementId
                  ? {
                      ...element,
                      ...resolvedRect,
                      ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
                      ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
                      ...(input.title !== undefined ? { title: input.title } : {}),
                    }
                  : element,
              ),
            };
          }),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        (entry.elements ?? []).find((item) => item.id === input.elementId),
      );
    },
  },
  createText: {
    id: "createText",
    label: "Create Text",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      x: z.number(),
      y: z.number(),
      content: z.string().optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const rememberedDefaults = context.getSession().textInsertDefaults;
      const defaults = createDefaultText({
        width: rememberedDefaults.width,
        height: rememberedDefaults.height,
        fontFamily: rememberedDefaults.fontFamily,
        fontSize: rememberedDefaults.fontSize,
        fontWeight: rememberedDefaults.fontWeight,
        letterSpacing: rememberedDefaults.letterSpacing,
        lineSpacing: rememberedDefaults.lineSpacing,
        strokeWidth: rememberedDefaults.strokeWidth,
        strokeColor: rememberedDefaults.strokeColor,
        ...(input.content ? { content: input.content } : {}),
      });
      const rect = clampTextBoxToWorkspace(page, {
        x: snapValue(input.x),
        y: snapValue(input.y),
        width: defaults.width,
        height: defaults.height,
      });
      const text = {
        id: createId("text"),
        ...defaults,
        ...rect,
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            texts: [...entry.texts, text],
            layers: [...entry.layers, toLayerRef("text", text.id)],
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selection: {
          pageId: input.pageId,
          objectType: "text",
          objectId: text.id,
        },
        multiSelection: [
          {
            pageId: input.pageId,
            objectType: "text",
            objectId: text.id,
          },
        ],
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.textAdded"),
      });
      return text;
    },
  },
  updateText: {
    id: "updateText",
    label: "Update Text",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      textId: z.string(),
      content: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      fontSize: z.number().positive().optional(),
      fontFamily: z.string().optional(),
      fontWeight: z.number().int().min(100).max(900).optional(),
      letterSpacing: z.number().min(-40).max(160).optional(),
      lineSpacing: z.number().min(-40).max(160).optional(),
      color: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
      strokeColor: z.string().optional(),
      direction: z.enum(["horizontal", "vertical"]).optional(),
      textAlign: z.enum(["left", "center", "right"]).optional(),
      verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const currentText = getText(context.getProject(), input.pageId, input.textId);
      const nextTextAlign =
        input.textAlign !== undefined
          ? input.textAlign
          : input.direction === "vertical" && currentText.textAlign === "left"
            ? "center"
            : undefined;
      const nextRect = clampTextBoxToWorkspace(page, {
        x: input.x ?? currentText.x,
        y: input.y ?? currentText.y,
        width: input.width ?? currentText.width,
        height: input.height ?? currentText.height,
      });
      const shouldApplyGroupedMove =
        (input.x !== undefined || input.y !== undefined) &&
        input.width === undefined &&
        input.height === undefined;
      const moveMembers = shouldApplyGroupedMove
        ? getMoveMembersForObject(page, "text", input.textId)
        : [{ objectType: "text" as const, objectId: input.textId }];
      const requestedDelta = {
        x: nextRect.x - currentText.x,
        y: nextRect.y - currentText.y,
      };
      const clampedDelta = shouldApplyGroupedMove
        ? clampGroupMoveDelta(page, moveMembers, requestedDelta.x, requestedDelta.y)
        : {
            deltaX: requestedDelta.x,
            deltaY: requestedDelta.y,
          };
      const resolvedTextRect = {
        x: currentText.x + clampedDelta.deltaX,
        y: currentText.y + clampedDelta.deltaY,
        width: nextRect.width,
        height: nextRect.height,
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => {
            const movedPage =
              shouldApplyGroupedMove && moveMembers.length > 1
                ? applyMoveDeltaToPage(
                    entry,
                    moveMembers,
                    clampedDelta.deltaX,
                    clampedDelta.deltaY,
                  )
                : entry;
            return {
              ...movedPage,
              texts: movedPage.texts.map((text) =>
                text.id === input.textId
                  ? {
                      ...text,
                      ...(input.content !== undefined ? { content: input.content } : {}),
                      x: resolvedTextRect.x,
                      y: resolvedTextRect.y,
                      width: resolvedTextRect.width,
                      height: resolvedTextRect.height,
                      ...(input.fontSize !== undefined ? { fontSize: input.fontSize } : {}),
                      ...(input.fontFamily !== undefined ? { fontFamily: input.fontFamily } : {}),
                      ...(input.fontWeight !== undefined ? { fontWeight: input.fontWeight } : {}),
                      ...(input.letterSpacing !== undefined
                        ? { letterSpacing: input.letterSpacing }
                        : {}),
                      ...(input.lineSpacing !== undefined ? { lineSpacing: input.lineSpacing } : {}),
                      ...(input.color !== undefined ? { color: input.color } : {}),
                      ...(input.strokeWidth !== undefined ? { strokeWidth: input.strokeWidth } : {}),
                      ...(input.strokeColor !== undefined ? { strokeColor: input.strokeColor } : {}),
                      ...(input.direction !== undefined ? { direction: input.direction } : {}),
                      ...(nextTextAlign !== undefined ? { textAlign: nextTextAlign } : {}),
                      ...(input.verticalAlign !== undefined ? { verticalAlign: input.verticalAlign } : {}),
                    }
                  : text,
              ),
            };
          }),
        ),
      );
      context.setProject(nextProject);
      const updatedText = withPage(nextProject, input.pageId, (entry) =>
        entry.texts.find((text) => text.id === input.textId),
      );
      if (updatedText) {
        context.setSession((session) => ({
          textInsertDefaults: {
            ...session.textInsertDefaults,
            width: updatedText.width,
            height: updatedText.height,
            fontFamily: updatedText.fontFamily,
            fontSize: updatedText.fontSize,
            fontWeight: updatedText.fontWeight,
            letterSpacing: updatedText.letterSpacing,
            lineSpacing: updatedText.lineSpacing,
            strokeWidth: updatedText.strokeWidth,
            strokeColor: updatedText.strokeColor,
          },
        }));
      }
      return updatedText;
    },
  },
  createBubble: {
    id: "createBubble",
    label: "Create Bubble",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      showTail: z.boolean().optional(),
      bubbleType: bubbleTypeSchema.optional(),
      customPoints: z.array(pointSchema).optional(),
      customSmoothness: z.number().min(0).max(1).optional(),
      customPointSmoothness: z.array(z.number().min(0).max(1)).optional(),
      keepTool: z.boolean().optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const requestedWidth = input.width ?? 260;
      const requestedHeight = input.height ?? 150;
      const rect = clampBubbleRectToWorkspace(page, {
        x: input.x ?? page.width * 0.5 - requestedWidth * 0.5,
        y: input.y ?? page.height * 0.5 - requestedHeight * 0.5,
        width: requestedWidth,
        height: requestedHeight,
      });
      const tailTip = clampPointToWorkspace(page, {
        x: rect.x + rect.width * 0.5,
        y: rect.y + rect.height + 60,
      });
      const scaledCustomPoints =
        input.customPoints?.map((point: z.infer<typeof pointSchema>) => ({
          x: toMergePrecision(
            clamp(
              (point.x / Math.max(requestedWidth, MERGE_POINT_EPSILON)) * rect.width,
              0,
              rect.width,
            ),
          ),
          y: toMergePrecision(
            clamp(
              (point.y / Math.max(requestedHeight, MERGE_POINT_EPSILON)) * rect.height,
              0,
              rect.height,
            ),
          ),
        })) ?? [];
      const createdCustomSmoothness = clamp(input.customSmoothness ?? 0.45, 0, 1);
      const customPointSmoothness = resolveCustomPointSmoothness(
        scaledCustomPoints.length,
        createdCustomSmoothness,
        input.customPointSmoothness,
      );
      const bubble = {
        id: createId("bubble"),
        ...createDefaultBubble({
          ...rect,
          contentCenter: {
            x: rect.width * 0.5,
            y: rect.height * 0.5,
          },
          tailTip,
          ...(input.showTail !== undefined ? { showTail: input.showTail } : {}),
          ...(input.bubbleType ? { bubbleType: input.bubbleType } : {}),
          ...(input.customPoints ? { customPoints: scaledCustomPoints } : {}),
          ...(input.customPoints ? { customPointSmoothness } : {}),
          ...(input.customSmoothness !== undefined
            ? { customSmoothness: input.customSmoothness }
            : {}),
        }),
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            bubbles: [...entry.bubbles, bubble],
            layers: [...entry.layers, toLayerRef("bubble", bubble.id)],
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selection: {
          pageId: input.pageId,
          objectType: "bubble",
          objectId: bubble.id,
        },
        multiSelection: [
          {
            pageId: input.pageId,
            objectType: "bubble",
            objectId: bubble.id,
          },
        ],
        activeTool: input.keepTool ? context.getSession().activeTool : "select",
        statusMessage: createContextStatus(context, "success", "command.bubbleAdded"),
      });
      return bubble;
    },
  },
  updateBubble: {
    id: "updateBubble",
    label: "Update Bubble",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      bubbleId: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      contentCenter: pointSchema.optional(),
      showTail: z.boolean().optional(),
      tailTip: pointSchema.optional(),
      tailBase: pointSchema.optional(),
      tailBaseAngle: z.number().optional(),
      tailWidth: z.number().positive().optional(),
      bubbleType: bubbleTypeSchema.optional(),
      customPoints: z.array(pointSchema).optional(),
      customSmoothness: z.number().min(0).max(1).optional(),
      customPointSmoothness: z.array(z.number().min(0).max(1)).optional(),
      strokeWidth: z.number().nonnegative().optional(),
      backgroundColor: z.string().optional(),
      strokeColor: z.string().optional(),
      opacity: z.number().min(0).max(1).optional(),
      cornerRadius: z.number().nonnegative().optional(),
      bumpiness: z.number().min(0).max(1).optional(),
      spikeCount: z.number().int().min(4).max(16).optional(),
      spikeDepth: z.number().min(0.2).max(0.8).optional(),
      spikeDepths: z.array(z.number().min(0.1).max(1)).optional(),
      spikePositions: z.array(pointSchema).optional(),
      activeSpikeIndex: z.number().int().min(-1).max(15).optional(),
      jaggedness: z.number().min(2).max(12).optional(),
      thoughtCircles: z.number().int().min(2).max(5).optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const bubble = page.bubbles.find((entry) => entry.id === input.bubbleId);
      if (!bubble) {
        throw new Error(`Bubble not found: ${input.bubbleId}`);
      }
      const rect = clampBubbleRectToWorkspace(page, {
        x: input.x ?? bubble.x,
        y: input.y ?? bubble.y,
        width: input.width ?? bubble.width,
        height: input.height ?? bubble.height,
      });
      const shouldApplyGroupedMove =
        (input.x !== undefined || input.y !== undefined) &&
        input.width === undefined &&
        input.height === undefined;
      const moveMembers = shouldApplyGroupedMove
        ? getMoveMembersForObject(page, "bubble", input.bubbleId)
        : [{ objectType: "bubble" as const, objectId: input.bubbleId }];
      const requestedDelta = {
        x: rect.x - bubble.x,
        y: rect.y - bubble.y,
      };
      const clampedDelta = shouldApplyGroupedMove
        ? clampGroupMoveDelta(page, moveMembers, requestedDelta.x, requestedDelta.y)
        : {
            deltaX: requestedDelta.x,
            deltaY: requestedDelta.y,
          };
      const resolvedRect = {
        x: bubble.x + clampedDelta.deltaX,
        y: bubble.y + clampedDelta.deltaY,
        width: rect.width,
        height: rect.height,
      };
      const tailTip = input.tailTip
        ? clampPointToWorkspace(page, input.tailTip)
        : shouldApplyGroupedMove && moveMembers.length > 1
          ? {
              x: bubble.tailTip.x + clampedDelta.deltaX,
              y: bubble.tailTip.y + clampedDelta.deltaY,
            }
          : bubble.tailTip;
      const nextGeometryBubble = {
        ...bubble,
        ...resolvedRect,
        tailTip,
        ...(input.bubbleType !== undefined ? { bubbleType: input.bubbleType } : {}),
      };
      const resultingBubbleType = input.bubbleType ?? bubble.bubbleType;
      const shouldScaleCustomPoints =
        input.width !== undefined ||
        input.height !== undefined ||
        Math.abs(resolvedRect.width - bubble.width) > MERGE_POINT_EPSILON ||
        Math.abs(resolvedRect.height - bubble.height) > MERGE_POINT_EPSILON;
      const customPoints =
        input.customPoints !== undefined
          ? input.customPoints.map((point: z.infer<typeof pointSchema>) => ({
              x: toMergePrecision(clamp(point.x, 0, resolvedRect.width)),
              y: toMergePrecision(clamp(point.y, 0, resolvedRect.height)),
            }))
          : shouldScaleCustomPoints
            ? bubble.customPoints.map((point) => ({
                x: toMergePrecision(
                  clamp(
                    (point.x / Math.max(bubble.width, MERGE_POINT_EPSILON)) * resolvedRect.width,
                    0,
                    resolvedRect.width,
                  ),
                ),
                y: toMergePrecision(
                  clamp(
                    (point.y / Math.max(bubble.height, MERGE_POINT_EPSILON)) * resolvedRect.height,
                    0,
                    resolvedRect.height,
                  ),
                ),
              }))
            : bubble.customPoints.map((point) => ({ ...point }));
      const nextCustomSmoothness = clamp(
        input.customSmoothness ?? bubble.customSmoothness,
        0,
        1,
      );
      const pointSmoothnessSource =
        input.customPointSmoothness ??
        (input.customSmoothness !== undefined
          ? Array.from({ length: customPoints.length }, () => input.customSmoothness as number)
          : bubble.customPointSmoothness);
      const customPointSmoothness =
        resultingBubbleType === "custom"
          ? resolveCustomPointSmoothness(
              customPoints.length,
              nextCustomSmoothness,
              pointSmoothnessSource,
            )
          : [];
      const customHandleProfile =
        resultingBubbleType === "custom"
          ? sanitizeBubbleCustomHandleProfile(
              bubble.customHandleProfile,
              customPoints.length,
            )
          : undefined;
      const contentCenter =
        input.contentCenter !== undefined
          ? {
              x: clamp(input.contentCenter.x, 0, resolvedRect.width),
              y: clamp(input.contentCenter.y, 0, resolvedRect.height),
            }
          : input.width !== undefined || input.height !== undefined
            ? scaleBubbleLocalPoint(
                bubble.contentCenter,
                bubble.width,
                bubble.height,
                resolvedRect.width,
                resolvedRect.height,
              )
            : { ...bubble.contentCenter };
      const tailBaseSource =
        input.tailBase !== undefined
          ? input.tailBase
          : bubble.tailBase
            ? scaleBubbleLocalPoint(
                bubble.tailBase,
                bubble.width,
                bubble.height,
                resolvedRect.width,
                resolvedRect.height,
              )
            : undefined;
      const tailBase =
        tailBaseSource !== undefined
          ? clampBubbleTailBaseLocalPoint(nextGeometryBubble, tailBaseSource)
          : undefined;
      let tailBaseAngle = bubble.tailBaseAngle;
      if (tailBase !== undefined) {
        tailBaseAngle = getBubbleTailBaseAngleFromLocalPoint(nextGeometryBubble, tailBase);
      } else if (input.tailBaseAngle !== undefined) {
        tailBaseAngle = input.tailBaseAngle;
      }

      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => {
            const movedPage =
              shouldApplyGroupedMove && moveMembers.length > 1
                ? applyMoveDeltaToPage(
                    entry,
                    moveMembers,
                    clampedDelta.deltaX,
                    clampedDelta.deltaY,
                  )
                : entry;
            return {
              ...movedPage,
              bubbles: movedPage.bubbles.map((item) =>
                item.id === input.bubbleId
                  ? {
                      ...item,
                      ...resolvedRect,
                      contentCenter,
                      ...(input.showTail !== undefined ? { showTail: input.showTail } : {}),
                      tailTip,
                      ...(tailBase !== undefined ? { tailBase } : {}),
                      ...(tailBase !== undefined || input.tailBaseAngle !== undefined
                        ? { tailBaseAngle }
                        : {}),
                      ...(input.tailWidth !== undefined ? { tailWidth: input.tailWidth } : {}),
                      ...(input.bubbleType !== undefined ? { bubbleType: input.bubbleType } : {}),
                      ...(input.customPoints !== undefined || input.width !== undefined || input.height !== undefined
                        ? { customPoints }
                        : {}),
                      ...(resultingBubbleType === "custom"
                        ? { customPointSmoothness }
                        : { customPointSmoothness: [] }),
                      ...(resultingBubbleType === "custom"
                        ? { customHandleProfile }
                        : { customHandleProfile: undefined }),
                      ...(input.customSmoothness !== undefined
                        ? { customSmoothness: input.customSmoothness }
                        : {}),
                      ...(input.strokeWidth !== undefined ? { strokeWidth: input.strokeWidth } : {}),
                      ...(input.backgroundColor !== undefined ? { backgroundColor: input.backgroundColor } : {}),
                      ...(input.strokeColor !== undefined ? { strokeColor: input.strokeColor } : {}),
                      ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
                      ...(input.cornerRadius !== undefined ? { cornerRadius: input.cornerRadius } : {}),
                      ...(input.bumpiness !== undefined ? { bumpiness: input.bumpiness } : {}),
                      ...(input.spikeCount !== undefined ? { spikeCount: input.spikeCount } : {}),
                      ...(input.spikeDepth !== undefined ? { spikeDepth: input.spikeDepth } : {}),
                      ...(input.spikeDepths !== undefined ? { spikeDepths: input.spikeDepths } : {}),
                      ...(input.spikePositions !== undefined ? { spikePositions: input.spikePositions } : {}),
                      ...(input.activeSpikeIndex !== undefined ? { activeSpikeIndex: input.activeSpikeIndex } : {}),
                      ...(input.jaggedness !== undefined ? { jaggedness: input.jaggedness } : {}),
                      ...(input.thoughtCircles !== undefined ? { thoughtCircles: input.thoughtCircles } : {}),
                    }
                  : item,
              ),
            };
          }),
        ),
      );
      context.setProject(nextProject);
      const updatedBubble = withPage(nextProject, input.pageId, (entry) =>
        entry.bubbles.find((item) => item.id === input.bubbleId),
      );
      return updatedBubble;
    },
  },
  deleteObject: {
    id: "deleteObject",
    label: "Delete Object",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      objectType: objectTypeSchema,
      objectId: z.string(),
    }),
    execute: (context, input) => {
      assertObjectExists(context.getProject(), input.pageId, input.objectType, input.objectId);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => {
            const nextPage = {
              ...entry,
              panels:
                input.objectType === "panel"
                  ? entry.panels.filter((item) => item.id !== input.objectId)
                  : entry.panels,
              texts:
                input.objectType === "text"
                  ? entry.texts.filter((item) => item.id !== input.objectId)
                  : entry.texts,
              elements:
                input.objectType === "element"
                  ? (entry.elements ?? []).filter((item) => item.id !== input.objectId)
                  : (entry.elements ?? []),
              bubbles:
                input.objectType === "bubble"
                  ? entry.bubbles.filter((item) => item.id !== input.objectId)
                  : entry.bubbles,
              layers: removeLayerRef(entry.layers, input.objectType, input.objectId),
            };
            return {
              ...nextPage,
              groups: sanitizeGroupList(nextPage, nextPage.groups),
            };
          }),
        ),
      );
      context.setProject(nextProject);
      const session = context.getSession();
      const nextMultiSelection = session.multiSelection.filter(
        (entry) =>
          !(
            entry.pageId === input.pageId &&
            entry.objectType === input.objectType &&
            entry.objectId === input.objectId
          ),
      );
      const nextSelection = nextMultiSelection[0] ?? null;
      context.setSession({
        selection: nextSelection,
        multiSelection: nextMultiSelection,
        panelImageEditing: nextSelection ? session.panelImageEditing : null,
      });
      context.setSession({
        statusMessage: createContextStatus(context, "info", "command.objectRemoved"),
      });
      return {
        objectType: input.objectType,
        objectId: input.objectId,
      };
    },
  },
  exportPagePng: {
    id: "exportPagePng",
    label: "Export Page PNG",
    inputSchema: z.object({
      pageId: z.string(),
    }),
    execute: async (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const dataUrl = await renderPageToPngDataUrl(page);
      const artifact = {
        kind: "png" as const,
        fileName: `${sanitizeFileName(page.name)}.png`,
        dataUrl,
        pageId: page.id,
      };
      context.setSession({
        lastExport: artifact,
        statusMessage: createContextStatus(context, "success", "command.exportReady", {
          fileName: artifact.fileName,
        }),
      });
      return artifact;
    },
  },
  exportProjectPdf: {
    id: "exportProjectPdf",
    label: "Export Project PDF",
    inputSchema: z.object({}),
    execute: async (context) => {
      const project = context.getProject();
      const dataUrl = await renderProjectToPdfDataUrl(project.pages);
      const artifact = {
        kind: "pdf" as const,
        fileName: `${sanitizeFileName(project.title || "mangamaker-project")}.pdf`,
        dataUrl,
        pageCount: project.pages.length,
      };
      context.setSession({
        lastExport: artifact,
        statusMessage: createContextStatus(context, "success", "command.exportReady", {
          fileName: artifact.fileName,
        }),
      });
      return artifact;
    },
  },
  exportProjectJpgZip: {
    id: "exportProjectJpgZip",
    label: "Export Project JPG ZIP",
    inputSchema: z.object({}),
    execute: async (context) => {
      const project = context.getProject();
      const dataUrl = await renderProjectToJpgZipDataUrl(project.pages);
      const artifact = {
        kind: "jpgZip" as const,
        fileName: `${sanitizeFileName(project.title || "mangamaker-project")}-jpg-pages.zip`,
        dataUrl,
        pageCount: project.pages.length,
      };
      context.setSession({
        lastExport: artifact,
        statusMessage: createContextStatus(context, "success", "command.exportReady", {
          fileName: artifact.fileName,
        }),
      });
      return artifact;
    },
  },
} satisfies Record<string, CommandDefinition>;

export const commandRegistry = commands;
