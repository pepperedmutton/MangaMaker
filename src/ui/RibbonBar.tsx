import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "../domain/defaults";
import { getToolbarZoomLabel } from "../domain/helpers";
import { translate, type Locale } from "../i18n";
import { LOCAL_FONTS } from "../platform/localFonts";
import type { ToolMode } from "../state/types";

export type TextFormatState = {
  fontFamily: string;
  fontSize: number;
  direction: "horizontal" | "vertical";
  onFontFamilyChange: (value: string) => void;
  onFontSizeChange: (value: number) => void;
  onDirectionChange: (value: "horizontal" | "vertical") => void;
};

export type PageFormatState = {
  background: string;
  onBackgroundChange: (value: string) => void;
};

type RibbonBarProps = {
  locale: Locale;
  activeTool: ToolMode;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  canExport: boolean;
  textFormat?: TextFormatState;
  pageFormat?: PageFormatState;
  onSetTool: (tool: ToolMode) => void;
  onSave: () => void;
  onGoHome: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (zoom: number) => void;
  onSetLocale: (locale: Locale) => void;
};

const Divider = () => <span className="ribbon-divider" aria-hidden="true" />;

const RibbonButton = ({
  label,
  active,
  disabled,
  shortcut,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
  onClick: () => void;
}) => (
  <button
    className={`ribbon-btn${active ? " active" : ""}`}
    disabled={disabled}
    title={shortcut ? `${label} (${shortcut})` : label}
    onClick={onClick}
  >
    <span className="ribbon-label">{label}</span>
  </button>
);

export const RibbonBar = ({
  locale,
  activeTool,
  zoom,
  canUndo,
  canRedo,
  canExport,
  textFormat,
  pageFormat,
  onSetTool,
  onSave,
  onGoHome,
  onExport,
  onUndo,
  onRedo,
  onZoomChange,
  onSetLocale,
}: RibbonBarProps) => {
  const t = (key: string, params?: Record<string, number | string>) =>
    translate(locale, key, params);
  const handleZoomInput = (value: string) => {
    onZoomChange(Number(value));
  };

  return (
    <div className="ribbon-bar">
      <div className="ribbon-group">
        <span className="ribbon-group-label">{t("ribbon.project")}</span>
        <div className="ribbon-group-row">
          <RibbonButton label={t("toolbar.home")} onClick={onGoHome} />
          <RibbonButton label={t("toolbar.save")} shortcut="Ctrl/Cmd+S" onClick={onSave} />
        </div>
      </div>

      <Divider />

      <div className="ribbon-group">
        <span className="ribbon-group-label">{t("toolbar.undo")}</span>
        <div className="ribbon-group-row">
          <RibbonButton
            label={t("toolbar.undo")}
            shortcut="Ctrl/Cmd+Z"
            disabled={!canUndo}
            onClick={onUndo}
          />
          <RibbonButton
            label={t("toolbar.redo")}
            shortcut="Shift+Ctrl/Cmd+Z"
            disabled={!canRedo}
            onClick={onRedo}
          />
        </div>
      </div>

      <Divider />

      <div className="ribbon-group">
        <span className="ribbon-group-label">{t("ribbon.insert")}</span>
        <div className="ribbon-group-row">
          <RibbonButton
            label={t("toolbar.select")}
            shortcut="V"
            active={activeTool === "select"}
            onClick={() => onSetTool("select")}
          />
          <RibbonButton
            label={t("toolbar.panel")}
            shortcut="P"
            active={activeTool === "panel"}
            onClick={() => onSetTool("panel")}
          />
          <RibbonButton
            label={t("toolbar.text")}
            shortcut="T"
            active={activeTool === "text"}
            onClick={() => onSetTool("text")}
          />
          <RibbonButton
            label={t("toolbar.bubble")}
            shortcut="B"
            active={activeTool === "bubble"}
            onClick={() => onSetTool("bubble")}
          />
        </div>
      </div>

      <Divider />

      <div className={`ribbon-group${pageFormat ? "" : " ribbon-group-dim"}`}>
        <span className="ribbon-group-label">{t("ribbon.page")}</span>
        <div className="ribbon-group-row">
          <label className="ribbon-color">
            <span className="ribbon-label">{t("toolbar.pageBackground")}</span>
            <input
              className="ribbon-color-input"
              aria-label={t("toolbar.pageBackground")}
              type="color"
              disabled={!pageFormat}
              value={pageFormat?.background ?? "#ffffff"}
              onChange={(event) => pageFormat?.onBackgroundChange(event.target.value)}
            />
          </label>
        </div>
      </div>

      <Divider />

      <div className={`ribbon-group${textFormat ? "" : " ribbon-group-dim"}`}>
        <span className="ribbon-group-label">{t("ribbon.font")}</span>
        <div className="ribbon-group-row">
          <select
            className="ribbon-font-select"
            disabled={!textFormat}
            value={textFormat?.fontFamily ?? "Arial"}
            style={textFormat ? { fontFamily: textFormat.fontFamily } : undefined}
            onChange={(event) => textFormat?.onFontFamilyChange(event.target.value)}
          >
            {LOCAL_FONTS.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </option>
            ))}
          </select>
          <input
            className="ribbon-font-size"
            type="number"
            min={6}
            max={300}
            step={1}
            disabled={!textFormat}
            value={textFormat?.fontSize ?? 24}
            onChange={(event) => textFormat?.onFontSizeChange(Number(event.target.value))}
          />
          <RibbonButton
            label={t("inspector.textDirectionH")}
            active={textFormat?.direction !== "vertical"}
            disabled={!textFormat}
            onClick={() => textFormat?.onDirectionChange("horizontal")}
          />
          <RibbonButton
            label={t("inspector.textDirectionV")}
            active={textFormat?.direction === "vertical"}
            disabled={!textFormat}
            onClick={() => textFormat?.onDirectionChange("vertical")}
          />
        </div>
      </div>

      <Divider />

      <div className="ribbon-group">
        <span className="ribbon-group-label">{t("ribbon.view")}</span>
        <div className="ribbon-group-row">
          <label className="ribbon-zoom">
            <span className="ribbon-label">{t("toolbar.zoom")}</span>
            <input
              className="ribbon-zoom-slider"
              aria-label={t("toolbar.zoom")}
              aria-valuemin={MIN_ZOOM}
              aria-valuemax={MAX_ZOOM}
              aria-valuenow={zoom}
              aria-valuetext={getToolbarZoomLabel(zoom)}
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoom}
              onInput={(event) => handleZoomInput(event.currentTarget.value)}
              onChange={(event) => handleZoomInput(event.currentTarget.value)}
            />
            <span className="ribbon-zoom-value">{getToolbarZoomLabel(zoom)}</span>
          </label>
          <RibbonButton
            label={t("toolbar.exportPage")}
            shortcut="E"
            disabled={!canExport}
            onClick={onExport}
          />
        </div>
      </div>

      <div className="ribbon-locale">
        <button
          className={`locale-btn${locale === "en" ? " active" : ""}`}
          type="button"
          aria-label={t("language.en")}
          onClick={() => onSetLocale("en")}
        >
          {t("language.en")}
        </button>
        <button
          className={`locale-btn${locale === "zh-CN" ? " active" : ""}`}
          type="button"
          aria-label={t("language.zh-CN")}
          onClick={() => onSetLocale("zh-CN")}
        >
          {t("language.zh-CN")}
        </button>
      </div>
    </div>
  );
};
