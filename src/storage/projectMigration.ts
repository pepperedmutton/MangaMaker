import {
  CG_PAGE_HEIGHT,
  CG_PAGE_WIDTH,
  MANGA_PAGE_HEIGHT,
  MANGA_PAGE_WIDTH,
  createDefaultPanelStyle,
  createDefaultText,
  createId,
} from "../domain/defaults";
import { BUBBLE_TYPE_VALUES } from "../domain/schema";
import { getBubbleTextBounds } from "../domain/helpers";
import { normalizeProjectPageNames } from "../domain/pageNaming";
import { DEFAULT_LOCALE } from "../i18n";
import { DEFAULT_TEXT_FONT_FAMILY, isSupportedFontFamily } from "../platform/localFonts";

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord =>
  typeof value === "object" && value !== null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const validBubbleTypes = new Set<string>(BUBBLE_TYPE_VALUES);

const legacyBubbleTypeAliases: Record<string, string> = {
  narration: "caption",
  narrative: "caption",
  narrationBox: "caption",
};

const toNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toStringValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const getFallbackPageSize = (projectType: unknown) =>
  projectType === "cg"
    ? { width: CG_PAGE_WIDTH, height: CG_PAGE_HEIGHT }
    : { width: MANGA_PAGE_WIDTH, height: MANGA_PAGE_HEIGHT };

const toPositiveNumber = (value: unknown, fallback: number) =>
  Math.max(1, toNumber(value, fallback));

const normalizePageGeometry = (page: AnyRecord, projectType: unknown) => {
  const fallbackSize = getFallbackPageSize(projectType);
  page.width = toPositiveNumber(page.width, fallbackSize.width);
  page.height = toPositiveNumber(page.height, fallbackSize.height);
};

const normalizePanelStyle = (value: unknown) => {
  const defaults = createDefaultPanelStyle();
  const style = isRecord(value) ? value : {};
  return {
    fill: toStringValue(style.fill, defaults.fill),
    stroke: toStringValue(style.stroke, defaults.stroke),
    strokeWidth: Math.max(0, toNumber(style.strokeWidth, defaults.strokeWidth)),
    cornerRadius: Math.max(0, toNumber(style.cornerRadius, defaults.cornerRadius)),
  };
};

const normalizePagePanels = (page: AnyRecord) => {
  const pageWidth = toPositiveNumber(page.width, MANGA_PAGE_WIDTH);
  const pageHeight = toPositiveNumber(page.height, MANGA_PAGE_HEIGHT);
  return asArray(page.panels)
    .filter((item) => isRecord(item))
    .map((rawPanel) => {
      const panel = structuredClone(rawPanel) as AnyRecord;
      panel.x = toNumber(panel.x, 0);
      panel.y = toNumber(panel.y, 0);
      panel.width = toPositiveNumber(panel.width, pageWidth);
      panel.height = toPositiveNumber(panel.height, pageHeight);
      panel.rotation = toNumber(panel.rotation, 0);
      panel.style = normalizePanelStyle(panel.style);
      return panel;
    });
};

const normalizeBubbleType = (value: unknown) => {
  const rawType = toStringValue(value, "round");
  const aliasedType = legacyBubbleTypeAliases[rawType] ?? rawType;
  return validBubbleTypes.has(aliasedType) ? aliasedType : "round";
};

const hasLegacyBubbleText = (bubble: AnyRecord) =>
  typeof bubble.text === "string" ||
  typeof bubble.fontSize === "number" ||
  typeof bubble.fontFamily === "string" ||
  typeof bubble.fontWeight === "number" ||
  typeof bubble.direction === "string" ||
  typeof bubble.textAlign === "string" ||
  typeof bubble.verticalAlign === "string";

const removeLegacyBubbleTextFields = (bubble: AnyRecord) => {
  delete bubble.text;
  delete bubble.fontSize;
  delete bubble.fontFamily;
  delete bubble.fontWeight;
  delete bubble.direction;
  delete bubble.textAlign;
  delete bubble.verticalAlign;
};

const ensureBubbleContentCenter = (bubble: AnyRecord) => {
  const width = toNumber(bubble.width, 0);
  const height = toNumber(bubble.height, 0);
  const current = bubble.contentCenter;
  if (isRecord(current) && typeof current.x === "number" && typeof current.y === "number") {
    return;
  }
  bubble.contentCenter = {
    x: width * 0.5,
    y: height * 0.5,
  };
};

const normalizePageGroups = (page: AnyRecord) => {
  const groups = asArray(page.groups).filter((group) => isRecord(group));
  const panelIds = new Set(
    asArray(page.panels)
      .filter((item) => isRecord(item))
      .map((panel) => toStringValue((panel as AnyRecord).id))
      .filter((id) => id.length > 0),
  );
  const textIds = new Set(
    asArray(page.texts)
      .filter((item) => isRecord(item))
      .map((text) => toStringValue((text as AnyRecord).id))
      .filter((id) => id.length > 0),
  );
  const bubbleIds = new Set(
    asArray(page.bubbles)
      .filter((item) => isRecord(item))
      .map((bubble) => toStringValue((bubble as AnyRecord).id))
      .filter((id) => id.length > 0),
  );
  const elementIds = new Set(
    asArray(page.elements)
      .filter((item) => isRecord(item))
      .map((element) => toStringValue((element as AnyRecord).id))
      .filter((id) => id.length > 0),
  );

  page.groups = groups
    .map((group) => {
      const groupRecord = group as AnyRecord;
      const members = asArray(groupRecord.members)
        .filter((member) => isRecord(member))
        .map((member) => member as AnyRecord)
        .filter((member) => {
          const objectType = toStringValue(member.objectType);
          const objectId = toStringValue(member.objectId);
          if (objectType === "panel") {
            return panelIds.has(objectId);
          }
          if (objectType === "text") {
            return textIds.has(objectId);
          }
          if (objectType === "bubble") {
            return bubbleIds.has(objectId);
          }
          if (objectType === "element") {
            return elementIds.has(objectId);
          }
          return false;
        })
        .map((member) => ({
          objectType: toStringValue(member.objectType) as "panel" | "text" | "bubble" | "element",
          objectId: toStringValue(member.objectId),
        }));
      if (members.length < 2) {
        return null;
      }
      return {
        id: toStringValue(groupRecord.id) || createId("group"),
        members,
      };
    })
    .filter((group): group is { id: string; members: Array<{ objectType: "panel" | "text" | "bubble" | "element"; objectId: string }> } => group !== null);
};

const normalizePageTextFonts = (page: AnyRecord) => {
  const texts = asArray(page.texts).filter((item) => isRecord(item)) as AnyRecord[];
  for (const text of texts) {
    const fontFamily = toStringValue(text.fontFamily, DEFAULT_TEXT_FONT_FAMILY);
    text.fontFamily = isSupportedFontFamily(fontFamily) ? fontFamily : DEFAULT_TEXT_FONT_FAMILY;
  }
};

const normalizePageBubbles = (page: AnyRecord) => {
  const bubbles = asArray(page.bubbles).filter((item) => isRecord(item)) as AnyRecord[];
  for (const bubble of bubbles) {
    const rawBubbleType = toStringValue(bubble.bubbleType, "round");
    const bubbleType = normalizeBubbleType(bubble.bubbleType);
    bubble.bubbleType = bubbleType;

    if (rawBubbleType === "narration") {
      bubble.showTail = false;
    }

    const legacyStyle = isRecord(bubble.style) ? bubble.style : null;
    if (!legacyStyle) {
      continue;
    }

    if (typeof bubble.backgroundColor !== "string" && typeof legacyStyle.fill === "string") {
      bubble.backgroundColor = legacyStyle.fill;
    }
    if (typeof bubble.strokeColor !== "string" && typeof legacyStyle.stroke === "string") {
      bubble.strokeColor = legacyStyle.stroke;
    }
    if (
      typeof bubble.strokeWidth !== "number" &&
      typeof legacyStyle.strokeWidth === "number" &&
      Number.isFinite(legacyStyle.strokeWidth) &&
      legacyStyle.strokeWidth >= 0
    ) {
      bubble.strokeWidth = legacyStyle.strokeWidth;
    }
  }
};

const migrateLegacyBubbleText = (page: AnyRecord) => {
  const bubbles = asArray(page.bubbles).filter((item) => isRecord(item)) as AnyRecord[];
  const texts = asArray(page.texts).filter((item) => isRecord(item)) as AnyRecord[];
  const groups = asArray(page.groups).filter((item) => isRecord(item)) as AnyRecord[];
  const layers = asArray(page.layers)
    .map((layer) => toStringValue(layer))
    .filter((layer) => layer.length > 0);

  const migratedTexts: AnyRecord[] = [];
  const migratedGroups: AnyRecord[] = [];
  const textLayerByBubbleLayer = new Map<string, string>();

  for (const bubble of bubbles) {
    ensureBubbleContentCenter(bubble);
    if (!hasLegacyBubbleText(bubble)) {
      continue;
    }

    const bubbleId = toStringValue(bubble.id);
    if (bubbleId.length === 0) {
      removeLegacyBubbleTextFields(bubble);
      continue;
    }

    const bubbleX = toNumber(bubble.x, 0);
    const bubbleY = toNumber(bubble.y, 0);
    const bubbleWidth = Math.max(1, toNumber(bubble.width, 1));
    const bubbleHeight = Math.max(1, toNumber(bubble.height, 1));
    const bubbleType = toStringValue(bubble.bubbleType, "round");
    const textBounds = getBubbleTextBounds({
      width: bubbleWidth,
      height: bubbleHeight,
      bubbleType: bubbleType as never,
    });
    const textId = createId("text");
    const migratedText = {
      id: textId,
      ...createDefaultText({
        x: bubbleX + textBounds.x,
        y: bubbleY + textBounds.y,
        width: textBounds.width,
        height: textBounds.height,
        content: toStringValue(bubble.text, ""),
        fontSize: toNumber(bubble.fontSize, 26),
        fontFamily: toStringValue(bubble.fontFamily, DEFAULT_TEXT_FONT_FAMILY),
        fontWeight: Math.round(toNumber(bubble.fontWeight, 400) / 100) * 100,
        direction: toStringValue(bubble.direction, "vertical") as "horizontal" | "vertical",
        textAlign: toStringValue(bubble.textAlign, "center") as "left" | "center" | "right",
        verticalAlign: toStringValue(bubble.verticalAlign, "middle") as "top" | "middle" | "bottom",
      }),
    };

    migratedTexts.push(migratedText);
    migratedGroups.push({
      id: createId("group"),
      members: [
        { objectType: "bubble", objectId: bubbleId },
        { objectType: "text", objectId: textId },
      ],
    });

    textLayerByBubbleLayer.set(`bubble:${bubbleId}`, `text:${textId}`);
    removeLegacyBubbleTextFields(bubble);
  }

  if (migratedTexts.length === 0) {
    page.texts = texts;
    page.groups = groups;
    page.layers = layers;
    return;
  }

  const nextLayers: string[] = [];
  const existingLayers = new Set(layers);
  for (const layer of layers) {
    nextLayers.push(layer);
    const textLayer = textLayerByBubbleLayer.get(layer);
    if (textLayer) {
      nextLayers.push(textLayer);
      existingLayers.add(textLayer);
    }
  }
  for (const migratedText of migratedTexts) {
    const textLayer = `text:${toStringValue(migratedText.id)}`;
    if (!existingLayers.has(textLayer)) {
      nextLayers.push(textLayer);
      existingLayers.add(textLayer);
    }
  }

  page.texts = [...texts, ...migratedTexts];
  page.groups = [...groups, ...migratedGroups];
  page.layers = nextLayers;
};

export const normalizeProjectForCurrentVersion = (rawProject: unknown): unknown => {
  if (!isRecord(rawProject)) {
    return rawProject;
  }
  const project = structuredClone(rawProject);
  if (!isRecord(project)) {
    return rawProject;
  }
  const pages = asArray(project.pages).filter((entry) => isRecord(entry)) as AnyRecord[];
  project.pages = pages.map((rawPage) => {
    const page = structuredClone(rawPage);
    if (!isRecord(page)) {
      return rawPage;
    }
    normalizePageGeometry(page, project.type);
    page.panels = normalizePagePanels(page);
    page.texts = asArray(page.texts).filter((item) => isRecord(item));
    page.bubbles = asArray(page.bubbles).filter((item) => isRecord(item));
    page.elements = asArray(page.elements).filter((item) => isRecord(item));
    page.layers = asArray(page.layers).map((layer) => toStringValue(layer)).filter((layer) => layer.length > 0);
    page.groups = asArray(page.groups).filter((item) => isRecord(item));

    normalizePageBubbles(page);
    migrateLegacyBubbleText(page);
    for (const bubble of page.bubbles as AnyRecord[]) {
      ensureBubbleContentCenter(bubble);
    }
    normalizePageTextFonts(page);
    normalizePageGroups(page);
    return page;
  });
  return normalizeProjectPageNames(
    project as { pages: Array<{ name: string }> },
    DEFAULT_LOCALE,
  );
};
