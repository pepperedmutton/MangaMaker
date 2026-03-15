import { getSelectedObject } from "../domain/helpers";
import type { Bubble, Page, Panel, TextItem } from "../domain/schema";
import { formatLocaleTime } from "../i18n";
import { useI18n } from "../i18n/useI18n";
import { LOCAL_FONTS } from "../platform/localFonts";
import { useEditorStore } from "../state/editorStore";

type InspectorProps = {
  page: Page | null;
  onExportProjectPdf: () => void;
  onImportImage: () => void;
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
        if (!window.confirm(t("dialog.deleteObject"))) {
          return;
        }
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
            <input
              type="number"
              value={Math.round(panel.width)}
              onChange={(event) =>
                void executeCommand("resizePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  width: Number(event.target.value),
                  height: panel.height,
                })
              }
            />
          </label>
          <label>
            <span>{t("common.height")}</span>
            <input
              type="number"
              value={Math.round(panel.height)}
              onChange={(event) =>
                void executeCommand("resizePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  width: panel.width,
                  height: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.x")}</span>
            <input
              type="number"
              value={Math.round(panel.x)}
              onChange={(event) =>
                void executeCommand("movePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  x: Number(event.target.value),
                  y: panel.y,
                })
              }
            />
          </label>
          <label>
            <span>{t("common.y")}</span>
            <input
              type="number"
              value={Math.round(panel.y)}
              onChange={(event) =>
                void executeCommand("movePanel", {
                  pageId: page.id,
                  panelId: panel.id,
                  x: panel.x,
                  y: Number(event.target.value),
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
            <input
              type="number"
              value={panel.style.strokeWidth}
              onChange={(event) =>
                void executeCommand("setPanelStyle", {
                  pageId: page.id,
                  panelId: panel.id,
                  strokeWidth: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.cornerRadius")}</span>
            <input
              type="number"
              value={panel.style.cornerRadius}
              onChange={(event) =>
                void executeCommand("setPanelStyle", {
                  pageId: page.id,
                  panelId: panel.id,
                  cornerRadius: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
      </section>
    </>
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
        <p className="eyebrow">{t("inspector.fontFamily")}</p>
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
          {LOCAL_FONTS.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </select>
      </section>

      <section>
        <p className="eyebrow">{t("inspector.textBoxSize")}</p>
        <div className="field-grid">
          <label>
            <span>{t("common.width")}</span>
            <input
              type="number"
              value={Math.round(text.width)}
              onChange={(event) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  width: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.height")}</span>
            <input
              type="number"
              value={Math.round(text.height)}
              onChange={(event) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  height: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.fontSize")}</span>
            <input
              type="number"
              value={text.fontSize}
              onChange={(event) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  fontSize: Number(event.target.value),
                })
              }
            />
          </label>
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
            <span>{t("common.x")}</span>
            <input
              type="number"
              value={Math.round(text.x)}
              onChange={(event) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  x: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.y")}</span>
            <input
              type="number"
              value={Math.round(text.y)}
              onChange={(event) =>
                void executeCommand("updateText", {
                  pageId: page.id,
                  textId: text.id,
                  y: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
      </section>
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
        <p className="eyebrow">{t("common.content")}</p>
        <textarea
          rows={6}
          value={bubble.text}
          onChange={(event) =>
            void executeCommand("updateBubble", {
              pageId: page.id,
              bubbleId: bubble.id,
              text: event.target.value,
            })
          }
        />
      </section>

      <section>
        <div className="field-grid">
          <label>
            <span>{t("common.fontSize")}</span>
            <input
              type="number"
              value={bubble.fontSize}
              onChange={(event) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  fontSize: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.width")}</span>
            <input
              type="number"
              value={Math.round(bubble.width)}
              onChange={(event) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  width: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.height")}</span>
            <input
              type="number"
              value={Math.round(bubble.height)}
              onChange={(event) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  height: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.x")}</span>
            <input
              type="number"
              value={Math.round(bubble.x)}
              onChange={(event) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  x: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            <span>{t("common.y")}</span>
            <input
              type="number"
              value={Math.round(bubble.y)}
              onChange={(event) =>
                void executeCommand("updateBubble", {
                  pageId: page.id,
                  bubbleId: bubble.id,
                  y: Number(event.target.value),
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

export const Inspector = ({ page, onExportProjectPdf, onImportImage }: InspectorProps) => {
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

  return (
    <aside className="right-sidebar">
      {!selectedObject ? (
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
          <section>
            <p className="eyebrow">{t("inspector.nextStep")}</p>
            <p>{t(getRecommendedNextStepKey(page))}</p>
          </section>
          <section>
            <p className="eyebrow">{t("inspector.projectExport")}</p>
            <button className="primary-button" onClick={onExportProjectPdf}>
              {t("inspector.exportProjectPdf")}
            </button>
          </section>
        </>
      ) : "style" in selectedObject ? (
        <PanelInspector page={page} panel={selectedObject} onImportImage={onImportImage} />
      ) : "fontFamily" in selectedObject ? (
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
