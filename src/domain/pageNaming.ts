import { getDefaultPageName, type Locale } from "../i18n";

export const getPageDisplayName = (locale: Locale, pageIndex: number) =>
  getDefaultPageName(locale, pageIndex + 1);
