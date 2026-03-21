import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT_BODY_TRANSLATIONS } from "./yukinoPromptTranslations.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");

const storyboardSourcePath = path.join(workspaceRoot, "漫画大纲.source.md");
const storyboardOutputPath = path.join(workspaceRoot, "漫画大纲.md");
const outputPath = path.join(projectRoot, "src", "generated", "yukinoProject.json");

const PAGE_WIDTH = 1200;
const PAGE_HEIGHT = 1700;
const PAGE_AREA = PAGE_WIDTH * PAGE_HEIGHT;
const TARGET_TITLE = "雪之下漫画";
const EPSILON = 0.001;
const PANEL_DESCRIPTION_MODE = process.env.PANEL_DESCRIPTION_MODE ?? "human_zh";

const PANEL_STYLE = {
  fill: "#fffdf8",
  stroke: "#111111",
  strokeWidth: 4,
  cornerRadius: 12,
};

const SHOT_PREFIXES = [
  ["幻想远景", "fantasy long shot, single static shot, "],
  ["幻想中景", "fantasy medium shot, single static shot, "],
  ["幻想特写", "fantasy close-up, single static shot, "],
  ["横大格", "wide cinematic static shot, "],
  ["竖大格", "tall vertical static shot, "],
  ["动作格", "action still frame, "],
  ["收束格", "tight static closing shot, "],
  ["收尾格", "final static shot, "],
  ["音效格", "visual emphasis in a static shot, "],
  ["远景", "long shot, single static shot, "],
  ["中景", "medium shot, single static shot, "],
  ["近景", "close shot, single static shot, "],
  ["特写", "extreme close-up, single static shot, "],
];

const GLOBAL_PROMPT_STYLE =
  "full-color anime illustration, polished clean line art, rich cel shading, vivid but controlled color palette, cinematic lighting, detailed background, self-contained standalone image, complete scene description, single frozen moment, static shot, clear cinematic composition";

const YUKINO_BASE_PROMPT =
  "Yukino Yukinoshita, Japanese high school girl, pale cool-toned skin, grey-blue eyes, long straight black hair, slim but strong build, calm restrained expression";

const YUKINO_BATTLE_LOOK_PROMPT =
  "first battle look, short deep navy wool coat worn open, pure black turtleneck knit top, dark charcoal pleated skirt, black tights, black ankle boots, cold blue flame attached only to fingers, backs of hands, outer wrists, and heels, no transformation";

const YUKINO_SCHOOL_LOOK_PROMPT =
  "Sobu High winter school uniform, black blazer, white shirt, dark gray V-neck knit vest, slim red-and-black necktie, black pleated skirt, black over-the-knee socks, dark loafers";

const YUKINO_WEEKEND_LOOK_PROMPT =
  "weekend private outfit, cream turtleneck knit top, light gray-blue mid-length wool coat, dark charcoal A-line skirt, black tights, black Chelsea boots, small dark gray shoulder bag, outfit unchanged during combat";

const YUI_PROMPT =
  "Yui Yuigahama, Japanese high school girl, soft warm light-brown medium-length hair with fluffy ends, side hair clip, bright warm expression, school uniform styled more casually than Yukino Yukinoshita's";

const HACHIMAN_PROMPT =
  "Hachiman Hikigaya, Japanese high school boy, messy short black hair, tired dead-fish-eye expression, Sobu High boys' winter uniform";

const MOONBITE_PROMPT =
  "the werewolf, a tall lean wolf-like monster, coarse dark fur, golden beast eyes, narrow snout, sharp long claws, movement like a large predator";

const CREATURE_PROMPT =
  "black aberrant monster, twisted limbs, sharp claws, inhuman silhouette, as if grown out of shadow";

const SHADOW_CREATURE_PROMPT =
  "black viscous shadow creature gathering itself into shape in darkness, sticky edges, unstable form";

const point = (x, y) => ({ x, y });
const FULL_PAGE = [point(0, 0), point(PAGE_WIDTH, 0), point(PAGE_WIDTH, PAGE_HEIGHT), point(0, PAGE_HEIGHT)];

const pad2 = (value) => String(value).padStart(2, "0");

function normalizeNumber(value) {
  return Math.round(value * 1000000) / 1000000;
}

function normalizePoint(entry) {
  return {
    x: normalizeNumber(entry.x),
    y: normalizeNumber(entry.y),
  };
}

function distanceSquared(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function polygonArea(points) {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += current.x * next.y - next.x * current.y;
  }
  return Math.abs(total) / 2;
}

function getBounds(points) {
  const xs = points.map((entry) => entry.x);
  const ys = points.map((entry) => entry.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function clonePolygon(polygon) {
  return polygon.map((entry) => ({ ...entry }));
}

function cleanupPolygon(polygon) {
  const deduped = [];

  for (const entry of polygon.map(normalizePoint)) {
    if (deduped.length === 0 || distanceSquared(deduped[deduped.length - 1], entry) > 1) {
      deduped.push(entry);
    }
  }

  if (deduped.length > 1 && distanceSquared(deduped[0], deduped[deduped.length - 1]) <= 1) {
    deduped.pop();
  }

  if (deduped.length <= 3) {
    return deduped;
  }

  const reduced = [];
  for (let index = 0; index < deduped.length; index += 1) {
    const previous = deduped[(index - 1 + deduped.length) % deduped.length];
    const current = deduped[index];
    const next = deduped[(index + 1) % deduped.length];
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);

    if (Math.abs(cross) > 0.5 || reduced.length < 2) {
      reduced.push(current);
    }
  }

  return reduced;
}

function lineSide(target, lineStart, lineEnd) {
  return (
    (lineEnd.x - lineStart.x) * (target.y - lineStart.y) -
    (lineEnd.y - lineStart.y) * (target.x - lineStart.x)
  );
}

function intersectSegmentWithLine(segmentStart, segmentEnd, lineStart, lineEnd) {
  const segmentVector = {
    x: segmentEnd.x - segmentStart.x,
    y: segmentEnd.y - segmentStart.y,
  };
  const lineVector = {
    x: lineEnd.x - lineStart.x,
    y: lineEnd.y - lineStart.y,
  };
  const denominator = segmentVector.x * lineVector.y - segmentVector.y * lineVector.x;

  if (Math.abs(denominator) <= EPSILON) {
    return normalizePoint(segmentStart);
  }

  const numerator =
    (lineStart.x - segmentStart.x) * lineVector.y -
    (lineStart.y - segmentStart.y) * lineVector.x;
  const t = numerator / denominator;

  return normalizePoint({
    x: segmentStart.x + segmentVector.x * t,
    y: segmentStart.y + segmentVector.y * t,
  });
}

function clipPolygonToHalfPlane(polygon, lineStart, lineEnd, keepPositive) {
  const output = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentSide = lineSide(current, lineStart, lineEnd);
    const nextSide = lineSide(next, lineStart, lineEnd);
    const currentInside = keepPositive ? currentSide >= -EPSILON : currentSide <= EPSILON;
    const nextInside = keepPositive ? nextSide >= -EPSILON : nextSide <= EPSILON;

    if (currentInside && nextInside) {
      output.push(next);
      continue;
    }

    if (currentInside && !nextInside) {
      output.push(intersectSegmentWithLine(current, next, lineStart, lineEnd));
      continue;
    }

    if (!currentInside && nextInside) {
      output.push(intersectSegmentWithLine(current, next, lineStart, lineEnd));
      output.push(next);
    }
  }

  return cleanupPolygon(output);
}

function splitPolygon(polygon, lineStart, lineEnd) {
  const positive = clipPolygonToHalfPlane(polygon, lineStart, lineEnd, true);
  const negative = clipPolygonToHalfPlane(polygon, lineStart, lineEnd, false);

  if (positive.length < 3 || negative.length < 3) {
    throw new Error("Failed to split polygon into two valid pieces.");
  }

  return [positive, negative];
}

function compareTopFirst(left, right) {
  return getBounds(left).minY - getBounds(right).minY;
}

function compareReadingOrder(left, right) {
  const leftBounds = getBounds(left);
  const rightBounds = getBounds(right);

  if (Math.abs(leftBounds.minY - rightBounds.minY) > 120) {
    return leftBounds.minY - rightBounds.minY;
  }

  return leftBounds.minX - rightBounds.minX;
}

function validateLayout(layout) {
  if (layout.positionLabels.length !== layout.panels.length) {
    throw new Error(`Layout ${layout.key} position labels do not match panel count.`);
  }

  const area = layout.panels.reduce((sum, panel) => sum + polygonArea(panel), 0);
  if (Math.abs(area - PAGE_AREA) > 0.2) {
    throw new Error(`Layout ${layout.key} does not cover the full page.`);
  }

  layout.panels.forEach((panel) => {
    if (panel.length < 3) {
      throw new Error(`Layout ${layout.key} contains an invalid polygon.`);
    }

    panel.forEach((entry) => {
      if (
        entry.x < -EPSILON ||
        entry.x > PAGE_WIDTH + EPSILON ||
        entry.y < -EPSILON ||
        entry.y > PAGE_HEIGHT + EPSILON
      ) {
        throw new Error(`Layout ${layout.key} contains points outside the page.`);
      }
    });
  });

  return layout;
}

function createLayout(key, strategyName, positionLabels, panels) {
  return validateLayout({
    key,
    strategyName,
    positionLabels,
    panels,
  });
}

function splitPanels(panels, targetIndex, lineStart, lineEnd, sortFn) {
  const nextPanels = panels.map(clonePolygon);
  const pieces = splitPolygon(nextPanels[targetIndex], lineStart, lineEnd).sort(sortFn);

  return [
    ...nextPanels.slice(0, targetIndex),
    ...pieces,
    ...nextPanels.slice(targetIndex + 1),
  ];
}

function createBandLayout(key, strategyName, seamPoints, positionLabels) {
  const seam = seamPoints.map(normalizePoint);
  const topPanel = [point(0, 0), point(PAGE_WIDTH, 0), ...seam.slice().reverse()];
  const bottomPanel = [...seam, point(PAGE_WIDTH, PAGE_HEIGHT), point(0, PAGE_HEIGHT)];
  return createLayout(key, strategyName, positionLabels, [topPanel, bottomPanel]);
}

function createVerticalLayout(key, strategyName, seamPoints, positionLabels) {
  const seam = seamPoints.map(normalizePoint);
  const leftPanel = [point(0, 0), seam[0], ...seam.slice(1), point(0, PAGE_HEIGHT)];
  const rightPanel = [
    seam[0],
    point(PAGE_WIDTH, 0),
    point(PAGE_WIDTH, PAGE_HEIGHT),
    seam[seam.length - 1],
    ...seam.slice(1, -1).reverse(),
  ];
  return createLayout(key, strategyName, positionLabels, [leftPanel, rightPanel]);
}

function createDerivedLayout(key, strategyName, positionLabels, basePanels, operations) {
  let panels = basePanels.map(clonePolygon);

  operations.forEach((operation) => {
    panels = splitPanels(
      panels,
      operation.targetIndex,
      operation.lineStart,
      operation.lineEnd,
      operation.sortFn,
    );
  });

  return createLayout(key, strategyName, positionLabels, panels);
}

const layoutCatalog = new Map();

function registerLayout(layout) {
  layoutCatalog.set(layout.key, layout);
  return layout;
}

registerLayout(
  createLayout(
    "splash-1",
    "单页大格",
    ["单页大格，占满全页"],
    [clonePolygon(FULL_PAGE)],
  ),
);

const twoH1 = registerLayout(
  createBandLayout(
    "two-h1",
    "折线横分 / 上大下大",
    [point(0, 760), point(320, 630), point(860, 850), point(1200, 700)],
    ["上方折线大格", "下方主体大格"],
  ),
);
const twoH2 = registerLayout(
  createBandLayout(
    "two-h2",
    "折线横分 / 上窄下宽",
    [point(0, 610), point(280, 760), point(760, 560), point(1200, 740)],
    ["上方折线大格", "下方主体大格"],
  ),
);
const twoH3 = registerLayout(
  createBandLayout(
    "two-h3",
    "波形横分 / 上重下轻",
    [point(0, 700), point(460, 520), point(920, 700), point(1200, 590)],
    ["上方主体大格", "下方承接大格"],
  ),
);
const twoH4 = registerLayout(
  createBandLayout(
    "two-h4",
    "波形横分 / 上轻下重",
    [point(0, 540), point(420, 720), point(860, 610), point(1200, 790)],
    ["上方主体大格", "下方承接大格"],
  ),
);
const twoV1 = registerLayout(
  createVerticalLayout(
    "two-v1",
    "偏置左右分 / 左轻右重",
    [point(520, 0), point(460, 620), point(480, 1200), point(560, 1700)],
    ["左侧主体格", "右侧主体格"],
  ),
);
const twoV2 = registerLayout(
  createVerticalLayout(
    "two-v2",
    "偏置左右分 / 左重右轻",
    [point(680, 0), point(760, 500), point(700, 1180), point(640, 1700)],
    ["左侧主体格", "右侧主体格"],
  ),
);
const twoV3 = registerLayout(
  createVerticalLayout(
    "two-v3",
    "斜向左右分 / 左窄右宽",
    [point(360, 0), point(420, 540), point(620, 1100), point(820, 1700)],
    ["左侧斜切格", "右侧主体格"],
  ),
);
const twoV4 = registerLayout(
  createVerticalLayout(
    "two-v4",
    "斜向左右分 / 左宽右窄",
    [point(840, 0), point(780, 620), point(680, 1080), point(540, 1700)],
    ["左侧主体格", "右侧斜切格"],
  ),
);

registerLayout(
  createDerivedLayout(
    "three-hb1",
    "上整下分",
    ["上方横大格", "左下格", "右下格"],
    twoH1.panels,
    [
      {
        targetIndex: 1,
        lineStart: point(620, 740),
        lineEnd: point(540, 1700),
        sortFn: compareReadingOrder,
      },
    ],
  ),
);
registerLayout(
  createDerivedLayout(
    "three-hb2",
    "上整下分",
    ["上方横大格", "左下格", "右下格"],
    twoH3.panels,
    [
      {
        targetIndex: 1,
        lineStart: point(700, 640),
        lineEnd: point(620, 1700),
        sortFn: compareReadingOrder,
      },
    ],
  ),
);
registerLayout(
  createDerivedLayout(
    "three-ht1",
    "上分下整",
    ["左上格", "右上格", "下方横大格"],
    twoH2.panels,
    [
      {
        targetIndex: 0,
        lineStart: point(560, -100),
        lineEnd: point(480, 860),
        sortFn: compareReadingOrder,
      },
    ],
  ),
);
registerLayout(
  createDerivedLayout(
    "three-ht2",
    "上分下整",
    ["左上格", "右上格", "下方横大格"],
    twoH4.panels,
    [
      {
        targetIndex: 0,
        lineStart: point(700, -100),
        lineEnd: point(820, 900),
        sortFn: compareReadingOrder,
      },
    ],
  ),
);
registerLayout(
  createDerivedLayout(
    "three-vl1",
    "左整右分",
    ["左侧竖长格", "右上格", "右下格"],
    twoV1.panels,
    [
      {
        targetIndex: 1,
        lineStart: point(460, 860),
        lineEnd: point(1200, 740),
        sortFn: compareTopFirst,
      },
    ],
  ),
);
registerLayout(
  createDerivedLayout(
    "three-vl2",
    "左整右分",
    ["左侧竖长格", "右上格", "右下格"],
    twoV3.panels,
    [
      {
        targetIndex: 1,
        lineStart: point(540, 760),
        lineEnd: point(1200, 860),
        sortFn: compareTopFirst,
      },
    ],
  ),
);
registerLayout(
  createDerivedLayout(
    "three-vr1",
    "左分右整",
    ["左上格", "左下格", "右侧竖长格"],
    twoV2.panels,
    [
      {
        targetIndex: 0,
        lineStart: point(0, 760),
        lineEnd: point(760, 660),
        sortFn: compareTopFirst,
      },
    ],
  ),
);
registerLayout(
  createDerivedLayout(
    "three-vr2",
    "左分右整",
    ["左上格", "左下格", "右侧竖长格"],
    twoV4.panels,
    [
      {
        targetIndex: 0,
        lineStart: point(0, 700),
        lineEnd: point(780, 780),
        sortFn: compareTopFirst,
      },
    ],
  ),
);

const fourL3R1Base = createVerticalLayout(
  "base-four-l3-r1",
  "临时",
  [point(520, 0), point(460, 560), point(430, 1080), point(500, 1700)],
  ["临时", "临时"],
);
registerLayout(
  createDerivedLayout(
    "four-l3-r1",
    "左三连列 + 右侧竖长格",
    ["左列上格", "左列中格", "左列下格", "右侧竖长格"],
    fourL3R1Base.panels,
    [
      {
        targetIndex: 0,
        lineStart: point(0, 520),
        lineEnd: point(460, 560),
        sortFn: compareTopFirst,
      },
      {
        targetIndex: 1,
        lineStart: point(0, 1040),
        lineEnd: point(430, 1080),
        sortFn: compareTopFirst,
      },
    ],
  ),
);

const fourR3L1Base = createVerticalLayout(
  "base-four-r3-l1",
  "临时",
  [point(680, 0), point(770, 620), point(740, 1100), point(680, 1700)],
  ["临时", "临时"],
);
registerLayout(
  createDerivedLayout(
    "four-r3-l1",
    "右三连列 + 左侧竖长格",
    ["左侧竖长格", "右列上格", "右列中格", "右列下格"],
    fourR3L1Base.panels,
    [
      {
        targetIndex: 1,
        lineStart: point(770, 620),
        lineEnd: point(1200, 520),
        sortFn: compareTopFirst,
      },
      {
        targetIndex: 2,
        lineStart: point(740, 1100),
        lineEnd: point(1200, 1040),
        sortFn: compareTopFirst,
      },
    ],
  ),
);

const fourT1B3Base = createBandLayout(
  "base-four-t1-b3",
  "临时",
  [point(0, 620), point(360, 740), point(860, 560), point(1200, 620)],
  ["临时", "临时"],
);
registerLayout(
  createDerivedLayout(
    "four-t1-b3",
    "上宽下三",
    ["上方横大格", "左下格", "中下格", "右下格"],
    fourT1B3Base.panels,
    [
      {
        targetIndex: 1,
        lineStart: point(360, 740),
        lineEnd: point(430, 1700),
        sortFn: compareReadingOrder,
      },
      {
        targetIndex: 2,
        lineStart: point(860, 560),
        lineEnd: point(780, 1700),
        sortFn: compareReadingOrder,
      },
    ],
  ),
);

const fourT3B1Base = createBandLayout(
  "base-four-t3-b1",
  "临时",
  [point(0, 620), point(420, 680), point(780, 620), point(1200, 720)],
  ["临时", "临时"],
);
registerLayout(
  createDerivedLayout(
    "four-t3-b1",
    "上三下宽",
    ["左上格", "中上格", "右上格", "下方横大格"],
    fourT3B1Base.panels,
    [
      {
        targetIndex: 0,
        lineStart: point(380, 0),
        lineEnd: point(420, 680),
        sortFn: compareReadingOrder,
      },
      {
        targetIndex: 1,
        lineStart: point(820, 0),
        lineEnd: point(780, 620),
        sortFn: compareReadingOrder,
      },
    ],
  ),
);

const pagePlans = new Map([
  [1, { layoutKey: "four-l3-r1", groups: [1, 1, 1, 2] }],
  [2, { layoutKey: "splash-1", groups: [4] }],
  [3, { layoutKey: "three-vl1", groups: [2, 1, 2] }],
  [4, { layoutKey: "two-h1", groups: [2, 2] }],
  [5, { layoutKey: "two-v1", groups: [3, 2] }],
  [6, { layoutKey: "two-v2", groups: [3, 1] }],
  [7, { layoutKey: "four-t1-b3", groups: [2, 1, 1, 1] }],
  [8, { layoutKey: "four-t3-b1", groups: [1, 1, 1, 1] }],
  [9, { layoutKey: "four-r3-l1", groups: [2, 1, 1, 1] }],
  [10, { layoutKey: "four-t1-b3", groups: [1, 1, 1, 1] }],
  [11, { layoutKey: "three-vr1", groups: [1, 2, 2] }],
  [12, { layoutKey: "two-h2", groups: [2, 2] }],
  [13, { layoutKey: "splash-1", groups: [5] }],
  [14, { layoutKey: "four-t3-b1", groups: [1, 1, 1, 1] }],
  [15, { layoutKey: "two-v3", groups: [3, 2] }],
  [16, { layoutKey: "three-vl2", groups: [2, 1, 1] }],
  [17, { layoutKey: "three-hb2", groups: [2, 2, 1] }],
  [18, { layoutKey: "three-ht1", groups: [1, 1, 2] }],
  [19, { layoutKey: "four-l3-r1", groups: [1, 1, 1, 2] }],
  [20, { layoutKey: "four-r3-l1", groups: [1, 1, 1, 1] }],
  [21, { layoutKey: "three-vr2", groups: [2, 1, 2] }],
  [22, { layoutKey: "two-h3", groups: [2, 2] }],
  [23, { layoutKey: "four-l3-r1", groups: [1, 1, 1, 2] }],
  [24, { layoutKey: "splash-1", groups: [4] }],
  [25, { layoutKey: "four-r3-l1", groups: [2, 1, 1, 1] }],
  [26, { layoutKey: "three-hb1", groups: [1, 1, 2] }],
  [27, { layoutKey: "two-v4", groups: [3, 2] }],
  [28, { layoutKey: "two-h4", groups: [2, 2] }],
  [29, { layoutKey: "three-vl1", groups: [2, 1, 2] }],
  [30, { layoutKey: "splash-1", groups: [4] }],
  [31, { layoutKey: "three-ht2", groups: [2, 1, 2] }],
  [32, { layoutKey: "two-v1", groups: [2, 2] }],
  [33, { layoutKey: "two-v2", groups: [3, 2] }],
  [34, { layoutKey: "splash-1", groups: [4] }],
  [35, { layoutKey: "three-vr1", groups: [2, 1, 2] }],
  [36, { layoutKey: "two-h2", groups: [3, 1] }],
  [37, { layoutKey: "four-t1-b3", groups: [1, 1, 1, 2] }],
  [38, { layoutKey: "splash-1", groups: [4] }],
  [39, { layoutKey: "four-t3-b1", groups: [1, 1, 1, 2] }],
  [40, { layoutKey: "splash-1", groups: [4] }],
]);

function createPageId(pageNumber) {
  return `page-p${pad2(pageNumber)}`;
}

function createPanelId(pageNumber, panelNumber) {
  return `panel-p${pad2(pageNumber)}-${pad2(panelNumber)}`;
}

function toPanelGeometry(globalPolygon) {
  const bounds = getBounds(globalPolygon);
  return {
    x: normalizeNumber(bounds.minX),
    y: normalizeNumber(bounds.minY),
    width: normalizeNumber(bounds.maxX - bounds.minX),
    height: normalizeNumber(bounds.maxY - bounds.minY),
    points: globalPolygon.map((entry) => ({
      x: normalizeNumber(entry.x - bounds.minX),
      y: normalizeNumber(entry.y - bounds.minY),
    })),
  };
}

function createPanel(globalPolygon, description, pageNumber, panelNumber) {
  const geometry = toPanelGeometry(globalPolygon);
  return {
    id: createPanelId(pageNumber, panelNumber),
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: 0,
    points: geometry.points,
    style: PANEL_STYLE,
    image: null,
    description,
  };
}

async function readStoryboardSource() {
  try {
    return await fs.readFile(storyboardSourcePath, "utf8");
  } catch {
    return fs.readFile(storyboardOutputPath, "utf8");
  }
}

function parsePageSections(markdown) {
  const sectionRe = /### P(\d+)\n([\s\S]*?)(?=\n### P\d+|$)/g;
  const sections = [];
  let match = null;

  while ((match = sectionRe.exec(markdown))) {
    const pageNumber = Number(match[1]);
    const bodyLines = match[2]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const functionLine = bodyLines.find((line) => /^- 功能：/.test(line)) ?? "";
    const panelLines = bodyLines.filter((line) => /^\d+\.\s*位置：/.test(line));
    const noteLines = bodyLines.filter(
      (line) => line !== functionLine && !/^\d+\.\s*位置：/.test(line),
    );

    sections.push({
      pageNumber,
      functionLine,
      panelLines,
      noteLines,
    });
  }

  return sections;
}

function parsePanelLine(line, pageNumber) {
  const match = line.match(/^\d+\.\s*位置：([^。]+)。(.+)$/);
  if (!match) {
    throw new Error(`Failed to parse panel line on P${pageNumber}: ${line}`);
  }

  return {
    position: match[1].trim(),
    content: match[2].trim(),
  };
}

function groupBySizes(items, sizes) {
  const groups = [];
  let offset = 0;

  for (const size of sizes) {
    groups.push(items.slice(offset, offset + size));
    offset += size;
  }

  return groups;
}

function getShotPrefix(content) {
  for (const [label, prefix] of SHOT_PREFIXES) {
    const marker = `${label}：`;
    if (content.startsWith(marker)) {
      return {
        prefix,
        body: content.slice(marker.length).trim(),
      };
    }
  }

  return {
    prefix: "",
    body: content,
  };
}

function stripDialogue(body) {
  return body
    .replace(/：\s*[“「『][^”」』]*[”」』]/gu, "")
    .replace(/[“「『][^”」』]*[”」』]/gu, "")
    .replace(/：$/u, "")
    .replace(/\s+/gu, "");
}

function normalizePromptBody(body) {
  const stripped = stripDialogue(body).replace(/同格：/gu, "").trim();
  const translated = PROMPT_BODY_TRANSLATIONS.get(stripped);

  if (!translated) {
    throw new Error(`Missing English prompt translation for body: ${stripped}`);
  }

  let result = translated.trim();

  if (!result) {
    return "the atmosphere of the panel tightening sharply.";
  }

  if (!/[.!?]$/u.test(result)) {
    result = `${result}.`;
  }

  return rewriteNamesForPrompt(rewriteStaticLanguage(result));
}

function rewriteNamesForPrompt(text) {
  return text
    .replace(/\bMoonbite's\b/gu, "__WEREWOLF_POSSESSIVE__")
    .replace(/\bMoonbite\b/gu, "__WEREWOLF__")
    .replace(/\bYukino's\b/gu, "__YUKINO_POSSESSIVE__")
    .replace(/\bYukino\b/gu, "__YUKINO__")
    .replace(/\bYui's\b/gu, "__YUI_POSSESSIVE__")
    .replace(/\bYui\b/gu, "__YUI__")
    .replace(/\bHachiman's\b/gu, "__HACHIMAN_POSSESSIVE__")
    .replace(/\bHachiman\b/gu, "__HACHIMAN__")
    .replace(/__WEREWOLF_POSSESSIVE__/gu, "the werewolf's")
    .replace(/__WEREWOLF__/gu, "the werewolf")
    .replace(/__YUKINO_POSSESSIVE__/gu, "Yukino Yukinoshita's")
    .replace(/__YUKINO__/gu, "Yukino Yukinoshita")
    .replace(/__YUI_POSSESSIVE__/gu, "Yui Yuigahama's")
    .replace(/__YUI__/gu, "Yui Yuigahama")
    .replace(/__HACHIMAN_POSSESSIVE__/gu, "Hachiman Hikigaya's")
    .replace(/__HACHIMAN__/gu, "Hachiman Hikigaya");
}

function rewriteStaticLanguage(text) {
  return text
    .replace(
      /one corner of the shopping street suddenly loses power, rows of neon signs going dark/gu,
      "one corner of the shopping street dark after a sudden power loss, rows of neon signs already off",
    )
    .replace(
      /Hachiman suddenly looking completely serious/gu,
      "Hachiman wearing an unexpectedly serious expression",
    )
    .replace(
      /Hachiman Hikigaya suddenly looking completely serious/gu,
      "Hachiman Hikigaya wearing an unexpectedly serious expression",
    )
    .replace(
      /clearly trying to finish the fight as fast as possible/gu,
      "clearly intent on ending the fight immediately",
    )
    .replace(
      /trying to rise with shoulder, arm, and knee straining together/gu,
      "half-risen with shoulder, arm, and knee straining together",
    )
    .replace(
      /weakening and dying in front of her eyes/gu,
      "reduced to an almost extinguished thread in front of her eyes",
    )
    .replace(
      /her breathing suddenly much heavier/gu,
      "her breathing visibly much heavier",
    )
    .replace(
      /fingertips beginning to tremble/gu,
      "fingertips visibly trembling",
    )
    .replace(
      /continuing in a calm, controlled manner/gu,
      "holding a calm, controlled posture",
    )
    .replace(
      /continuing to press the point/gu,
      "still pressing the point at close range",
    )
    .replace(
      /her right hand trembling once, then forced steady at once/gu,
      "her right hand caught in a brief tremor before being held steady",
    )
    .replace(
      /her eyes flicking to the werewolf and then back to the monitor wall/gu,
      "her eyes divided between the werewolf and the monitor wall",
    )
    .replace(/\bsuddenly\b/gu, "")
    .replace(/\bthen\b/gu, "and")
    .replace(/\s+/gu, " ")
    .trim();
}

function toPromptBeat(content) {
  const { prefix, body } = getShotPrefix(content);
  return `${prefix}${normalizePromptBody(body)}`;
}

function joinPromptParts(parts, separator = "，") {
  return parts.filter(Boolean).join(separator);
}

function getScenePrompt(pageNumber) {
  if (pageNumber <= 6) {
    return "winter Japanese city shopping street and nearby rooftops at night, cold wind, neon district after a blackout, oppressive air";
  }

  if (pageNumber <= 12) {
    return "Japanese high school Service Club room after school, wooden desks, teacups, natural window light, quiet atmosphere with a hint of teasing";
  }

  if (pageNumber <= 17) {
    return "elevated city passage and rooftop edge at dusk, night just settling in, strong cold wind, narrow combat space";
  }

  if (pageNumber <= 22) {
    return "large Japanese shopping mall in weekend daylight, glass facade, collaboration posters, escalators and maintenance corridors, bright commercial lighting hiding something wrong";
  }

  return "maintenance zone and monitor room deep inside the mall, cold artificial light, monitor wall, steel framing, damaged equipment, compressed and hostile space";
}

function getYukinoLookPrompt(pageNumber) {
  if (pageNumber <= 6) {
    return `${YUKINO_BASE_PROMPT}, ${YUKINO_BATTLE_LOOK_PROMPT}`;
  }

  if (pageNumber <= 17) {
    return `${YUKINO_BASE_PROMPT}, ${YUKINO_SCHOOL_LOOK_PROMPT}, able to fight directly in school uniform, cold blue flame attached to fingers, wrists, and heels, no transformation`;
  }

  return `${YUKINO_BASE_PROMPT}, ${YUKINO_WEEKEND_LOOK_PROMPT}, able to fight directly in casual clothes, cold blue flame attached to fingers, wrists, and heels, no transformation`;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function collectCharacterPrompts(pageNumber, mergedText) {
  const prompts = [];

  if (pageNumber >= 2 || hasAny(mergedText, ["雪乃", "雪之下"])) {
    prompts.push(getYukinoLookPrompt(pageNumber));
  }

  if (hasAny(mergedText, ["结衣", "由比滨"])) {
    prompts.push(YUI_PROMPT);
  }

  if (hasAny(mergedText, ["八幡", "比企谷"])) {
    prompts.push(HACHIMAN_PROMPT);
  }

  if (hasAny(mergedText, ["月噬"])) {
    prompts.push(MOONBITE_PROMPT);
  }

  if (hasAny(mergedText, ["怪物", "异形魔物", "黑色魔物", "黑色黏体", "魔物"])) {
    prompts.push(CREATURE_PROMPT);
  }

  if (hasAny(mergedText, ["聚集成型", "逐渐聚集成型", "黑色黏体"])) {
    prompts.push(SHADOW_CREATURE_PROMPT);
  }

  return [...new Set(prompts)];
}

function buildPanelPrompt(group, pageNumber) {
  const mergedText = group.map((entry) => entry.content).join(" ");
  const promptParts = [
    GLOBAL_PROMPT_STYLE,
    getScenePrompt(pageNumber),
    ...collectCharacterPrompts(pageNumber, mergedText),
  ];
  const beats = group.map((entry) => toPromptBeat(entry.content));

  return `${joinPromptParts(promptParts, ", ")}. ${beats.join(" ")} All described elements belong to one complete standalone still image, and the prompt fully describes the image without relying on previous or next panels. No dialogue text, no speech bubbles, no sound effect lettering.`;
}

function getShotLabel(content) {
  for (const [label] of SHOT_PREFIXES) {
    const marker = `${label}：`;
    if (content.startsWith(marker)) {
      return {
        label,
        body: content.slice(marker.length).trim(),
      };
    }
  }

  return {
    label: "镜头",
    body: content,
  };
}

function normalizeHumanBeatText(content) {
  const hasDialogue = /[“「『][^”」』]*[”」』]/u.test(content);
  const { label, body } = getShotLabel(content);
  const visualBody = stripDialogue(body).replace(/同格：/gu, "").trim();
  const cleaned = visualBody
    .replace(/\s+/gu, "")
    .replace(/：$/u, "")
    .trim();

  if (!cleaned) {
    return hasDialogue
      ? `${label}中保留人物正在说话时的口型和神态，但不要把台词文字画进画面。`
      : `${label}按当前页情绪完成画面。`;
  }

  if (hasDialogue) {
    return `${label}里表现“${cleaned}”这一画面信息，并用说话时的口型、眼神和姿态来传达语气，不要把台词文字画进画面。`;
  }

  return `${label}里表现“${cleaned}”这一画面信息。`;
}

function getSceneReferenceZh(pageNumber) {
  if (pageNumber <= 6) {
    return "冬夜商店街与周边高楼屋顶，冷风强、霓虹断电、城市压迫感明显。";
  }

  if (pageNumber <= 12) {
    return "放学后的社团教室，木桌、茶杯、窗边自然光和室内安静空气都要明确。";
  }

  if (pageNumber <= 17) {
    return "傍晚到入夜的高处通道与楼顶边缘，风大、空间窄、战斗感偏冷。";
  }

  if (pageNumber <= 22) {
    return "周末白天的大型商场，玻璃幕墙、海报、扶梯和维护通道都应有商业空间感。";
  }

  return "商场深处的维护区与监控室，冷色人工光、屏幕墙、钢结构和受损设备要清楚。";
}

function getLookReferenceZh(pageNumber, mergedText) {
  const references = [];

  if (pageNumber >= 2 || hasAny(mergedText, ["雪乃", "雪之下"])) {
    if (pageNumber <= 6) {
      references.push("雪乃使用“第一次战斗外观”。");
    } else if (pageNumber <= 17) {
      references.push("雪乃使用“校服外观”。");
    } else {
      references.push("雪乃使用“周末和结衣约会外观”。");
    }
  }

  if (hasAny(mergedText, ["结衣", "由比滨"])) {
    references.push("结衣沿用当前项目中已经固定的角色外观。");
  }

  if (hasAny(mergedText, ["八幡", "比企谷"])) {
    references.push("八幡沿用当前项目中已经固定的角色外观。");
  }

  if (hasAny(mergedText, ["月噬"])) {
    references.push("狼人统一按当前项目中的 werewolf 外观设定处理。");
  }

  if (hasAny(mergedText, ["怪物", "异形魔物", "黑色魔物", "黑色黏体", "魔物"])) {
    references.push("杂怪与影状魔物沿用当前项目中已固定的怪物外观设定。");
  }

  return references.join("");
}

function buildHumanPanelDescription(group, pageNumber, positionLabel, areaPercent) {
  const mergedText = group.map((entry) => entry.content).join(" ");
  const beatLines = group.map((entry, index) => {
    const sentence = normalizeHumanBeatText(entry.content);
    return index === 0 ? `主要画面请以${sentence}` : `同一格里还要补充${sentence}`;
  });

  const lookReference = getLookReferenceZh(pageNumber, mergedText);

  return [
    `这格位于本页${positionLabel}，约占整页${areaPercent}%。请把它处理成一张可以直接交给人工出图的单格画面。`,
    `场景基底是：${getSceneReferenceZh(pageNumber)}`,
    lookReference ? `角色外观要求：${lookReference}` : "",
    ...beatLines,
    "如果同一格里包含多个信息，请把它们整合成同一瞬间里能够同时成立的构图，不要拆成前后连续动作。",
    "这格的描述已经是出图说明，不需要再依赖前后文补充。画面中不要加入对白字、气泡和拟声字，但要保留人物关系、情绪、姿态和空间层次。",
  ]
    .filter(Boolean)
    .join("");
}

function mergeRawGroup(group) {
  return group
    .map((entry, index) => (index === 0 ? entry.content : `同格：${entry.content}`))
    .join(" ");
}

function buildRulesBlock(pageSections) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  pageSections.forEach((section) => {
    const plan = pagePlans.get(section.pageNumber);
    counts[plan.groups.length] += 1;
  });

  return [
    "## 版面规则",
    "- 单页分镜密度在 `1-4格` 之间浮动，不再按奇偶页固定。",
    `- 当前页型分布：\`1格 x ${counts[1]}页\` / \`2格 x ${counts[2]}页\` / \`3格 x ${counts[3]}页\` / \`4格 x ${counts[4]}页\`。`,
    "- `1格` 用于雪乃登场、初战落下、监控假画面钉住视线、第一次高消耗直贯、重创、压制与败北成立等强落点。",
    "- `2格` 混用折线横分、波形横分、偏置左右分与斜向左右分，不再只保留单纯上下二分。",
    "- `3格` 混用 `上整下分`、`上分下整`、`左整右分`、`左分右整` 四类节奏页。",
    "- `4格` 重点加入以下拓扑：",
    "  - `左三连列 + 右侧竖长格`",
    "  - `右三连列 + 左侧竖长格`",
    "  - `上宽下三`",
    "  - `上三下宽`",
    "- 对白规则：",
    "  - 单气泡尽量控制在 `4-12` 字。",
    "  - 一格最多 `2` 句。",
    "  - 雪乃对白少而硬，月噬对白短而准，结衣对白轻快，八幡只留在学校篇。",
  ].join("\n");
}

function buildStoryboardMarkdown(sourceMarkdown, pageSections) {
  const rulesIndex = sourceMarkdown.indexOf("## 版面规则");
  const structureIndex = sourceMarkdown.indexOf("## 剧情结构");
  const pagesIndex = sourceMarkdown.indexOf("## 逐页版面分镜");

  if (rulesIndex === -1 || structureIndex === -1 || pagesIndex === -1) {
    throw new Error("Failed to locate markdown structure anchors.");
  }

  const prefix = sourceMarkdown.slice(0, rulesIndex).trimEnd();
  const middle = sourceMarkdown.slice(structureIndex, pagesIndex).trim();

  const pageBlocks = pageSections.map((section) => {
    const plan = pagePlans.get(section.pageNumber);
    if (!plan) {
      throw new Error(`Missing page plan for P${section.pageNumber}.`);
    }

    const layout = layoutCatalog.get(plan.layoutKey);
    if (!layout) {
      throw new Error(`Missing layout ${plan.layoutKey} for P${section.pageNumber}.`);
    }

    const parsedPanels = section.panelLines.map((line) => parsePanelLine(line, section.pageNumber));
    const sourceCount = parsedPanels.length;
    const groupTotal = plan.groups.reduce((sum, value) => sum + value, 0);

    if (groupTotal !== sourceCount) {
      throw new Error(`Page P${section.pageNumber} groups do not match source panel count.`);
    }

    if (plan.groups.length !== layout.panels.length) {
      throw new Error(`Page P${section.pageNumber} panel count does not match layout ${plan.layoutKey}.`);
    }

    const groupedPanels = groupBySizes(parsedPanels, plan.groups);
    const numberedLines = groupedPanels.map((group, index) => {
      const areaPercent = Math.round((polygonArea(layout.panels[index]) / PAGE_AREA) * 100);
      return `${index + 1}. 位置：${layout.positionLabels[index]}，约占${areaPercent}%。${mergeRawGroup(group)}`;
    });

    const lines = [
      `### P${section.pageNumber}`,
      section.functionLine,
      `- 页型：${layout.strategyName}`,
      ...numberedLines,
      ...section.noteLines,
    ];

    return lines.join("\n");
  });

  return `${prefix}\n\n${buildRulesBlock(pageSections)}\n\n${middle}\n\n## 逐页版面分镜\n\n${pageBlocks.join("\n\n")}\n`;
}

function buildProjectTemplate(pageSections) {
  const generatedAt = new Date().toISOString();

  const pages = pageSections.map((section) => {
    const plan = pagePlans.get(section.pageNumber);
    const layout = layoutCatalog.get(plan.layoutKey);
    const parsedPanels = section.panelLines.map((line) => parsePanelLine(line, section.pageNumber));
    const groupedPanels = groupBySizes(parsedPanels, plan.groups);
    const descriptions = groupedPanels.map((group, index) => {
      const areaPercent = Math.round((polygonArea(layout.panels[index]) / PAGE_AREA) * 100);

      if (PANEL_DESCRIPTION_MODE === "prompt_en") {
        return buildPanelPrompt(group, section.pageNumber);
      }

      return buildHumanPanelDescription(
        group,
        section.pageNumber,
        layout.positionLabels[index],
        areaPercent,
      );
    });

    const panels = layout.panels.map((polygon, index) =>
      createPanel(polygon, descriptions[index], section.pageNumber, index + 1),
    );

    return {
      id: createPageId(section.pageNumber),
      name: `P${section.pageNumber}`,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      background: "#ffffff",
      panels,
      texts: [],
      bubbles: [],
      layers: panels.map((panel) => `panel:${panel.id}`),
    };
  });

  return {
    id: "project-yukino-template",
    title: TARGET_TITLE,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    pages,
  };
}

async function main() {
  const sourceMarkdown = await readStoryboardSource();
  const pageSections = parsePageSections(sourceMarkdown);

  if (pageSections.length !== 40) {
    throw new Error(`Expected 40 pages, received ${pageSections.length}.`);
  }

  for (const section of pageSections) {
    const plan = pagePlans.get(section.pageNumber);
    if (!plan) {
      throw new Error(`Missing page plan for P${section.pageNumber}.`);
    }

    const sourceCount = section.panelLines.length;
    const groupTotal = plan.groups.reduce((sum, value) => sum + value, 0);

    if (groupTotal !== sourceCount) {
      throw new Error(`Page P${section.pageNumber} groups do not match source panel count.`);
    }
  }

  const project = buildProjectTemplate(pageSections);
  const syncedMarkdown = buildStoryboardMarkdown(sourceMarkdown, pageSections);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await fs.writeFile(storyboardOutputPath, syncedMarkdown, "utf8");

  const totalPanels = project.pages.reduce((sum, page) => sum + page.panels.length, 0);
  console.log(
    JSON.stringify(
      {
        outputPath,
        storyboardOutputPath,
        title: project.title,
        pages: project.pages.length,
        panels: totalPanels,
        layouts: layoutCatalog.size,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
