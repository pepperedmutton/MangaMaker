import type { Page } from "../domain/schema";
import { useI18n } from "../i18n/useI18n";

export const PageThumbnail = ({ page }: { page: Page | null }) => {
  const { t } = useI18n();

  if (!page) {
    return (
      <div className="page-thumbnail empty">
        <span>{t("welcome.emptyCover")}</span>
      </div>
    );
  }

  return (
    <div className="page-thumbnail">
      {page.panels.map((panel) => (
        <div
          key={panel.id}
          className="thumb-panel"
          style={{
            left: `${(panel.x / page.width) * 100}%`,
            top: `${(panel.y / page.height) * 100}%`,
            width: `${(panel.width / page.width) * 100}%`,
            height: `${(panel.height / page.height) * 100}%`,
          }}
        />
      ))}
      {page.texts.slice(0, 2).map((text) => (
        <div
          key={text.id}
          className="thumb-text"
          style={{
            left: `${(text.x / page.width) * 100}%`,
            top: `${(text.y / page.height) * 100}%`,
          }}
        />
      ))}
      {page.bubbles.slice(0, 2).map((bubble) => (
        <div
          key={bubble.id}
          className="thumb-bubble"
          style={{
            left: `${(bubble.x / page.width) * 100}%`,
            top: `${(bubble.y / page.height) * 100}%`,
            width: `${(bubble.width / page.width) * 100}%`,
            height: `${(bubble.height / page.height) * 100}%`,
          }}
        />
      ))}
    </div>
  );
};

