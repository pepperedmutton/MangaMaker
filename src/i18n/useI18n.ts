import { translate, type TranslationKey } from ".";
import { useEditorStore } from "../state/editorStore";

export const useI18n = () => {
  const locale = useEditorStore((state) => state.locale);

  return {
    locale,
    t: (key: TranslationKey, params?: Record<string, number | string>) =>
      translate(locale, key, params),
  };
};
