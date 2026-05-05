import { z } from "zod";
import { DEFAULT_TEXT_INSERT_DEFAULTS } from "../domain/defaults";
import { DEFAULT_TEXT_FONT_FAMILY, isSupportedFontFamily } from "../platform/localFonts";
import type { TextInsertDefaults } from "../state/types";

const TEXT_INSERT_DEFAULTS_KEY = "mangamaker:text-insert-defaults:v1";

const textInsertDefaultsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  fontFamily: z.string().min(1),
  fontSize: z.number().positive(),
  fontWeight: z.number().int().min(100).max(900),
  letterSpacing: z.number().min(-40).max(160),
  lineSpacing: z.number().min(-40).max(160),
  strokeWidth: z.number().nonnegative(),
  strokeColor: z.string().min(1),
});

const cloneDefaultTextInsertDefaults = (): TextInsertDefaults => ({
  ...DEFAULT_TEXT_INSERT_DEFAULTS,
});

const sanitizeFontFamily = (fontFamily: string) =>
  isSupportedFontFamily(fontFamily) ? fontFamily : DEFAULT_TEXT_FONT_FAMILY;

export const loadStoredTextInsertDefaults = (): TextInsertDefaults => {
  if (typeof window === "undefined") {
    return cloneDefaultTextInsertDefaults();
  }
  try {
    const raw = window.localStorage.getItem(TEXT_INSERT_DEFAULTS_KEY);
    if (!raw) {
      return cloneDefaultTextInsertDefaults();
    }
    const parsed = textInsertDefaultsSchema.partial().parse(JSON.parse(raw));
    return {
      ...DEFAULT_TEXT_INSERT_DEFAULTS,
      ...parsed,
      fontFamily: sanitizeFontFamily(parsed.fontFamily ?? DEFAULT_TEXT_INSERT_DEFAULTS.fontFamily),
    };
  } catch (error) {
    console.warn("Failed to load text insert defaults from localStorage:", error);
    return cloneDefaultTextInsertDefaults();
  }
};

export const persistTextInsertDefaults = (defaults: TextInsertDefaults) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const parsed = textInsertDefaultsSchema.parse({
      ...defaults,
      fontFamily: sanitizeFontFamily(defaults.fontFamily),
    });
    window.localStorage.setItem(TEXT_INSERT_DEFAULTS_KEY, JSON.stringify(parsed));
  } catch (error) {
    console.warn("Failed to persist text insert defaults to localStorage:", error);
  }
};
