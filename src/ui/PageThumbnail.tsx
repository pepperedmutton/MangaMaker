import type { Page, Panel } from "../domain/schema";
import { useI18n } from "../i18n/useI18n";

const getPanelAbsolutePoints = (panel: Panel) =>
  panel.points.map((point) => `${panel.x + point.x},${panel.y + point.y}`).join(" ");

const getPanelImageMetrics = (panel: Panel) => {
  if (!panel.image) {
    return null;
  }

  const viewBox = panel.image.viewBox;
  const sourceWidth = panel.image.sourceWidth ?? viewBox.width;
  const sourceHeight = panel.image.sourceHeight ?? viewBox.height;

  return {
    x: panel.x - (viewBox.x / viewBox.width) * panel.width,
    y: panel.y - (viewBox.y / viewBox.height) * panel.height,
    width: (sourceWidth / viewBox.width) * panel.width,
    height: (sourceHeight / viewBox.height) * panel.height,
    src: panel.image.src,
  };
};

const toSafeClipId = (pageId: string, panelId: string) =>
  `thumb-clip-${pageId}-${panelId}`.replace(/[^a-zA-Z0-9-_]/g, "-");

export const PageThumbnail = ({
  page,
  displayName,
}: {
  page: Page | null;
  displayName?: string;
}) => {
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
      <svg
        className="page-thumbnail-svg"
        viewBox={`0 0 ${page.width} ${page.height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label={`${displayName ?? page.name} thumbnail`}
      >
        <defs>
          {page.panels.map((panel) => (
            <clipPath key={`clip-${panel.id}`} id={toSafeClipId(page.id, panel.id)}>
              <polygon points={getPanelAbsolutePoints(panel)} />
            </clipPath>
          ))}
        </defs>
        <rect x={0} y={0} width={page.width} height={page.height} fill={page.background} />
        {page.panels.map((panel) => {
          const absolutePoints = getPanelAbsolutePoints(panel);
          const imageMetrics = getPanelImageMetrics(panel);
          const clipId = toSafeClipId(page.id, panel.id);
          return (
            <g key={panel.id}>
              <polygon points={absolutePoints} fill={panel.style.fill} />
              {imageMetrics ? (
                <image
                  href={imageMetrics.src}
                  x={imageMetrics.x}
                  y={imageMetrics.y}
                  width={imageMetrics.width}
                  height={imageMetrics.height}
                  preserveAspectRatio="none"
                  clipPath={`url(#${clipId})`}
                />
              ) : null}
              <polygon
                points={absolutePoints}
                fill="none"
                stroke={panel.style.stroke}
                strokeWidth={Math.max(3, panel.style.strokeWidth * 0.55)}
              />
            </g>
          );
        })}
        {page.bubbles.slice(0, 3).map((bubble) => (
          <rect
            key={bubble.id}
            x={bubble.x}
            y={bubble.y}
            width={bubble.width}
            height={bubble.height}
            rx={18}
            ry={18}
            fill="rgba(255,255,255,0.7)"
            stroke="#111111"
            strokeWidth={3}
          />
        ))}
        {page.texts.slice(0, 3).map((text) => (
          <line
            key={text.id}
            x1={text.x}
            y1={text.y + text.fontSize * 0.7}
            x2={Math.min(page.width, text.x + text.width * 0.75)}
            y2={text.y + text.fontSize * 0.7}
            stroke="#111111"
            strokeWidth={12}
            strokeLinecap="round"
          />
        ))}
      </svg>
    </div>
  );
};
