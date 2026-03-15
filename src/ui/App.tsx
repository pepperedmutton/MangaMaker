import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { installAutomationApi } from "../automation/api";
import { getOnboardingStep } from "../domain/helpers";
import { downloadDataUrl } from "../export/download";
import { formatLocaleTime, getDefaultProjectTitle, translate } from "../i18n";
import { useI18n } from "../i18n/useI18n";
import { hasLocalDraft } from "../storage/localDraft";
import { useEditorStore } from "../state/editorStore";
import type { ToolMode } from "../state/types";
import { CanvasView } from "./CanvasView";
import { Inspector } from "./Inspector";
import { FirstRunGuide, OnboardingBanner } from "./Onboarding";
import { RibbonBar } from "./RibbonBar";
import { Sidebar } from "./Sidebar";

const isTextEditingElement = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
};

export const App = () => {
  const project = useEditorStore((state) => state.project);
  const selectedPageId = useEditorStore((state) => state.selectedPageId);
  const selection = useEditorStore((state) => state.selection);
  const locale = useEditorStore((state) => state.locale);
  const activeTool = useEditorStore((state) => state.activeTool);
  const zoom = useEditorStore((state) => state.zoom);
  const lastExport = useEditorStore((state) => state.lastExport);
  const statusMessage = useEditorStore((state) => state.statusMessage);
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const pastCount = useEditorStore((state) => state.past.length);
  const futureCount = useEditorStore((state) => state.future.length);
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectTitleInput, setProjectTitleInput] = useState("");

  useEffect(() => {
    installAutomationApi();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "app.title");
  }, [locale]);

  useEffect(() => {
    if (project.title.trim().length > 0) {
      setProjectTitleInput(project.title);
    }
  }, [project.title]);

  useEffect(() => {
    if (project.title.trim().length === 0 && project.pages.length === 0) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void executeCommand("saveProject", {});
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [project, executeCommand]);

  const selectedPage =
    project.pages.find((page) => page.id === selectedPageId) ?? project.pages[0] ?? null;
  const selectedPanel =
    selectedPage && selection?.pageId === selectedPage.id && selection.objectType === "panel"
      ? selectedPage.panels.find((panel) => panel.id === selection.objectId) ?? null
      : null;
  const selectedText =
    selectedPage && selection?.pageId === selectedPage.id && selection.objectType === "text"
      ? selectedPage.texts.find((text) => text.id === selection.objectId) ?? null
      : null;
  const selectedBubble =
    selectedPage && selection?.pageId === selectedPage.id && selection.objectType === "bubble"
      ? selectedPage.bubbles.find((bubble) => bubble.id === selection.objectId) ?? null
      : null;
  const draftAvailable = hasLocalDraft();
  const onboardingStep = getOnboardingStep(project, lastExport?.kind ?? null);
  const bannerStep =
    onboardingStep === "done" || onboardingStep === "createProject" ? null : onboardingStep;

  const handleExportPage = async () => {
    if (!selectedPage) {
      return;
    }
    const artifact = (await executeCommand("exportPagePng", {
      pageId: selectedPage.id,
    })) as { fileName: string; dataUrl: string };
    downloadDataUrl(artifact.fileName, artifact.dataUrl);
  };

  const handleExportProjectPdf = async () => {
    const artifact = (await executeCommand("exportProjectPdf", {})) as {
      fileName: string;
      dataUrl: string;
    };
    downloadDataUrl(artifact.fileName, artifact.dataUrl);
  };

  const handleDeleteCurrentPage = () => {
    if (!selectedPage) {
      return;
    }
    if (!window.confirm(t("dialog.removePage", { name: selectedPage.name }))) {
      return;
    }
    void executeCommand("removePage", { pageId: selectedPage.id });
  };

  const handleDeleteSelectedObject = () => {
    if (!selection) {
      return;
    }
    if (!window.confirm(t("dialog.deleteObject"))) {
      return;
    }
    void executeCommand("deleteObject", {
      pageId: selection.pageId,
      objectType: selection.objectType,
      objectId: selection.objectId,
    });
  };

  const handleImportImage = () => {
    if (!selectedPanel) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImportForOnboarding = async () => {
    if (!selectedPage) {
      return;
    }
    const firstPanel = selectedPage.panels[0] ?? project.pages.flatMap((page) => page.panels)[0];
    if (!firstPanel) {
      return;
    }
    const pageId =
      selectedPage.panels.some((panel) => panel.id === firstPanel.id)
        ? selectedPage.id
        : project.pages.find((page) => page.panels.some((panel) => panel.id === firstPanel.id))?.id;
    if (!pageId) {
      return;
    }
    await executeCommand("selectObject", {
      pageId,
      objectType: "panel",
      objectId: firstPanel.id,
    });
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedPage) {
      return;
    }
    const panel =
      selectedPanel ??
      selectedPage.panels[0] ??
      project.pages.flatMap((page) => page.panels)[0] ??
      null;
    if (!panel) {
      return;
    }
    const pageId =
      selectedPage.panels.some((entry) => entry.id === panel.id)
        ? selectedPage.id
        : project.pages.find((page) => page.panels.some((entry) => entry.id === panel.id))?.id;
    if (!pageId) {
      return;
    }
    const src = URL.createObjectURL(file);
    await executeCommand("placeImageInPanel", {
      pageId,
      panelId: panel.id,
      src,
      prompt: file.name,
    });
    event.target.value = "";
  };

  const handleMovePage = (direction: -1 | 1) => {
    if (!selectedPage) {
      return;
    }
    const currentIndex = project.pages.findIndex((page) => page.id === selectedPage.id);
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= project.pages.length) {
      return;
    }
    void executeCommand("reorderPage", {
      fromIndex: currentIndex,
      toIndex: nextIndex,
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingElement(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const usesModifier = event.metaKey || event.ctrlKey;

      if (usesModifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          void executeCommand("redo", {});
          return;
        }
        void executeCommand("undo", {});
        return;
      }

      if (usesModifier && key === "y") {
        event.preventDefault();
        void executeCommand("redo", {});
        return;
      }

      if (usesModifier && key === "s") {
        event.preventDefault();
        void executeCommand("saveProject", {});
        return;
      }

      if (key === "v") {
        void executeCommand("setTool", { tool: "select" });
        return;
      }

      if (key === "p") {
        void executeCommand("setTool", { tool: "panel" });
        return;
      }

      if (key === "t") {
        void executeCommand("setTool", { tool: "text" });
        return;
      }

      if (key === "b") {
        void executeCommand("setTool", { tool: "bubble" });
        return;
      }

      if (key === "i" && selectedPanel) {
        event.preventDefault();
        handleImportImage();
        return;
      }

      if (key === "e" && selectedPage) {
        event.preventDefault();
        void handleExportPage();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selection) {
        event.preventDefault();
        handleDeleteSelectedObject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [executeCommand, selectedPage, selectedPanel, selection]);

  const onboardingAction = async () => {
    if (onboardingStep === "createProject") {
      await executeCommand("createProject", {
        title: projectTitleInput.trim() || getDefaultProjectTitle(locale),
      });
      return;
    }
    if (onboardingStep === "addPage") {
      await executeCommand("addPage", {});
      return;
    }
    if (onboardingStep === "addPanel") {
      await executeCommand("setTool", { tool: "panel" });
      return;
    }
    if (onboardingStep === "importImage") {
      await handleImportForOnboarding();
      return;
    }
    if (onboardingStep === "addDialogue") {
      await executeCommand("setTool", { tool: "text" });
      return;
    }
    if (onboardingStep === "exportPage") {
      await handleExportPage();
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        project={project}
        selectedPageId={selectedPage?.id ?? null}
        onSelectPage={(pageId) => void executeCommand("selectPage", { pageId })}
        onAddPage={() => void executeCommand("addPage", {})}
        onDuplicatePage={() =>
          selectedPage ? void executeCommand("duplicatePage", { pageId: selectedPage.id }) : undefined
        }
        onDeletePage={handleDeleteCurrentPage}
        onMovePageUp={() => handleMovePage(-1)}
        onMovePageDown={() => handleMovePage(1)}
        onRenameProject={(title) => void executeCommand("renameProject", { title })}
      />
      <main className="canvas-zone">
        <RibbonBar
          locale={locale}
          activeTool={activeTool}
          zoom={zoom}
          canUndo={pastCount > 0}
          canRedo={futureCount > 0}
          canExport={Boolean(selectedPage)}
          pageFormat={
            selectedPage
              ? {
                  background: selectedPage.background,
                  onBackgroundChange: (background: string) =>
                    void executeCommand("setPageBackground", {
                      pageId: selectedPage.id,
                      background,
                    }),
                }
              : undefined
          }
          textFormat={
            selectedText
              ? {
                  fontFamily: selectedText.fontFamily,
                  fontSize: selectedText.fontSize,
                  direction: selectedText.direction,
                  onFontFamilyChange: (fontFamily: string) =>
                    void executeCommand("updateText", {
                      pageId: selection!.pageId,
                      textId: selectedText.id,
                      fontFamily,
                    }),
                  onFontSizeChange: (fontSize: number) =>
                    void executeCommand("updateText", {
                      pageId: selection!.pageId,
                      textId: selectedText.id,
                      fontSize,
                    }),
                  onDirectionChange: (direction: "horizontal" | "vertical") =>
                    void executeCommand("updateText", {
                      pageId: selection!.pageId,
                      textId: selectedText.id,
                      direction,
                    }),
                }
              : undefined
          }
          onSetTool={(tool: ToolMode) => void executeCommand("setTool", { tool })}
          onExport={() => void handleExportPage()}
          onUndo={() => void executeCommand("undo", {})}
          onRedo={() => void executeCommand("redo", {})}
          onZoomChange={(nextZoom: number) => void executeCommand("setZoom", { zoom: nextZoom })}
          onSetLocale={(nextLocale) =>
            void executeCommand("setLocale", { locale: nextLocale })
          }
        />
        {project.pages.length === 0 ? (
          <FirstRunGuide
            title={projectTitleInput}
            onTitleChange={setProjectTitleInput}
            draftAvailable={draftAvailable}
            projectCreated={project.title.trim().length > 0}
            onCreateProject={() =>
              void executeCommand("createProject", {
                title: projectTitleInput.trim() || getDefaultProjectTitle(locale),
              })
            }
            onRestoreDraft={() => void executeCommand("loadProject", { source: "localDraft" })}
            onCreateFirstPage={() => void executeCommand("addPage", {})}
          />
        ) : (
          <>
            {bannerStep ? <OnboardingBanner step={bannerStep} onAction={() => void onboardingAction()} /> : null}
            {selectedPage ? <CanvasView page={selectedPage} /> : null}
            <div className="status-bar">
              <span>{statusMessage?.text ?? t("status.ready")}</span>
              <span>
                {saveStatus.lastSavedAt
                  ? t("status.autosavedAt", {
                      time: formatLocaleTime(locale, saveStatus.lastSavedAt),
                    })
                  : t("status.localDraftAvailable")}
              </span>
            </div>
          </>
        )}
      </main>
      <Inspector
        page={selectedPage}
        onExportProjectPdf={() => void handleExportProjectPdf()}
        onImportImage={handleImportImage}
      />
      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
      />
    </div>
  );
};
