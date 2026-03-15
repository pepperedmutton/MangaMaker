import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "../domain/defaults";
import { getToolbarZoomLabel } from "../domain/helpers";
import { translate, type Locale } from "../i18n";
import type { ToolMode } from "../state/types";

export const FONT_BAR_FONT_LIST: string[] = [
  "Arial",
  "Arial Black",
  "Arial Narrow",
  "Arial Rounded MT Bold",
  "Bahnschrift",
  "Book Antiqua",
  "Calibri",
  "Cambria",
  "Candara",
  "Cascadia Code Regular",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "DengXian",
  "Ebrima",
  "FangSong",
  "Franklin Gothic Medium",
  "Gabriola",
  "Garamond",
  "Georgia",
  "Gill Sans MT",
  "Impact",
  "Ink Free",
  "KaiTi",
  "Lato",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Malgun Gothic",
  "Meiryo",
  "Microsoft JhengHei",
  "Microsoft Sans Serif",
  "Microsoft YaHei",
  "MS Gothic",
  "MS Mincho",
  "Noto Sans JP",
  "Noto Sans SC",
  "Noto Serif JP",
  "Noto Serif SC",
  "Palatino Linotype",
  "Rockwell",
  "Segoe Print",
  "Segoe Script",
  "Segoe UI",
  "Segoe UI Variable",
  "SimHei",
  "SimSun",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Yu Gothic",
  "Yu Mincho",
  "方正舒体",
  "方正姚体",
  "华文彩云",
  "华文仿宋",
  "华文琥珀",
  "华文楷体",
  "华文隶书",
  "华文宋体",
  "华文细黑",
  "华文新魏",
  "华文行楷",
  "华文中宋",
  "隶书",
  "幼圆",
];

type FontBarState = {
  fontFamily: string;
  fontSize: number;
  /** text direction — only available for text items */
  direction?: "horizontal" | "vertical";
  onFontFamilyChange: (fontFamily: string) => void;
  onFontSizeChange: (fontSize: number) => void;
  /** undefined means direction toggle is not shown (e.g. bubbles) */
  onDirectionChange?: (direction: "horizontal" | "vertical") => void;
};

type TopToolbarProps = {
  locale: Locale;
  activeTool: ToolMode;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  canImportImage: boolean;
  canExport: boolean;
  importHint: string;
  shortcutHint: string;
  fontBar?: FontBarState;
  onSetTool: (tool: ToolMode) => void;
  onImportImage: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (zoom: number) => void;
  onSetLocale: (locale: Locale) => void;
};

const ToolbarButton = ({
  label,
  shortcut,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  shortcut: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) => (
  <button
    className={active ? "toolbar-button active" : "toolbar-button"}
    disabled={disabled}
    title={title}
    onClick={onClick}
  >
    <span className="button-label">{label}</span>
    <span className="button-shortcut" aria-hidden="true">
      {shortcut}
    </span>
  </button>
);

export const TopToolbar = ({
  locale,
  activeTool,
  zoom,
  canUndo,
  canRedo,
  canImportImage,
  canExport,
  importHint,
  shortcutHint,
  fontBar,
  onSetTool,
  onImportImage,
  onExport,
  onUndo,
  onRedo,
  onZoomChange,
  onSetLocale,
}: TopToolbarProps) => (
  <header className="top-toolbar">
    <div className="toolbar-row">
      <div className="toolbar-group">
        <ToolbarButton
          label={translate(locale, "toolbar.select")}
          shortcut="V"
          active={activeTool === "select"}
          onClick={() => onSetTool("select")}
        />
        <ToolbarButton
          label={translate(locale, "toolbar.panel")}
          shortcut="P"
          active={activeTool === "panel"}
          onClick={() => onSetTool("panel")}
        />
        <ToolbarButton
          label={translate(locale, "toolbar.text")}
          shortcut="T"
          active={activeTool === "text"}
          onClick={() => onSetTool("text")}
        />
        <ToolbarButton
          label={translate(locale, "toolbar.bubble")}
          shortcut="B"
          active={activeTool === "bubble"}
          onClick={() => onSetTool("bubble")}
        />
      </div>
      <div className="toolbar-group toolbar-group-end">
        <ToolbarButton
          label={translate(locale, "toolbar.importImage")}
          shortcut="I"
          disabled={!canImportImage}
          title={!canImportImage ? translate(locale, "toolbar.importDisabledReason") : importHint}
          onClick={onImportImage}
        />
        <ToolbarButton
          label={translate(locale, "toolbar.exportPage")}
          shortcut="E"
          disabled={!canExport}
          onClick={onExport}
        />
        <ToolbarButton
          label={translate(locale, "toolbar.undo")}
          shortcut="Cmd/Ctrl+Z"
          disabled={!canUndo}
          onClick={onUndo}
        />
        <ToolbarButton
          label={translate(locale, "toolbar.redo")}
          shortcut="Shift+Cmd/Ctrl+Z"
          disabled={!canRedo}
          onClick={onRedo}
        />
        <label className="zoom-control">
          <span>{translate(locale, "toolbar.zoom")}</span>
          <input
            aria-label={translate(locale, "toolbar.zoom")}
            aria-valuemin={MIN_ZOOM}
            aria-valuemax={MAX_ZOOM}
            aria-valuenow={zoom}
            aria-valuetext={getToolbarZoomLabel(zoom)}
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_STEP}
            value={zoom}
            onChange={(event) => onZoomChange(Number(event.target.value))}
          />
          <span>{getToolbarZoomLabel(zoom)}</span>
        </label>
        <div className="language-switch" role="group" aria-label={translate(locale, "language.label")}>
          <button
            className={locale === "en" ? "locale-button active" : "locale-button"}
            type="button"
            onClick={() => onSetLocale("en")}
          >
            {translate(locale, "language.en")}
          </button>
          <button
            className={locale === "zh-CN" ? "locale-button active" : "locale-button"}
            type="button"
            onClick={() => onSetLocale("zh-CN")}
          >
            {translate(locale, "language.zh-CN")}
          </button>
        </div>
      </div>
    </div>
    {fontBar && (
      <div className="toolbar-row font-bar">
        <div className="toolbar-group">
          <label className="font-family-control">
            <span>{translate(locale, "inspector.fontFamily")}</span>
            <select
              value={fontBar.fontFamily}
              style={{ fontFamily: fontBar.fontFamily }}
              onChange={(event) => fontBar.onFontFamilyChange(event.target.value)}
            >
              {FONT_BAR_FONT_LIST.map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
          </label>
          <label className="font-size-control">
            <span>{translate(locale, "common.fontSize")}</span>
            <input
              type="number"
              min={6}
              max={300}
              step={1}
              value={fontBar.fontSize}
              onChange={(event) => fontBar.onFontSizeChange(Number(event.target.value))}
            />
          </label>
          {fontBar.onDirectionChange && (
            <div className="toolbar-group direction-group" role="group">
              <button
                className={fontBar.direction !== "vertical" ? "toolbar-button active" : "toolbar-button"}
                title={translate(locale, "inspector.textDirectionH")}
                onClick={() => fontBar.onDirectionChange?.("horizontal")}
              >
                {translate(locale, "inspector.textDirectionH")}
              </button>
              <button
                className={fontBar.direction === "vertical" ? "toolbar-button active" : "toolbar-button"}
                title={translate(locale, "inspector.textDirectionV")}
                onClick={() => fontBar.onDirectionChange?.("vertical")}
              >
                {translate(locale, "inspector.textDirectionV")}
              </button>
            </div>
          )}
        </div>
      </div>
    )}
    <div className="toolbar-meta">
      <p>{importHint}</p>
      <p>{shortcutHint}</p>
    </div>
  </header>
);
