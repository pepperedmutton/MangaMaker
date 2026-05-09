import type { Bubble, ElementItem, Page, PanelStyle, Point, Project, ProjectType, TextItem } from "./schema";
import { DEFAULT_TEXT_FONT_FAMILY } from "../platform/localFonts";

export const GRID_SIZE = 20;
export const MOVE_SNAP_SIZE = 1;
export const MIN_PANEL_SIZE = 160;
export const MIN_BUBBLE_WIDTH = 180;
export const MIN_BUBBLE_HEIGHT = 120;
export const MIN_TEXT_BOX_WIDTH = 100;
export const MIN_TEXT_BOX_HEIGHT = 120;
export const MANGA_PAGE_WIDTH = 1200;
export const MANGA_PAGE_HEIGHT = 1700;
export const CG_PAGE_WIDTH = 1200;
export const CG_PAGE_HEIGHT = 1600;
export const DEFAULT_PAGE_WIDTH = MANGA_PAGE_WIDTH;
export const DEFAULT_PAGE_HEIGHT = MANGA_PAGE_HEIGHT;
export const WORKSPACE_PAGE_AREA_RATIO = 0.1;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;
export const DEFAULT_ZOOM = 1;
export const ZOOM_STEP = 0.01;
export const DEFAULT_TEXT_INSERT_DEFAULTS = {
  width: 360,
  height: 360,
  fontSize: 36,
  fontFamily: DEFAULT_TEXT_FONT_FAMILY,
  fontWeight: 400,
  letterSpacing: 0,
  lineSpacing: 0,
  strokeWidth: 2,
  strokeColor: "#ffffff",
} as const;

const now = () => new Date().toISOString();

export const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

export const createDefaultPanelStyle = (): PanelStyle => ({
  fill: "#fffdf8",
  stroke: "#111111",
  strokeWidth: 4,
  cornerRadius: 12,
});

export const createRectanglePanelPoints = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const getDefaultPageSize = (projectType: ProjectType) =>
  projectType === "cg"
    ? {
        width: CG_PAGE_WIDTH,
        height: CG_PAGE_HEIGHT,
      }
    : {
        width: MANGA_PAGE_WIDTH,
        height: MANGA_PAGE_HEIGHT,
      };

export const createBlankProject = (title = "", type: ProjectType = "manga"): Project => ({
  id: createId("project"),
  title,
  type,
  createdAt: now(),
  updatedAt: now(),
  pages: [],
});

export const createDefaultPage = (index: number, projectType: ProjectType = "manga"): Page => ({
  ...getDefaultPageSize(projectType),
  id: createId("page"),
  name: `Page ${index + 1}`,
  background: "#ffffff",
  panels: [],
  texts: [],
  bubbles: [],
  elements: [],
  groups: [],
  layers: [],
});

export const createDefaultText = (
  overrides: Partial<Omit<TextItem, "id">> = {},
): Omit<TextItem, "id"> => ({
  x: 120,
  y: 120,
  width: DEFAULT_TEXT_INSERT_DEFAULTS.width,
  height: DEFAULT_TEXT_INSERT_DEFAULTS.height,
  content: "Type here",
  fontSize: DEFAULT_TEXT_INSERT_DEFAULTS.fontSize,
  fontFamily: DEFAULT_TEXT_INSERT_DEFAULTS.fontFamily,
  fontWeight: DEFAULT_TEXT_INSERT_DEFAULTS.fontWeight,
  letterSpacing: DEFAULT_TEXT_INSERT_DEFAULTS.letterSpacing,
  lineSpacing: DEFAULT_TEXT_INSERT_DEFAULTS.lineSpacing,
  strokeWidth: DEFAULT_TEXT_INSERT_DEFAULTS.strokeWidth,
  strokeColor: DEFAULT_TEXT_INSERT_DEFAULTS.strokeColor,
  color: "#121212",
  direction: "vertical",
  textAlign: "center",
  verticalAlign: "top",
  ...overrides,
});

export const createDefaultElement = (
  overrides: Partial<Omit<ElementItem, "id">> = {},
): Omit<ElementItem, "id"> => ({
  x: 160,
  y: 160,
  width: 240,
  height: 180,
  rotation: 0,
  src: "",
  title: "Element",
  category: "symbols",
  opacity: 1,
  ...overrides,
});

export const createDefaultBubble = (
  overrides: Partial<Omit<Bubble, "id">> = {},
): Omit<Bubble, "id"> => ({
  x: 180,
  y: 180,
  width: 260,
  height: 150,
  contentCenter: { x: 130, y: 75 },
  showTail: true,
  tailTip: { x: 310, y: 390 },
  tailBaseAngle: 90,
  tailWidth: 24,
  bubbleType: "round",
  strokeWidth: 2,
  backgroundColor: "#ffffff",
  strokeColor: "#111111",
  opacity: 1,
  cornerRadius: 12,
  bumpiness: 0.5,
  spikeCount: 8,
  spikeDepth: 0.5,
  spikeDepths: [],
  spikePositions: [],
  activeSpikeIndex: -1,
  jaggedness: 6,
  thoughtCircles: 3,
  customPoints: [],
  customSmoothness: 0.45,
  customPointSmoothness: [],
  customHandleProfile: undefined,
  ...overrides,
});

export const clonePage = (page: Page): Page => {
  const panelIdMap = new Map<string, string>();
  const textIdMap = new Map<string, string>();
  const bubbleIdMap = new Map<string, string>();
  const elementIdMap = new Map<string, string>();

  const panels = page.panels.map((panel) => {
    const id = createId("panel");
    panelIdMap.set(panel.id, id);
    return {
      ...panel,
      id,
      points: panel.points.map((point) => ({ ...point })),
      image: panel.image ? { ...panel.image, viewBox: { ...panel.image.viewBox } } : null,
    };
  });

  const texts = page.texts.map((text) => {
    const id = createId("text");
    textIdMap.set(text.id, id);
    return {
      ...text,
      id,
    };
  });

  const bubbles = page.bubbles.map((bubble) => {
    const id = createId("bubble");
    bubbleIdMap.set(bubble.id, id);
    return {
      ...bubble,
      id,
      contentCenter: { ...bubble.contentCenter },
      tailTip: { ...bubble.tailTip },
      ...(bubble.tailBase ? { tailBase: { ...bubble.tailBase } } : {}),
      customPoints: bubble.customPoints.map((point) => ({ ...point })),
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
  });

  const elements = (page.elements ?? []).map((element) => {
    const id = createId("element");
    elementIdMap.set(element.id, id);
    return {
      ...element,
      id,
    };
  });

  const groups = page.groups
    .map((group) => ({
      ...group,
      id: createId("group"),
      members: group.members
        .map((member) => {
          if (member.objectType === "panel") {
            const mappedId = panelIdMap.get(member.objectId);
            return mappedId
              ? {
                  objectType: "panel" as const,
                  objectId: mappedId,
                }
              : null;
          }
          if (member.objectType === "text") {
            const mappedId = textIdMap.get(member.objectId);
            return mappedId
              ? {
                  objectType: "text" as const,
                  objectId: mappedId,
                }
              : null;
          }
          if (member.objectType === "element") {
            const mappedId = elementIdMap.get(member.objectId);
            return mappedId
              ? {
                  objectType: "element" as const,
                  objectId: mappedId,
                }
              : null;
          }
          const mappedId = bubbleIdMap.get(member.objectId);
          return mappedId
            ? {
                objectType: "bubble" as const,
                objectId: mappedId,
              }
            : null;
        })
        .filter((member): member is { objectType: "panel" | "text" | "bubble" | "element"; objectId: string } =>
          member !== null,
        ),
    }))
    .filter((group) => group.members.length >= 2);

  return {
    ...page,
    id: createId("page"),
    name: `${page.name} Copy`,
    panels,
    texts,
    bubbles,
    elements,
    groups,
    layers: page.layers.map((layer) => {
      if (layer.startsWith("panel:")) {
        return `panel:${panelIdMap.get(layer.slice("panel:".length)) ?? layer.slice("panel:".length)}`;
      }
      if (layer.startsWith("text:")) {
        return `text:${textIdMap.get(layer.slice("text:".length)) ?? layer.slice("text:".length)}`;
      }
      if (layer.startsWith("bubble:")) {
        return `bubble:${bubbleIdMap.get(layer.slice("bubble:".length)) ?? layer.slice("bubble:".length)}`;
      }
      if (layer.startsWith("element:")) {
        return `element:${elementIdMap.get(layer.slice("element:".length)) ?? layer.slice("element:".length)}`;
      }
      return layer;
    }),
  };
};
