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
  color: z.string(),
  direction: textDirectionSchema.default("vertical"),
  textAlign: textAlignSchema.default("left"),
  verticalAlign: verticalAlignSchema.default("top"),
});

export const bubbleTypeSchema = z.enum([
  "round",      // 圆角矩形
  "ellipse",    // 椭圆
  "cloud",      // 云朵
  "square",     // 方形
  "roundedSquare", // 圆角方形（更大圆角）
  "oval",       // 长椭圆
  "explosion",  // 爆炸形
  "thought",    // 思考气泡
  "jagged",     // 锯齿形
  "bubbleRound", // 圆形气泡
]);

export const bubbleSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  // Tail configuration - tail can be attached to any point inside the bubble body
  tailTip: pointSchema,
  tailBase: pointSchema.optional(), // Local point inside the bubble body where the tail connects
  tailBaseAngle: z.number().default(90), // 0-360 degrees, default 90 (bottom)
  tailWidth: z.number().positive().default(24), // Width of tail at base
  text: z.string(),
  fontSize: z.number().positive(),
  fontFamily: z.string().default("system-ui"),
  direction: textDirectionSchema.default("vertical"),
  textAlign: textAlignSchema.default("center"),
  verticalAlign: verticalAlignSchema.default("middle"),
  bubbleType: bubbleTypeSchema.default("round"),
  strokeWidth: z.number().nonnegative().default(2),
  backgroundColor: z.string().default("#ffffff"),
  strokeColor: z.string().default("#111111"),
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
});

export const objectTypeSchema = z.enum(["panel", "text", "bubble"]);
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
export type Bubble = z.infer<typeof bubbleSchema>;
export type BubbleType = z.infer<typeof bubbleTypeSchema>;
export type ObjectType = z.infer<typeof objectTypeSchema>;
export type ProjectType = z.infer<typeof projectTypeSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Project = z.infer<typeof projectSchema>;
