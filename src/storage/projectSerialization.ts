import type { Bubble, Group, Page, Panel, Project, TextItem } from "../domain/schema";

const DEFAULT_PROJECT_TYPE = "manga";
const DEFAULT_PAGE_BACKGROUND = "#ffffff";

const DEFAULT_TEXT = {
  width: 360,
  height: 360,
  fontWeight: 400,
  letterSpacing: 0,
  lineSpacing: 0,
  strokeWidth: 2,
  strokeColor: "#ffffff",
  direction: "vertical",
  textAlign: "left",
  verticalAlign: "top",
} as const;

const DEFAULT_BUBBLE = {
  contentCenter: { x: 130, y: 75 },
  showTail: true,
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
  activeSpikeIndex: -1,
  jaggedness: 6,
  thoughtCircles: 3,
  customSmoothness: 0.45,
  customPointSmoothness: [],
} as const;

const isDefaultRectanglePanel = (panel: Panel) => {
  if (panel.points.length !== 4) {
    return false;
  }
  return (
    panel.points[0].x === 0 &&
    panel.points[0].y === 0 &&
    panel.points[1].x === panel.width &&
    panel.points[1].y === 0 &&
    panel.points[2].x === panel.width &&
    panel.points[2].y === panel.height &&
    panel.points[3].x === 0 &&
    panel.points[3].y === panel.height
  );
};

const compactPanel = (panel: Panel) => ({
  id: panel.id,
  x: panel.x,
  y: panel.y,
  width: panel.width,
  height: panel.height,
  style: panel.style,
  ...(panel.rotation !== 0 ? { rotation: panel.rotation } : {}),
  ...(isDefaultRectanglePanel(panel) ? {} : { points: panel.points }),
  ...(panel.image ? { image: panel.image } : {}),
  ...(panel.description.trim().length > 0 ? { description: panel.description } : {}),
});

const compactText = (text: TextItem) => ({
  id: text.id,
  x: text.x,
  y: text.y,
  content: text.content,
  fontSize: text.fontSize,
  fontFamily: text.fontFamily,
  color: text.color,
  ...(text.width !== DEFAULT_TEXT.width ? { width: text.width } : {}),
  ...(text.height !== DEFAULT_TEXT.height ? { height: text.height } : {}),
  ...(text.fontWeight !== DEFAULT_TEXT.fontWeight ? { fontWeight: text.fontWeight } : {}),
  ...(text.letterSpacing !== DEFAULT_TEXT.letterSpacing
    ? { letterSpacing: text.letterSpacing }
    : {}),
  ...(text.lineSpacing !== DEFAULT_TEXT.lineSpacing ? { lineSpacing: text.lineSpacing } : {}),
  ...(text.strokeWidth !== DEFAULT_TEXT.strokeWidth ? { strokeWidth: text.strokeWidth } : {}),
  ...(text.strokeColor !== DEFAULT_TEXT.strokeColor ? { strokeColor: text.strokeColor } : {}),
  ...(text.direction !== DEFAULT_TEXT.direction ? { direction: text.direction } : {}),
  ...(text.textAlign !== DEFAULT_TEXT.textAlign ? { textAlign: text.textAlign } : {}),
  ...(text.verticalAlign !== DEFAULT_TEXT.verticalAlign ? { verticalAlign: text.verticalAlign } : {}),
});

const compactBubble = (bubble: Bubble) => ({
  id: bubble.id,
  x: bubble.x,
  y: bubble.y,
  width: bubble.width,
  height: bubble.height,
  contentCenter: bubble.contentCenter,
  tailTip: bubble.tailTip,
  ...(bubble.showTail !== DEFAULT_BUBBLE.showTail ? { showTail: bubble.showTail } : {}),
  ...(bubble.tailBase ? { tailBase: bubble.tailBase } : {}),
  ...(bubble.tailBaseAngle !== DEFAULT_BUBBLE.tailBaseAngle
    ? { tailBaseAngle: bubble.tailBaseAngle }
    : {}),
  ...(bubble.tailWidth !== DEFAULT_BUBBLE.tailWidth ? { tailWidth: bubble.tailWidth } : {}),
  ...(bubble.bubbleType !== DEFAULT_BUBBLE.bubbleType ? { bubbleType: bubble.bubbleType } : {}),
  ...(bubble.strokeWidth !== DEFAULT_BUBBLE.strokeWidth ? { strokeWidth: bubble.strokeWidth } : {}),
  ...(bubble.backgroundColor !== DEFAULT_BUBBLE.backgroundColor
    ? { backgroundColor: bubble.backgroundColor }
    : {}),
  ...(bubble.strokeColor !== DEFAULT_BUBBLE.strokeColor ? { strokeColor: bubble.strokeColor } : {}),
  ...(bubble.opacity !== DEFAULT_BUBBLE.opacity ? { opacity: bubble.opacity } : {}),
  ...(bubble.cornerRadius !== DEFAULT_BUBBLE.cornerRadius
    ? { cornerRadius: bubble.cornerRadius }
    : {}),
  ...(bubble.bumpiness !== DEFAULT_BUBBLE.bumpiness ? { bumpiness: bubble.bumpiness } : {}),
  ...(bubble.spikeCount !== DEFAULT_BUBBLE.spikeCount ? { spikeCount: bubble.spikeCount } : {}),
  ...(bubble.spikeDepth !== DEFAULT_BUBBLE.spikeDepth ? { spikeDepth: bubble.spikeDepth } : {}),
  ...(bubble.spikeDepths && bubble.spikeDepths.length > 0
    ? { spikeDepths: bubble.spikeDepths }
    : {}),
  ...(bubble.spikePositions && bubble.spikePositions.length > 0
    ? { spikePositions: bubble.spikePositions }
    : {}),
  ...(bubble.activeSpikeIndex !== DEFAULT_BUBBLE.activeSpikeIndex
    ? { activeSpikeIndex: bubble.activeSpikeIndex }
    : {}),
  ...(bubble.jaggedness !== DEFAULT_BUBBLE.jaggedness ? { jaggedness: bubble.jaggedness } : {}),
  ...(bubble.thoughtCircles !== DEFAULT_BUBBLE.thoughtCircles
    ? { thoughtCircles: bubble.thoughtCircles }
    : {}),
  ...(bubble.customPoints.length > 0 ? { customPoints: bubble.customPoints } : {}),
  ...(bubble.customSmoothness !== DEFAULT_BUBBLE.customSmoothness
    ? { customSmoothness: bubble.customSmoothness }
    : {}),
  ...(bubble.customPointSmoothness.length > 0
    ? { customPointSmoothness: bubble.customPointSmoothness }
    : {}),
  ...(bubble.customHandleProfile &&
  (bubble.customHandleProfile.movableIndices.length > 0 ||
    bubble.customHandleProfile.lockedIndices.length > 0)
    ? { customHandleProfile: bubble.customHandleProfile }
    : {}),
});

const compactGroup = (group: Group) => ({
  id: group.id,
  members: group.members,
});

const compactPage = (page: Page) => ({
  id: page.id,
  name: page.name,
  width: page.width,
  height: page.height,
  panels: page.panels.map(compactPanel),
  texts: page.texts.map(compactText),
  bubbles: page.bubbles.map(compactBubble),
  ...(page.groups.length > 0 ? { groups: page.groups.map(compactGroup) } : {}),
  layers: page.layers,
  ...(page.background !== DEFAULT_PAGE_BACKGROUND ? { background: page.background } : {}),
});

export const serializeProjectForStorage = (project: Project) =>
  JSON.stringify({
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    pages: project.pages.map(compactPage),
    ...(project.type !== DEFAULT_PROJECT_TYPE ? { type: project.type } : {}),
  });
