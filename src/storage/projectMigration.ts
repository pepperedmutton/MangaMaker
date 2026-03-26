import { createDefaultText, createId } from "../domain/defaults";
import { getBubbleTextBounds } from "../domain/helpers";
import { DEFAULT_TEXT_FONT_FAMILY } from "../platform/localFonts";

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord =>
  typeof value === "object" && value !== null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const toStringValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

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
          return false;
        })
        .map((member) => ({
          objectType: toStringValue(member.objectType) as "panel" | "text" | "bubble",
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
    .filter((group): group is { id: string; members: Array<{ objectType: "panel" | "text" | "bubble"; objectId: string }> } => group !== null);
};

const normalizePageTextFonts = (page: AnyRecord) => {
  const texts = asArray(page.texts).filter((item) => isRecord(item)) as AnyRecord[];
  for (const text of texts) {
    text.fontFamily = DEFAULT_TEXT_FONT_FAMILY;
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
    page.panels = asArray(page.panels).filter((item) => isRecord(item));
    page.texts = asArray(page.texts).filter((item) => isRecord(item));
    page.bubbles = asArray(page.bubbles).filter((item) => isRecord(item));
    page.layers = asArray(page.layers).map((layer) => toStringValue(layer)).filter((layer) => layer.length > 0);
    page.groups = asArray(page.groups).filter((item) => isRecord(item));

    migrateLegacyBubbleText(page);
    for (const bubble of page.bubbles as AnyRecord[]) {
      ensureBubbleContentCenter(bubble);
    }
    normalizePageTextFonts(page);
    normalizePageGroups(page);
    return page;
  });
  return project;
};
