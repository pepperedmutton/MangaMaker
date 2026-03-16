import type { Bubble, Page, PanelStyle, Point, Project, TextItem } from "./schema";

export const GRID_SIZE = 20;
export const MIN_PANEL_SIZE = 160;
export const MIN_BUBBLE_WIDTH = 180;
export const MIN_BUBBLE_HEIGHT = 120;
export const MIN_TEXT_BOX_WIDTH = 100;
export const MIN_TEXT_BOX_HEIGHT = 120;
export const DEFAULT_PAGE_WIDTH = 1200;
export const DEFAULT_PAGE_HEIGHT = 1700;
export const WORKSPACE_PAGE_AREA_RATIO = 0.25;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const DEFAULT_ZOOM = 1;
export const ZOOM_STEP = 0.01;

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

export const createBlankProject = (title = ""): Project => ({
  id: createId("project"),
  title,
  createdAt: now(),
  updatedAt: now(),
  pages: [],
});

export const createDefaultPage = (index: number): Page => ({
  id: createId("page"),
  name: `Page ${index + 1}`,
  width: DEFAULT_PAGE_WIDTH,
  height: DEFAULT_PAGE_HEIGHT,
  background: "#ffffff",
  panels: [],
  texts: [],
  bubbles: [],
  layers: [],
});

export const createDefaultText = (
  overrides: Partial<Omit<TextItem, "id">> = {},
): Omit<TextItem, "id"> => ({
  x: 120,
  y: 120,
  width: 360,
  height: 360,
  content: "Type here",
  fontSize: 36,
  fontFamily: "Georgia",
  color: "#121212",
  direction: "horizontal",
  textAlign: "left",
  verticalAlign: "top",
  ...overrides,
});

export const createDefaultBubble = (
  overrides: Partial<Omit<Bubble, "id">> = {},
): Omit<Bubble, "id"> => ({
  x: 180,
  y: 180,
  width: 260,
  height: 150,
  tailTip: { x: 310, y: 390 },
  tailBaseAngle: 90,
  tailWidth: 24,
  text: "Dialogue",
  fontSize: 26,
  fontFamily: "system-ui",
  textAlign: "center",
  verticalAlign: "middle",
  bubbleType: "round",
  strokeWidth: 2,
  backgroundColor: "#ffffff",
  strokeColor: "#111111",
  cornerRadius: 12,
  bumpiness: 0.5,
  spikeCount: 8,
  spikeDepth: 0.5,
  jaggedness: 6,
  thoughtCircles: 3,
  ...overrides,
});

export const clonePage = (page: Page): Page => {
  const panelIdMap = new Map<string, string>();
  const textIdMap = new Map<string, string>();
  const bubbleIdMap = new Map<string, string>();

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
      tailTip: { ...bubble.tailTip },
    };
  });

  return {
    ...page,
    id: createId("page"),
    name: `${page.name} Copy`,
    panels,
    texts,
    bubbles,
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
      return layer;
    }),
  };
};
