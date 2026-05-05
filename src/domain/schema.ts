import { z } from "zod";

export const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const panelStyleSchema = z.object({
  fill: z.string(),
  stroke: z.string(),
  strokeWidth: z.number().nonnegative(),
  cornerRadius: z.number().nonnegative(),
});

const normalizedImagePlacementSchema = z.object({
  src: z.string(),
  prompt: z.string().optional().default(""),
  sourceWidth: z.number().positive(),
  sourceHeight: z.number().positive(),
  viewBox: rectSchema,
  clip: rectSchema.optional(),
  transform: z
    .object({
      x: z.number(),
      y: z.number(),
      scaleX: z.number(),
      scaleY: z.number(),
    })
    .optional(),
});

const legacyImagePlacementSchema = z.object({
  src: z.string(),
  prompt: z.string().optional().default(""),
  clip: rectSchema.optional(),
  transform: z
    .object({
      x: z.number(),
      y: z.number(),
      scaleX: z.number(),
      scaleY: z.number(),
    })
    .optional(),
  sourceWidth: z.number().positive().optional(),
  sourceHeight: z.number().positive().optional(),
  viewBox: rectSchema.optional(),
});

export const imagePlacementSchema = z
  .union([normalizedImagePlacementSchema, legacyImagePlacementSchema])
  .transform((value) => {
    if ("viewBox" in value && value.viewBox && "sourceWidth" in value && value.sourceWidth) {
      return {
        src: value.src,
        prompt: value.prompt ?? "",
        sourceWidth: value.sourceWidth,
        sourceHeight: value.sourceHeight,
        viewBox: value.viewBox,
        ...(value.clip !== undefined ? { clip: value.clip } : {}),
        ...(value.transform !== undefined ? { transform: value.transform } : {}),
      };
    }

    const fallbackWidth = value.sourceWidth ?? value.clip?.width ?? 1;
    const fallbackHeight = value.sourceHeight ?? value.clip?.height ?? 1;
    return {
      src: value.src,
      prompt: value.prompt ?? "",
      sourceWidth: fallbackWidth,
      sourceHeight: fallbackHeight,
      viewBox:
        value.viewBox ?? {
          x: 0,
          y: 0,
          width: fallbackWidth,
          height: fallbackHeight,
        },
      ...(value.clip !== undefined ? { clip: value.clip } : {}),
      ...(value.transform !== undefined ? { transform: value.transform } : {}),
    };
  });

const basePanelSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  points: z.array(pointSchema).min(3).optional(),
  style: panelStyleSchema,
  image: imagePlacementSchema.nullable().default(null),
  description: z.string().optional().default(""),
});

export const panelSchema = basePanelSchema.transform((value) => ({
  ...value,
  points:
    value.points ??
    [
      { x: 0, y: 0 },
      { x: value.width, y: 0 },
      { x: value.width, y: value.height },
      { x: 0, y: value.height },
    ],
}));

export const textDirectionSchema = z.enum(["horizontal", "vertical"]);
export const textAlignSchema = z.enum(["left", "center", "right"]);
export const verticalAlignSchema = z.enum(["top", "middle", "bottom"]);

export const textItemSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().default(360),
  height: z.number().positive().default(360),
  content: z.string(),
  fontSize: z.number().positive(),
  fontFamily: z.string(),
  fontWeight: z.number().int().min(100).max(900).default(400),
  letterSpacing: z.number().min(-40).max(160).default(0),
  lineSpacing: z.number().min(-40).max(160).default(0),
  color: z.string(),
  strokeWidth: z.number().nonnegative().default(2),
  strokeColor: z.string().default("#ffffff"),
  direction: textDirectionSchema.default("vertical"),
  textAlign: textAlignSchema.default("left"),
  verticalAlign: verticalAlignSchema.default("top"),
});

export const elementCategorySchema = z.enum(["text", "symbols", "artWords", "effects", "balloons"]);

export const elementItemSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  src: z.string(),
  title: z.string(),
  category: elementCategorySchema.default("symbols"),
  opacity: z.number().min(0).max(1).default(1),
});

export const objectRefSchema = z.object({
  objectType: z.enum(["panel", "text", "bubble", "element"]),
  objectId: z.string(),
});

export const groupSchema = z.object({
  id: z.string(),
  members: z.array(objectRefSchema).min(2),
});

export const BUBBLE_TYPE_VALUES = [
  "round",
  "ellipse",
  "cloud",
  "square",
  "roundedSquare",
  "oval",
  "explosion",
  "thought",
  "jagged",
  "bubbleRound",
  "whisper",
  "scream",
  "burstSoft",
  "hexagon",
  "octagon",
  "diamond",
  "heart",
  "bracket",
  "caption",
  "speed",
  "cloudDense",
  "balloonTall",
  "balloonWide",
  "wave",
  "rough",
  "droplet",
  "arrow",
  "pinched",
  "doubleOutline",
  "electric",
  "custom",
] as const;

export const bubbleTypeSchema = z.enum(BUBBLE_TYPE_VALUES);

const bubbleCustomHandleProfileSchema = z.object({
  // Indices in customPoints that are allowed to move as merge-edit handles.
  movableIndices: z.array(z.number().int().nonnegative()).default([]),
  // Indices in customPoints that stay fixed to preserve preset-shape boundary.
  lockedIndices: z.array(z.number().int().nonnegative()).default([]),
});

export const bubbleSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  contentCenter: pointSchema,
  showTail: z.boolean().default(true),
  // Tail configuration - tail can be attached to any point inside the bubble body
  tailTip: pointSchema,
  tailBase: pointSchema.optional(), // Local point inside the bubble body where the tail connects
  tailBaseAngle: z.number().default(90), // 0-360 degrees, default 90 (bottom)
  tailWidth: z.number().positive().default(24), // Width of tail at base
  bubbleType: bubbleTypeSchema.default("round"),
  strokeWidth: z.number().nonnegative().default(2),
  backgroundColor: z.string().default("#ffffff"),
  strokeColor: z.string().default("#111111"),
  opacity: z.number().min(0).max(1).default(1),
  // Type-specific properties
  cornerRadius: z.number().nonnegative().default(12), // for round, roundedSquare
  bumpiness: z.number().min(0).max(1).default(0.5), // for cloud (0=smooth, 1=very bumpy)
  spikeCount: z.number().int().min(4).max(16).default(8), // for explosion
  spikeDepth: z.number().min(0.2).max(0.8).default(0.5), // for explosion base depth
  spikeDepths: z.array(z.number().min(0.1).max(1)).optional(), // for explosion - individual spike depths
  spikePositions: z.array(pointSchema).optional(), // for explosion - individual spike 2D positions (overrides depth calculation)
  activeSpikeIndex: z.number().int().min(-1).max(15).default(-1), // which spike is being dragged (-1 = none)
  jaggedness: z.number().min(2).max(12).default(6), // for jagged (number of zigzags per edge)
  thoughtCircles: z.number().int().min(2).max(5).default(3), // for thought (number of trailing circles)
  customPoints: z.array(pointSchema).default([]), // for custom click-drawn contour (bubble-local points)
  customSmoothness: z.number().min(0).max(1).default(0.45), // 0 = sharp polygon, 1 = smooth contour
  customPointSmoothness: z.array(z.number().min(0).max(1)).default([]), // per-corner smoothness for customPoints
  customHandleProfile: bubbleCustomHandleProfileSchema.optional(),
});

export const objectTypeSchema = z.enum(["panel", "text", "bubble", "element"]);
export const projectTypeSchema = z.enum(["manga", "cg"]);

export const pageSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string().default("#ffffff"),
  panels: z.array(panelSchema),
  texts: z.array(textItemSchema),
  bubbles: z.array(bubbleSchema),
  elements: z.array(elementItemSchema).default([]),
  groups: z.array(groupSchema).default([]),
  layers: z.array(z.string()),
});

export const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: projectTypeSchema.default("manga"),
  createdAt: z.string(),
  updatedAt: z.string(),
  pages: z.array(pageSchema),
});

export type Point = z.infer<typeof pointSchema>;
export type Rect = z.infer<typeof rectSchema>;
export type PanelStyle = z.infer<typeof panelStyleSchema>;
export type ImagePlacement = z.infer<typeof imagePlacementSchema>;
export type Panel = z.infer<typeof panelSchema>;
export type TextDirection = z.infer<typeof textDirectionSchema>;
export type TextItem = z.infer<typeof textItemSchema>;
export type ElementCategory = z.infer<typeof elementCategorySchema>;
export type ElementItem = z.infer<typeof elementItemSchema>;
export type ObjectRef = z.infer<typeof objectRefSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Bubble = z.infer<typeof bubbleSchema>;
export type BubbleType = z.infer<typeof bubbleTypeSchema>;
export type ObjectType = z.infer<typeof objectTypeSchema>;
export type ProjectType = z.infer<typeof projectTypeSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Project = z.infer<typeof projectSchema>;

