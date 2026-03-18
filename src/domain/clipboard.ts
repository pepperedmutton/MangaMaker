import { z } from "zod";
import { bubbleSchema, pageSchema, panelSchema, textItemSchema } from "./schema";

export const MANGAMAKER_CLIPBOARD_SIGNATURE = "mangamaker-clipboard/v1";

export const clipboardItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("page"),
    page: pageSchema,
  }),
  z.object({
    kind: z.literal("panel"),
    panel: panelSchema,
  }),
  z.object({
    kind: z.literal("text"),
    text: textItemSchema,
  }),
  z.object({
    kind: z.literal("bubble"),
    bubble: bubbleSchema,
  }),
]);

export const clipboardEnvelopeSchema = z.object({
  signature: z.literal(MANGAMAKER_CLIPBOARD_SIGNATURE),
  copiedAt: z.string(),
  sourceProjectId: z.string(),
  item: clipboardItemSchema,
});

export type ClipboardItem = z.infer<typeof clipboardItemSchema>;
export type ClipboardEnvelope = z.infer<typeof clipboardEnvelopeSchema>;

export const serializeClipboardEnvelope = (payload: ClipboardEnvelope) =>
  JSON.stringify(payload);

export const parseClipboardEnvelope = (rawText: string) => {
  try {
    const parsed = JSON.parse(rawText);
    return clipboardEnvelopeSchema.parse(parsed);
  } catch {
    return null;
  }
};

