import {
  getPageWorkspace,
  getSelectedObject,
} from "../domain/helpers";
import {
  createDefaultBubble,
  MIN_PANEL_SIZE,
} from "../domain/defaults";
import type { Bubble, Page, Panel, TextItem } from "../domain/schema";
import { formatLocaleTime } from "../i18n";
import { useI18n } from "../i18n/useI18n";
import { CURATED_FONTS } from "../platform/localFonts";
import type { ToolMode } from "../state/types";
import { useEditorStore } from "../state/editorStore";
import { getBubbleBodyPath } from "./bubbleShapes";

// Reusable range input with slider and number field
const RangeInput = ({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) => {
  return (
    <div className="range-input">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
};

type InspectorProps = {
  page: Page | null;
  activeTool: ToolMode;
  onExportProjectPdf: () => void;
  onExportProjectJpgZip: () => void;
  onImportImage: () => void;
  onCreatePanel?: () => void;
  onInsertBubble?: (bubbleType: Exclude<Bubble["bubbleType"], "custom">) => void;
};

const DeleteButton = ({
  pageId,
  objectType,
  objectId,
}: {
  pageId: string;
  objectType: "panel" | "text" | "bubble";
  objectId: string;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const { t } = useI18n();

  return (
    <button
      className="insp-delete-btn"
      title={t("inspector.deleteSelected")}
      onClick={() => {
        void executeCommand("deleteObject", {
          pageId,
          objectType,
          objectId,
        });
      }}
    >
      {t("sidebar.delete")}
    </button>
  );
};

const PanelInspector = ({
  page,
  panel,
  onImportImage,
}: {
  page: Page;
  panel: Panel;
  onImportImage: () => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const { t } = useI18n();
  const workspace = getPageWorkspace(page);
  const maxPanelX = Math.ceil(workspace.x + workspace.width - panel.width);
  const maxPanelY = Math.ceil(workspace.y + workspace.height - panel.height);

  return (
    <>
      <section>
        <div className="insp-header">
          <p className="eyebrow">{t("common.panel")}</p>
          <DeleteButton pageId={page.id} objectType="panel" objectId={panel.id} />
        </div>
        <h3>{t("common.panel")}</h3>
        <p>{panel.image ? t("inspector.editImageHint") : t("inspector.importImageHint")}</p>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.imageSection")}</p>
        <div className="insp-image-actions">
          <button className="primary-button" onClick={onImportImage}>
            {panel.image ? t("inspector.replaceImage") : t("toolbar.importImage")}
          </button>
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.panelDescriptionSection")}</p>
        <p>{t("inspector.panelDescriptionHint")}</p>
        <textarea
          rows={5}
          value={panel.description}
          placeholder={t("inspector.panelDescriptionPlaceholder")}
          onChange={(event) =>
            void executeCommand("setPanelDescription", {
              pageId: page.id,
              panelId: panel.id,
              description: event.target.value,
            })
          }
        />
      </section>

      <section>
        <p className="eyebrow">{t("inspector.pointCount", { count: panel.points.length })}</p>
        <div className="vertex-list">
          {panel.points.map((point, index) => (
            <div key={`${panel.id}-point-${index}`} className="vertex-row">
              <span className="vertex-index">{index + 1}</span>
              <span className="vertex-coord">
                {Math.round(point.x)}, {Math.round(point.y)}
              </span>
              {panel.points.length > 3 ? (
                <button
                  className="vertex-remove"
                  title={t("inspector.removePoint")}
                  onClick={() =>
                    void executeCommand("removePanelPoint", {
                      pageId: page.id,
                      panelId: panel.id,
                      pointIndex: index,
                    })
                  }
                >
                  {t("inspector.removePoint")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <button
          className="primary-button insp-full-btn"
          onClick={() =>
            void executeCommand("addPanelPoint", {
              pageId: page.id,
              panelId: panel.id,
            })
          }
        >
          {t("inspector.addPoint")}
        </button>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.sizeSection")}</p>
        <div className="field-grid">
          <label>
            <span>{t("common.width")}</span>
            <RangeInput
              min={MIN_PANEL_SIZE}
              max={Math.ceil(workspace.width)}
              step={1}
              value={Math.round(panel.width)}
              onChange={(value) =>
                void executeCommand("resizePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  width: value,
                  height: panel.height,
                })
              }
            />
          </label>
          <label>
            <span>{t("common.height")}</span>
            <RangeInput
              min={MIN_PANEL_SIZE}
              max={Math.ceil(workspace.height)}
              step={1}
              value={Math.round(panel.height)}
              onChange={(value) =>
                void executeCommand("resizePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  width: panel.width,
                  height: value,
                })
              }
            />
          </label>
          <label>
            <span>{t("common.x")}</span>
            <RangeInput
              min={Math.floor(workspace.x)}
              max={maxPanelX}
              step={1}
              value={Math.round(panel.x)}
              onChange={(value) =>
                void executeCommand("movePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  x: value,
                  y: panel.y,
                })
              }
            />
          </label>
          <label>
            <span>{t("common.y")}</span>
            <RangeInput
              min={Math.floor(workspace.y)}
              max={maxPanelY}
              step={1}
              value={Math.round(panel.y)}
              onChange={(value) =>
                void executeCommand("movePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  x: panel.x,
                  y: value,
                })
              }
            />
          </label>
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.styleSection")}</p>
        <div className="field-grid">
          <label>
            <span>{t("common.fill")}</span>
            <input
              type="color"
              value={panel.style.fill}
              onChange={(event) =>
                void executeCommand("setPanelStyle", {
                  pageId: page.id,
                  panelId: panel.id,
                  fill: event.target.value,
                })
              }
            />
          </label>
          <label>
            <span>{t("common.border")}</span>
            <input
              type="color"
              value={panel.style.stroke}
              onChange={(event) =>
                void executeCommand("setPanelStyle", {
                  pageId: page.id,
                  panelId: panel.id,
                  stroke: event.target.value,
                })
              }
            />
          </label>
          <label>
            <span>{t("common.borderWidth")}</span>
            <RangeInput
              min={0}
              max={20}
              step={1}
              value={panel.style.strokeWidth}
              onChange={(value) =>
                void executeCommand("setPanelStyle", {
                  pageId: page.id,
                  panelId: panel.id,
                  strokeWidth: value,
                })
              }
            />
          </label>
          <label>
            <span>{t("common.cornerRadius")}</span>
            <RangeInput
              min={0}
              max={Math.ceil(Math.min(panel.width, panel.height) * 0.5)}
              step={1}
              value={panel.style.cornerRadius}
              onChange={(value) =>
                void executeCommand("setPanelStyle", {
                  pageId: page.id,
                  panelId: panel.id,
                  cornerRadius: value,
                })
              }
            />
          </label>
        </div>
      </section>
    </>
  );
};

const PanelDescriptionList = ({ page }: { page: Page }) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const { t } = useI18n();

  const orderedPanels = page.layers
    .filter((layer) => layer.startsWith("panel:"))
    .map((layer) => page.panels.find((panel) => panel.id === layer.slice("panel:".length)) ?? null)
    .filter((panel): panel is Panel => panel !== null);
  const orderedIds = new Set(orderedPanels.map((panel) => panel.id));
  const missingPanels = page.panels.filter((panel) => !orderedIds.has(panel.id));
  const displayPanels = [...orderedPanels, ...missingPanels];

  return (
    <section>
      <p className="eyebrow">{t("inspector.panelDescriptionList")}</p>
      {displayPanels.length === 0 ? (
        <p className="hint">{t("inspector.panelDescriptionEmpty")}</p>
      ) : (
        <div className="panel-description-list">
          {displayPanels.map((panel, index) => (
            <label key={`${panel.id}-description`} className="panel-description-item">
              <span>{t("inspector.panelDescriptionItem", { index: index + 1 })}</span>
              <textarea
                rows={3}
                value={panel.description}
                placeholder={t("inspector.panelDescriptionPlaceholder")}
                onChange={(event) =>
                  void executeCommand("setPanelDescription", {
                    pageId: page.id,
                    panelId: panel.id,
                    description: event.target.value,
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
};

const TextInspector = ({ page, text }: { page: Page; text: TextItem }) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const { t } = useI18n();

  return (
    <>
      <section>
        <div className="insp-header">
          <p className="eyebrow">{t("common.text")}</p>
          <DeleteButton pageId={page.id} objectType="text" objectId={text.id} />
        </div>
        <h3>{t("common.text")}</h3>
      </section>

      <section>
        <p className="eyebrow">{t("common.content")}</p>
        <textarea
          rows={6}
          value={text.content}
          onChange={(event) =>
            void executeCommand("updateText", {
              pageId: page.id,
              textId: text.id,
              content: event.target.value,
            })
          }
        />
      </section>

      <section>
        <p className="eyebrow">{t("inspector.fontSection")}</p>
        <div className="field-grid">
          <label>
            <span>{t("inspector.fontFamily")}</span>
            <select
              value={text.fontFamily}
              style={{ fontFamily: text.fontFamily }}
              onChange={(event) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  fontFamily: event.target.value,
                })
              }
            >
              {CURATED_FONTS.map((font) => (
                <option
                  key={font.fontFamily}
                  value={font.fontFamily}
                  style={{ fontFamily: font.fontFamily }}
                >
                  {font.nameCn} ({font.fontFamily})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("common.fontSize")}</span>
            <RangeInput
              min={6}
              max={300}
              step={1}
              value={text.fontSize}
              onChange={(value) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  fontSize: value,
                })
              }
            />
          </label>
          <label>
            <span>{t("inspector.fontWeight")}</span>
            <RangeInput
              min={100}
              max={900}
              step={100}
              value={text.fontWeight}
              onChange={(value) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  fontWeight: Math.round(value / 100) * 100,
                })
              }
            />
          </label>
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.textDirection")}</p>
        <div className="insp-seg">
          <button
            className={text.direction === "horizontal" ? "active" : ""}
            onClick={() =>
              void executeCommand("updateText", {
                pageId: page.id,
                textId: text.id,
                direction: "horizontal",
              })
            }
          >
            {t("inspector.textDirectionH")}
          </button>
          <button
            className={text.direction === "vertical" ? "active" : ""}
            onClick={() =>
              void executeCommand("updateText", {
                pageId: page.id,
                textId: text.id,
                direction: "vertical",
              })
            }
          >
            {t("inspector.textDirectionV")}
          </button>
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.textAlign")}</p>
        <div className="insp-seg">
          <button
            className={text.textAlign === "left" ? "active" : ""}
            onClick={() =>
              void executeCommand("updateText", {
                pageId: page.id,
                textId: text.id,
                textAlign: "left",
              })
            }
          >
            {t("inspector.textAlignLeft")}
          </button>
          <button
            className={text.textAlign === "center" ? "active" : ""}
            onClick={() =>
              void executeCommand("updateText", {
                pageId: page.id,
                textId: text.id,
                textAlign: "center",
              })
            }
          >
            {t("inspector.textAlignCenter")}
          </button>
          <button
            className={text.textAlign === "right" ? "active" : ""}
            onClick={() =>
              void executeCommand("updateText", {
                pageId: page.id,
                textId: text.id,
                textAlign: "right",
              })
            }
          >
            {t("inspector.textAlignRight")}
          </button>
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.verticalAlign")}</p>
        <div className="insp-seg">
          <button
            className={text.verticalAlign === "top" ? "active" : ""}
            onClick={() =>
              void executeCommand("updateText", {
                pageId: page.id,
                textId: text.id,
                verticalAlign: "top",
              })
            }
          >
            {t("inspector.verticalAlignTop")}
          </button>
          <button
            className={text.verticalAlign === "middle" ? "active" : ""}
            onClick={() =>
              void executeCommand("updateText", {
                pageId: page.id,
                textId: text.id,
                verticalAlign: "middle",
              })
            }
          >
            {t("inspector.verticalAlignMiddle")}
          </button>
          <button
            className={text.verticalAlign === "bottom" ? "active" : ""}
            onClick={() =>
              void executeCommand("updateText", {
                pageId: page.id,
                textId: text.id,
                verticalAlign: "bottom",
              })
            }
          >
            {t("inspector.verticalAlignBottom")}
          </button>
        </div>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.textStyle")}</p>
        <div className="field-grid">
          <label>
            <span>{t("common.color")}</span>
            <input
              type="color"
              value={text.color}
              onChange={(event) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  color: event.target.value,
                })
              }
            />
          </label>
          <label>
            <span>{t("inspector.letterSpacing")}</span>
            <RangeInput
              min={-20}
              max={120}
              step={1}
              value={Math.round(text.letterSpacing)}
              onChange={(value) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  letterSpacing: value,
                })
              }
            />
          </label>
          <label>
            <span>{t("inspector.lineSpacing")}</span>
            <RangeInput
              min={-20}
              max={120}
              step={1}
              value={Math.round(text.lineSpacing)}
              onChange={(value) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  lineSpacing: value,
                })
              }
            />
          </label>
        </div>
      </section>
    </>
  );
};

const PRESET_BUBBLE_TYPES: Array<{
  type: Exclude<Bubble["bubbleType"], "custom">;
  labelKey: string;
}> = [
  { type: "round", labelKey: "inspector.bubbleType.round" },
  { type: "ellipse", labelKey: "inspector.bubbleType.ellipse" },
  { type: "cloud", labelKey: "inspector.bubbleType.cloud" },
  { type: "square", labelKey: "inspector.bubbleType.square" },
  { type: "roundedSquare", labelKey: "inspector.bubbleType.roundedSquare" },
  { type: "oval", labelKey: "inspector.bubbleType.oval" },
  { type: "explosion", labelKey: "inspector.bubbleType.explosion" },
  { type: "thought", labelKey: "inspector.bubbleType.thought" },
  { type: "jagged", labelKey: "inspector.bubbleType.jagged" },
  { type: "bubbleRound", labelKey: "inspector.bubbleType.bubbleRound" },
  { type: "whisper", labelKey: "inspector.bubbleType.whisper" },
  { type: "scream", labelKey: "inspector.bubbleType.scream" },
  { type: "burstSoft", labelKey: "inspector.bubbleType.burstSoft" },
  { type: "hexagon", labelKey: "inspector.bubbleType.hexagon" },
  { type: "octagon", labelKey: "inspector.bubbleType.octagon" },
  { type: "diamond", labelKey: "inspector.bubbleType.diamond" },
  { type: "heart", labelKey: "inspector.bubbleType.heart" },
  { type: "bracket", labelKey: "inspector.bubbleType.bracket" },
  { type: "caption", labelKey: "inspector.bubbleType.caption" },
  { type: "speed", labelKey: "inspector.bubbleType.speed" },
  { type: "cloudDense", labelKey: "inspector.bubbleType.cloudDense" },
  { type: "balloonTall", labelKey: "inspector.bubbleType.balloonTall" },
  { type: "balloonWide", labelKey: "inspector.bubbleType.balloonWide" },
  { type: "wave", labelKey: "inspector.bubbleType.wave" },
  { type: "rough", labelKey: "inspector.bubbleType.rough" },
  { type: "droplet", labelKey: "inspector.bubbleType.droplet" },
  { type: "arrow", labelKey: "inspector.bubbleType.arrow" },
  { type: "pinched", labelKey: "inspector.bubbleType.pinched" },
  { type: "doubleOutline", labelKey: "inspector.bubbleType.doubleOutline" },
  { type: "electric", labelKey: "inspector.bubbleType.electric" },
];

const BUBBLE_TYPES: Array<{ type: Bubble["bubbleType"]; labelKey: string }> = [
  ...PRESET_BUBBLE_TYPES,
  { type: "custom", labelKey: "inspector.bubbleType.custom" },
];

const BubbleInsertLibrary = ({
  onInsertBubble,
}: {
  onInsertBubble?: (bubbleType: Exclude<Bubble["bubbleType"], "custom">) => void;
}) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const bubbleInsert = useEditorStore((state) => state.bubbleInsert);
  const { t } = useI18n();
  const presetModeActive = bubbleInsert.mode === "preset";

  return (
    <>
      <section>
        <p className="eyebrow">{t("inspector.insertBubble")}</p>
        <h3>{t("inspector.insertBubble")}</h3>
        <p>{t("inspector.bubbleInsertModeHint")}</p>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.bubbleInsertMode")}</p>
        <div className="insp-seg">
          <button
            className={presetModeActive ? "active" : ""}
            onClick={() =>
              void executeCommand("setBubbleInsertState", {
                mode: "preset",
              })
            }
          >
            {t("inspector.bubbleInsertModePreset")}
          </button>
          <button
            className={presetModeActive ? "" : "active"}
            onClick={() =>
              void executeCommand("setBubbleInsertState", {
                mode: "customClickDraw",
              })
            }
          >
            {t("inspector.bubbleInsertModeCustom")}
          </button>
        </div>
      </section>

      {presetModeActive ? (
        <section>
          <p className="eyebrow">{t("inspector.insertBubble")}</p>
          <p>{t("inspector.bubbleInsertPresetHint")}</p>
          <div className="bubble-library-grid">
            {PRESET_BUBBLE_TYPES.map(({ type, labelKey }) => {
              const previewBubble: Bubble = {
                id: `preview-${type}`,
                ...createDefaultBubble({
                  x: 0,
                  y: 0,
                  width: 92,
                  height: 68,
                  showTail: false,
                  bubbleType: type,
                  bumpiness: 0.75,
                  spikeCount: 10,
                  jaggedness: 8,
                }),
              };

              return (
                <button
                  key={type}
                  type="button"
                  className={`bubble-library-item${
                    bubbleInsert.presetBubbleType === type ? " active" : ""
                  }`}
                  onClick={() => {
                    void executeCommand("setBubbleInsertState", {
                      mode: "preset",
                      presetBubbleType: type,
                    });
                    onInsertBubble?.(type);
                  }}
                  title={t(labelKey)}
                >
                  <svg viewBox="-8 -8 108 84" role="img" aria-label={t(labelKey)}>
                    <path
                      d={getBubbleBodyPath(previewBubble)}
                      fill="#ffffff"
                      stroke="#111111"
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{t(labelKey)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section>
          <p className="eyebrow">{t("inspector.bubbleInsertCustomSettings")}</p>
          <p>{t("inspector.bubbleInsertCustomHint")}</p>
          <div className="field-grid">
            <label>
              <span>{t("inspector.bubbleInsertSmoothness")}</span>
              <RangeInput
                min={0}
                max={1}
                step={0.01}
                value={bubbleInsert.customSmoothness}
                onChange={(value) =>
                  void executeCommand("setBubbleInsertState", {
                    customSmoothness: value,
                  })
                }
              />
            </label>
          </div>
          <p>{t("inspector.bubbleInsertCustomHintDetail")}</p>
          <p>{t("inspector.bubbleInsertCustomHintClose")}</p>
          <p>{t("inspector.bubbleInsertCustomHintCancel")}</p>
        </section>
      )}
    </>
  );
};

const BubbleInspector = ({ page, bubble }: { page: Page; bubble: Bubble }) => {
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const { t } = useI18n();

  return (
    <>
      <section>
        <div className="insp-header">
          <p className="eyebrow">{t("common.bubble")}</p>
          <DeleteButton pageId={page.id} objectType="bubble" objectId={bubble.id} />
        </div>
        <h3>{t("common.bubble")}</h3>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.bubbleType")}</p>
        <select
          value={bubble.bubbleType}
          onChange={(event) =>
            void executeCommand("updateBubble", {
              pageId: page.id,
              bubbleId: bubble.id,
              bubbleType: event.target.value as Bubble["bubbleType"],
            })
          }
        >
          {BUBBLE_TYPES.map(({ type, labelKey }) => (
            <option key={type} value={type}>
              {t(labelKey)}
            </option>
          ))}
        </select>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.bubbleStyle")}</p>
        <div className="field-grid">
          <label>
            <span>{t("inspector.strokeWidth")}</span>
            <RangeInput
              min={0}
              max={10}
              step={0.5}
              value={bubble.strokeWidth}
              onChange={(value) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  strokeWidth: value,
                })
              }
            />
          </label>
          <label>
            <span>{t("inspector.opacity")}</span>
            <RangeInput
              min={0}
              max={1}
              step={0.01}
              value={bubble.opacity}
              onChange={(value) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  opacity: value,
                })
              }
            />
          </label>
          {bubble.bubbleType === "custom" ? (
            <label>
              <span>{t("inspector.bubbleInsertSmoothness")}</span>
              <RangeInput
                min={0}
                max={1}
                step={0.01}
                value={bubble.customSmoothness}
                onChange={(value) =>
                  void executeCommand("updateBubble", {
                    pageId: page.id,
                    bubbleId: bubble.id,
                    customSmoothness: value,
                  })
                }
              />
            </label>
          ) : null}
          {(bubble.bubbleType === "round" || bubble.bubbleType === "roundedSquare") && (
            <label>
              <span>{t("inspector.cornerRadius")}</span>
              <RangeInput
                min={0}
                max={Math.ceil(Math.min(bubble.width, bubble.height) * 0.5)}
                step={1}
                value={bubble.cornerRadius}
                onChange={(value) =>
                  void executeCommand("updateBubble", {
                    pageId: page.id,
                    bubbleId: bubble.id,
                    cornerRadius: value,
                  })
                }
              />
            </label>
          )}
          {bubble.bubbleType === "cloud" && (
            <label>
              <span>{t("inspector.bumpiness")}</span>
              <RangeInput
                min={0}
                max={1}
                step={0.01}
                value={bubble.bumpiness}
                onChange={(value) =>
                  void executeCommand("updateBubble", {
                    pageId: page.id,
                    bubbleId: bubble.id,
                    bumpiness: value,
                  })
                }
              />
            </label>
          )}
          {bubble.bubbleType === "explosion" && (
            <>
              <label>
                <span>{t("inspector.spikeCount")}</span>
                <RangeInput
                  min={4}
                  max={16}
                  step={1}
                  value={bubble.spikeCount}
                  onChange={(value) =>
                    void executeCommand("updateBubble", {
                      pageId: page.id,
                      bubbleId: bubble.id,
                      spikeCount: Math.round(value),
                    })
                  }
                />
              </label>
              <label>
                <span>{t("inspector.spikeDepth")}</span>
                <RangeInput
                  min={0.2}
                  max={0.8}
                  step={0.01}
                  value={bubble.spikeDepth}
                  onChange={(value) =>
                    void executeCommand("updateBubble", {
                      pageId: page.id,
                      bubbleId: bubble.id,
                      spikeDepth: value,
                    })
                  }
                />
              </label>
            </>
          )}
          {bubble.bubbleType === "jagged" && (
            <label>
              <span>{t("inspector.jaggedness")}</span>
                <RangeInput
                  min={2}
                  max={12}
                  step={1}
                  value={bubble.jaggedness}
                  onChange={(value) =>
                    void executeCommand("updateBubble", {
                      pageId: page.id,
                      bubbleId: bubble.id,
                      jaggedness: Math.round(value),
                    })
                  }
                />
              </label>
          )}
          {bubble.bubbleType === "thought" && bubble.showTail && (
            <label>
              <span>{t("inspector.thoughtCircles")}</span>
                <RangeInput
                  min={2}
                  max={5}
                  step={1}
                  value={bubble.thoughtCircles}
                  onChange={(value) =>
                    void executeCommand("updateBubble", {
                      pageId: page.id,
                      bubbleId: bubble.id,
                      thoughtCircles: Math.round(value),
                    })
                  }
                />
              </label>
          )}
          {bubble.bubbleType !== "explosion" && (
            <>
              <label>
                <span>{t("inspector.tailVisibility")}</span>
                <div className="insp-seg">
                  <button
                    className={bubble.showTail ? "active" : ""}
                    onClick={() =>
                      void executeCommand("updateBubble", {
                        pageId: page.id,
                        bubbleId: bubble.id,
                        showTail: true,
                      })
                    }
                  >
                    {t("inspector.tailVisible")}
                  </button>
                  <button
                    className={bubble.showTail ? "" : "active"}
                    onClick={() =>
                      void executeCommand("updateBubble", {
                        pageId: page.id,
                        bubbleId: bubble.id,
                        showTail: false,
                      })
                    }
                  >
                    {t("inspector.tailHidden")}
                  </button>
                </div>
              </label>
              {bubble.showTail ? (
                <label>
                  <span>{t("inspector.tailWidth")}</span>
                  <RangeInput
                    min={8}
                    max={96}
                    step={1}
                    value={bubble.tailWidth}
                    onChange={(value) =>
                      void executeCommand("updateBubble", {
                        pageId: page.id,
                        bubbleId: bubble.id,
                        tailWidth: value,
                      })
                    }
                  />
                </label>
              ) : null}
            </>
          )}
          {bubble.bubbleType === "explosion" && (
            <button
              className="primary-button"
              onClick={() =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  spikeDepths: [], // Reset to empty array, will use base spikeDepth
                  spikePositions: [], // Reset positions too
                })
              }
            >
              {t("inspector.resetSpikeDepths")}
            </button>
          )}
          <label>
            <span>{t("inspector.backgroundColor")}</span>
            <input
              type="color"
              value={bubble.backgroundColor}
              onChange={(event) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  backgroundColor: event.target.value,
                })
              }
            />
          </label>
          <label>
            <span>{t("inspector.strokeColor")}</span>
            <input
              type="color"
              value={bubble.strokeColor}
              onChange={(event) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  strokeColor: event.target.value,
                })
              }
            />
          </label>
        </div>
      </section>
    </>
  );
};

const getRecommendedNextStepKey = (page: Page) => {
  if (page.panels.length === 0) {
    return "inspector.nextStep.addPanel";
  }
  if (!page.panels.some((panel) => panel.image)) {
    return "inspector.nextStep.importImage";
  }
  if (page.texts.length === 0 && page.bubbles.length === 0) {
    return "inspector.nextStep.addDialogue";
  }
  return "inspector.nextStep.export";
};

export const Inspector = ({
  page,
  activeTool,
  onExportProjectPdf,
  onExportProjectJpgZip,
  onImportImage,
  onCreatePanel,
  onInsertBubble,
}: InspectorProps) => {
  const selection = useEditorStore((state) => state.selection);
  const lastExport = useEditorStore((state) => state.lastExport);
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const { locale, t } = useI18n();

  if (!page) {
    return (
      <aside className="right-sidebar">
        <section>
          <p className="eyebrow">{t("inspector.title")}</p>
          <h3>{t("inspector.nothingSelected")}</h3>
          <p>{t("inspector.createProjectToBegin")}</p>
        </section>
      </aside>
    );
  }

  const selectedObject = getSelectedObject(page, selection);
  const bubbleIsExplicitlySelected =
    selection?.pageId === page.id &&
    selection.objectType === "bubble" &&
    selectedObject !== null &&
    !("style" in selectedObject) &&
    !("content" in selectedObject);
  const isBubbleInsertState = activeTool === "bubble" && !bubbleIsExplicitlySelected;

  return (
    <aside className="right-sidebar">
      {isBubbleInsertState ? (
        <BubbleInsertLibrary onInsertBubble={onInsertBubble} />
      ) : !selectedObject ? (
        <>
          <section>
            <p className="eyebrow">{t("inspector.page")}</p>
            <h3>{page.name}</h3>
            <p>
              {page.width} x {page.height}
            </p>
          </section>
          <section>
            <p className="eyebrow">{t("inspector.currentPage")}</p>
            <p>{t("inspector.panelCount", { count: page.panels.length })}</p>
            <p>{t("inspector.textCount", { count: page.texts.length })}</p>
            <p>{t("inspector.bubbleCount", { count: page.bubbles.length })}</p>
          </section>
          <PanelDescriptionList page={page} />
          <section>
            <p className="eyebrow">{t("inspector.nextStep")}</p>
            <p>{t(getRecommendedNextStepKey(page))}</p>
          </section>
          <section>
            <p className="eyebrow">{t("inspector.insert")}</p>
            <button
              className="primary-button insp-full-btn"
              onClick={onCreatePanel}
              disabled={!onCreatePanel}
            >
              {t("toolbar.panel")}
            </button>
          </section>
          <section>
            <p className="eyebrow">{t("inspector.projectExport")}</p>
            <div className="insp-image-actions">
              <button className="primary-button" onClick={onExportProjectPdf}>
                {t("inspector.exportProjectPdf")}
              </button>
              <button className="primary-button" onClick={onExportProjectJpgZip}>
                {t("inspector.exportProjectJpgZip")}
              </button>
            </div>
          </section>
        </>
      ) : "style" in selectedObject ? (
        <PanelInspector page={page} panel={selectedObject} onImportImage={onImportImage} />
      ) : "content" in selectedObject ? (
        <TextInspector page={page} text={selectedObject} />
      ) : (
        <BubbleInspector page={page} bubble={selectedObject as Bubble} />
      )}

      <section>
        <p className="eyebrow">{t("common.status")}</p>
        <p>
          {lastExport
            ? t("inspector.lastExport", { fileName: lastExport.fileName })
            : t("inspector.noExports")}
        </p>
        <p>
          {saveStatus.lastSavedAt
            ? t("inspector.lastLocalSave", {
                time: formatLocaleTime(locale, saveStatus.lastSavedAt),
              })
            : t("inspector.autosaveHint")}
        </p>
      </section>
    </aside>
  );
};
