import { getDefaultPageName, type Locale } from "../i18n";

export const getPageDisplayName = (locale: Locale, pageIndex: number) =>
  getDefaultPageName(locale, pageIndex + 1);

export const normalizeProjectPageNames = <T extends { pages: Array<{ name: string }> }>(
  project: T,
  locale: Locale,
): T => {
  let changed = false;
  const pages = project.pages.map((page, pageIndex) => {
    const name = getPageDisplayName(locale, pageIndex);
    if (page.name === name) {
      return page;
    }
    changed = true;
    return {
      ...page,
      name,
    };
  });

  return changed
    ? {
        ...project,
        pages,
      }
    : project;
};
