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
  direction: textDirectionSchema.default("horizontal"),
  textAlign: textAlignSchema.default("left"),
  verticalAlign: verticalAlignSchema.default("top"),
});

export const bubbleSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  tailTip: pointSchema,
  text: z.string(),
  fontSize: z.number().positive(),
  fontFamily: z.string().default("system-ui"),
  textAlign: textAlignSchema.default("center"),
  verticalAlign: verticalAlignSchema.default("middle"),
});

export const objectTypeSchema = z.enum(["panel", "text", "bubble"]);

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
export type ObjectType = z.infer<typeof objectTypeSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Project = z.infer<typeof projectSchema>;
