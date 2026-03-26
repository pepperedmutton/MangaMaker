import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { installAutomationApi } from "../automation/api";
import type { ClipboardEnvelope, ClipboardItem } from "../domain/clipboard";
import {
  MANGAMAKER_CLIPBOARD_SIGNATURE,
  parseClipboardEnvelope,
  serializeClipboardEnvelope,
} from "../domain/clipboard";
import type { Page, Panel, Project, ProjectType } from "../domain/schema";
import { downloadDataUrl } from "../export/download";
import { formatLocaleTime, getDefaultProjectTitle, translate } from "../i18n";
import { useI18n } from "../i18n/useI18n";
import { createId } from "../domain/defaults";
import {
  deleteLocalProject,
  hasLocalDraft,
  listLocalProjects,
  saveLocalDraft,
} from "../storage/localDraft";
import { persistImportedImageForProject } from "../storage/projectFiles";
import { useEditorStore } from "../state/editorStore";
import type { ToolMode } from "../state/types";
import { CanvasView } from "./CanvasView";
import { Inspector } from "./Inspector";
import { FirstRunGuide } from "./Onboarding";
import { RibbonBar } from "./RibbonBar";
import { Sidebar } from "./Sidebar";
import { WelcomeScreen } from "./WelcomeScreen";

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

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const inferImageExtension = (mimeType: string | null) => {
  if (!mimeType) {
    return "png";
  }
  const [, subtype] = mimeType.split("/");
  return subtype ? subtype.replace(/[^a-z0-9]/gi, "").toLowerCase() : "png";
};

const srcToDataUrl = async (src: string) => {
  if (src.startsWith("data:")) {
    return src;
  }
  const response = await fetch(src);
  const blob = await response.blob();
  return blobToDataUrl(blob);
};

const inlinePanelImageForClipboard = async (panel: Panel) => {
  if (!panel.image) {
    return panel;
  }
  try {
    const inlinedSrc = await srcToDataUrl(panel.image.src);
    return {
      ...panel,
      image: {
        ...panel.image,
        src: inlinedSrc,
      },
    };
  } catch (error) {
    console.warn("Failed to inline panel image for clipboard payload:", error);
    return panel;
  }
};

const inlinePageForClipboard = async (page: Page) => {
  const panels = await Promise.all(page.panels.map((panel) => inlinePanelImageForClipboard(panel)));
  return {
    ...page,
    panels,
  };
};

const persistClipboardImageForProject = async (
  projectId: string,
  projectTitle: string,
  imageSrc: string,
  fileHint: string,
) => {
  const response = await fetch(imageSrc);
  const blob = await response.blob();
  const extension = inferImageExtension(blob.type || null);
  const file = new File([blob], `${fileHint}.${extension}`, {
    type: blob.type || "image/png",
  });
  return persistImportedImageForProject(projectId, projectTitle, file);
};

const fallbackCopyText = (text: string) => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
};

const writeTextToClipboard = async (text: string) => {
  if (window.navigator.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(text);
    return true;
  }
  return fallbackCopyText(text);
};

const normalizeClipboardItemForPaste = async (
  projectId: string,
  projectTitle: string,
  item: ClipboardItem,
) => {
  if (item.kind === "panel") {
    if (!item.panel.image) {
      return item;
    }
    const persistedSrc = await persistClipboardImageForProject(
      projectId,
      projectTitle,
      item.panel.image.src,
      "clipboard-panel",
    );
    return {
      kind: "panel" as const,
      panel: {
        ...item.panel,
        image: {
          ...item.panel.image,
          src: persistedSrc,
        },
      },
    };
  }

  if (item.kind === "page") {
    const panels = await Promise.all(
      item.page.panels.map(async (panel, index) => {
        if (!panel.image) {
          return panel;
        }
        const persistedSrc = await persistClipboardImageForProject(
          projectId,
          projectTitle,
          panel.image.src,
          `clipboard-page-panel-${index + 1}`,
        );
        return {
          ...panel,
          image: {
            ...panel.image,
            src: persistedSrc,
          },
        };
      }),
    );
    return {
      kind: "page" as const,
      page: {
        ...item.page,
        panels,
      },
    };
  }

  return item;
};

const LEFT_SIDEBAR_MIN_WIDTH = 180;
const LEFT_SIDEBAR_MAX_WIDTH = 460;
const RIGHT_SIDEBAR_MIN_WIDTH = 240;
const RIGHT_SIDEBAR_MAX_WIDTH = 560;
const CANVAS_MIN_WIDTH = 540;
const SHELL_SPLITTER_WIDTH = 10;

export const App = () => {
  const project = useEditorStore((state) => state.project);
  const selectedPageId = useEditorStore((state) => state.selectedPageId);
  const selection = useEditorStore((state) => state.selection);
  const multiSelection = useEditorStore((state) => state.multiSelection);
  const locale = useEditorStore((state) => state.locale);
  const activeTool = useEditorStore((state) => state.activeTool);
  const zoom = useEditorStore((state) => state.zoom);
  const statusMessage = useEditorStore((state) => state.statusMessage);
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const pastCount = useEditorStore((state) => state.past.length);
  const futureCount = useEditorStore((state) => state.future.length);
  const executeCommand = useEditorStore((state) => state.executeCommand);
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectTitleInput, setProjectTitleInput] = useState("");
  const [projectTypeInput, setProjectTypeInput] = useState<ProjectType>("manga");
  const [view, setView] = useState<"welcome" | "editor">("welcome");
  const [projectsCatalog, setProjectsCatalog] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [pendingImportTarget, setPendingImportTarget] = useState<{
    pageId: string;
    panelId: string;
  } | null>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(220);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [isLayoutResizing, setIsLayoutResizing] = useState(false);
  const leftSidebarWidthRef = useRef(leftSidebarWidth);
  const rightSidebarWidthRef = useRef(rightSidebarWidth);
  const sidebarDragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startLeftWidth: number;
    startRightWidth: number;
  } | null>(null);

  const selectedPage =
    project.pages.find((page) => page.id === selectedPageId) ?? project.pages[0] ?? null;
  const selectedPanel =
    selectedPage && selection?.pageId === selectedPage.id && selection.objectType === "panel"
      ? selectedPage.panels.find((panel) => panel.id === selection.objectId) ?? null
      : null;
  const draftAvailable = hasLocalDraft();

  useEffect(() => {
    leftSidebarWidthRef.current = leftSidebarWidth;
  }, [leftSidebarWidth]);

  useEffect(() => {
    rightSidebarWidthRef.current = rightSidebarWidth;
  }, [rightSidebarWidth]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = sidebarDragRef.current;
      if (!drag) {
        return;
      }
      const shellWidth = appShellRef.current?.clientWidth ?? window.innerWidth;
      const availableSidebarWidth = Math.max(
        0,
        shellWidth - CANVAS_MIN_WIDTH - SHELL_SPLITTER_WIDTH * 2,
      );

      if (drag.side === "left") {
        const maxLeft = Math.max(
          LEFT_SIDEBAR_MIN_WIDTH,
          Math.min(LEFT_SIDEBAR_MAX_WIDTH, availableSidebarWidth - rightSidebarWidthRef.current),
        );
        const nextLeft = Math.min(
          maxLeft,
          Math.max(LEFT_SIDEBAR_MIN_WIDTH, drag.startLeftWidth + (event.clientX - drag.startX)),
        );
        setLeftSidebarWidth(nextLeft);
        return;
      }

      const maxRight = Math.max(
        RIGHT_SIDEBAR_MIN_WIDTH,
        Math.min(RIGHT_SIDEBAR_MAX_WIDTH, availableSidebarWidth - leftSidebarWidthRef.current),
      );
      const nextRight = Math.min(
        maxRight,
        Math.max(RIGHT_SIDEBAR_MIN_WIDTH, drag.startRightWidth - (event.clientX - drag.startX)),
      );
      setRightSidebarWidth(nextRight);
    };

    const endResize = () => {
      if (!sidebarDragRef.current) {
        return;
      }
      sidebarDragRef.current = null;
      setIsLayoutResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

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
    setProjectTypeInput(project.type);
  }, [project.type]);

  useEffect(() => {
    const loadCatalog = async () => {
      setProjectsLoading(true);
      try {
        const projects = await listLocalProjects();
        setProjectsCatalog(projects);
      } finally {
        setProjectsLoading(false);
      }
    };
    void loadCatalog();
  }, []);

  const refreshProjectCatalog = async () => {
    setProjectsLoading(true);
    try {
      const projects = await listLocalProjects();
      setProjectsCatalog(projects);
    } finally {
      setProjectsLoading(false);
    }
  };

  const handleSidebarResizeStart =
    (side: "left" | "right") => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (window.matchMedia("(max-width: 1180px)").matches) {
        return;
      }
      event.preventDefault();
      sidebarDragRef.current = {
        side,
        startX: event.clientX,
        startLeftWidth: leftSidebarWidthRef.current,
        startRightWidth: rightSidebarWidthRef.current,
      };
      setIsLayoutResizing(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    };

  const handleInsertBubble = (
    bubbleType: Exclude<Page["bubbles"][number]["bubbleType"], "custom">,
  ) => {
    if (!selectedPage) {
      return;
    }
    void executeCommand("createBubble", {
      pageId: selectedPage.id,
      bubbleType,
      keepTool: true,
    });
  };

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

  const handleSaveProject = async () => {
    await executeCommand("saveProject", {});
    await refreshProjectCatalog();
  };

  const handleReturnHome = async () => {
    try {
      await handleSaveProject();
    } catch (error) {
      console.warn("Failed to save project before returning home:", error);
    }
    setView("welcome");
  };

  const handleDeletePage = (pageId: string) => {
    if (!project.pages.some((page) => page.id === pageId)) {
      return;
    }
    void executeCommand("removePage", { pageId });
  };

  const handleDeleteSelectedObject = () => {
    if (!selection) {
      return;
    }
    void executeCommand("deleteObject", {
      pageId: selection.pageId,
      objectType: selection.objectType,
      objectId: selection.objectId,
    });
  };

  const handleImportImage = () => {
    if (!selectedPanel || !selectedPage) {
      return;
    }
    setPendingImportTarget({
      pageId: selectedPage.id,
      panelId: selectedPanel.id,
    });
    fileInputRef.current?.click();
  };

  const handleImportImageForPanel = (pageId: string, panelId: string) => {
    setPendingImportTarget({ pageId, panelId });
    void executeCommand("selectObject", {
      pageId,
      objectType: "panel",
      objectId: panelId,
    });
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const fallbackPage =
      selectedPage ??
      (selection
        ? project.pages.find((page) => page.id === selection.pageId) ?? null
        : project.pages[0] ?? null);
    const fallbackPanel =
      pendingImportTarget
        ? null
        : selectedPanel ??
          fallbackPage?.panels[0] ??
          project.pages.flatMap((page) => page.panels)[0] ??
          null;
    const target =
      pendingImportTarget ??
      (fallbackPage && fallbackPanel ? { pageId: fallbackPage.id, panelId: fallbackPanel.id } : null);
    if (!target) {
      setPendingImportTarget(null);
      event.target.value = "";
      return;
    }
    const page = project.pages.find((entry) => entry.id === target.pageId) ?? null;
    const panel = page?.panels.find((entry) => entry.id === target.panelId) ?? null;
    if (!page || !panel) {
      setPendingImportTarget(null);
      event.target.value = "";
      return;
    }
    let src = "";
    try {
      src = await persistImportedImageForProject(project.id, project.title, file);
    } catch (error) {
      console.warn("Failed to persist imported image; import was aborted.", error);
      setPendingImportTarget(null);
      event.target.value = "";
      return;
    }
    await executeCommand("placeImageInPanel", {
      pageId: page.id,
      panelId: panel.id,
      src,
      prompt: file.name,
    });
    setPendingImportTarget(null);
    event.target.value = "";
  };

  const handleMovePage = (pageId: string, direction: -1 | 1) => {
    const currentIndex = project.pages.findIndex((page) => page.id === pageId);
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= project.pages.length) {
      return;
    }
    void executeCommand("reorderPage", {
      fromIndex: currentIndex,
      toIndex: nextIndex,
    });
  };

  const buildClipboardItem = async (): Promise<ClipboardItem | null> => {
    if (selection) {
      const selectionPage = project.pages.find((page) => page.id === selection.pageId) ?? null;
      if (!selectionPage) {
        return null;
      }
      if (selection.objectType === "panel") {
        const panel = selectionPage.panels.find((entry) => entry.id === selection.objectId) ?? null;
        if (!panel) {
          return null;
        }
        return {
          kind: "panel",
          panel: await inlinePanelImageForClipboard(panel),
        };
      }
      if (selection.objectType === "text") {
        const text = selectionPage.texts.find((entry) => entry.id === selection.objectId) ?? null;
        return text ? { kind: "text", text } : null;
      }
      const bubble =
        selectionPage.bubbles.find((entry) => entry.id === selection.objectId) ?? null;
      return bubble ? { kind: "bubble", bubble } : null;
    }

    const page = selectedPage ?? project.pages[0] ?? null;
    if (!page) {
      return null;
    }
    return {
      kind: "page",
      page: await inlinePageForClipboard(page),
    };
  };

  const handleCopySelection = async () => {
    const item = await buildClipboardItem();
    if (!item) {
      return;
    }
    const payload: ClipboardEnvelope = {
      signature: MANGAMAKER_CLIPBOARD_SIGNATURE,
      copiedAt: new Date().toISOString(),
      sourceProjectId: project.id,
      item,
    };
    try {
      await writeTextToClipboard(serializeClipboardEnvelope(payload));
    } catch (error) {
      const copied = fallbackCopyText(serializeClipboardEnvelope(payload));
      if (!copied) {
        console.warn("Failed to write clipboard payload:", error);
      }
    }
  };

  const handlePasteEnvelope = async (envelope: ClipboardEnvelope) => {
    let normalizedItem: ClipboardItem;
    try {
      normalizedItem = await normalizeClipboardItemForPaste(
        project.id,
        project.title,
        envelope.item,
      );
    } catch (error) {
      console.warn("Failed to persist clipboard image into target project assets; paste aborted.", error);
      return;
    }
    let targetPageId = selectedPage?.id ?? project.pages[0]?.id ?? null;
    if (normalizedItem.kind !== "page" && !targetPageId) {
      const createdPage = (await executeCommand("addPage", {})) as { id: string };
      targetPageId = createdPage.id;
    }
    await executeCommand("pasteClipboardItem", {
      ...(targetPageId ? { pageId: targetPageId } : {}),
      item: normalizedItem,
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
        void handleSaveProject();
        return;
      }

      if (usesModifier && key === "g") {
        event.preventDefault();
        const pageId = selectedPage?.id ?? selection?.pageId ?? selectedPageId ?? null;
        if (!pageId) {
          return;
        }
        const objects = multiSelection
          .filter((entry) => entry.pageId === pageId)
          .map((entry) => ({
            objectType: entry.objectType,
            objectId: entry.objectId,
          }));
        void executeCommand("groupSelection", {
          pageId,
          ...(objects.length > 0 ? { objects } : {}),
        });
        return;
      }

      if (event.altKey && !usesModifier && key === "g") {
        event.preventDefault();
        const pageId = selectedPage?.id ?? selection?.pageId ?? selectedPageId ?? null;
        if (!pageId) {
          return;
        }
        const objects = multiSelection
          .filter((entry) => entry.pageId === pageId)
          .map((entry) => ({
            objectType: entry.objectType,
            objectId: entry.objectId,
          }));
        void executeCommand("ungroupSelection", {
          pageId,
          ...(objects.length > 0 ? { objects } : {}),
        });
        return;
      }

      if (usesModifier && key === "c") {
        event.preventDefault();
        void handleCopySelection();
        return;
      }

      if (!usesModifier && key === "v") {
        void executeCommand("setTool", { tool: "select" });
        return;
      }

      if (!usesModifier && key === "p") {
        void executeCommand("setTool", { tool: "panel" });
        return;
      }

      if (!usesModifier && key === "t") {
        void executeCommand("setTool", { tool: "text" });
        return;
      }

      if (!usesModifier && key === "b") {
        void executeCommand("setTool", { tool: "bubble" });
        return;
      }

      if (!usesModifier && key === "i" && selectedPanel) {
        event.preventDefault();
        handleImportImage();
        return;
      }

      if (!usesModifier && key === "e" && selectedPage) {
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
  }, [executeCommand, selectedPage, selectedPanel, selection, selectedPageId, multiSelection]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (view !== "editor" || isTextEditingElement(event.target)) {
        return;
      }
      const items = event.clipboardData?.items;
      const files = event.clipboardData?.files;
      if (!items && !files) {
        return;
      }
      const hasImageItem = Boolean(
        (items && Array.from(items).some((item) => item.type.startsWith("image/"))) ||
          (files && Array.from(files).some((file) => file.type.startsWith("image/"))),
      );
      if (hasImageItem) {
        return;
      }
      const rawText = event.clipboardData?.getData("text/plain") ?? "";
      if (!rawText) {
        return;
      }
      const parsed = parseClipboardEnvelope(rawText);
      if (!parsed) {
        return;
      }
      event.preventDefault();
      void handlePasteEnvelope(parsed);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [view, project.id, selectedPage?.id, executeCommand, project.pages]);

  const handleCreateProjectFromWelcome = async () => {
    const title = projectTitleInput.trim() || getDefaultProjectTitle(locale);
    await executeCommand("createProject", { title, type: projectTypeInput });
    await handleSaveProject();
    setView("editor");
  };

  const handleRestoreDraftFromWelcome = async () => {
    await executeCommand("loadProject", { source: "localDraft" });
    setView("editor");
  };

  const handleOpenProjectFromWelcome = async (nextProject: Project) => {
    await executeCommand("loadProject", { project: nextProject });
    setView("editor");
  };

  const handleDeleteProjectFromWelcome = async (targetProject: Project) => {
    const confirmed = window.confirm(
      t("dialog.deleteProject", {
        name: targetProject.title || t("sidebar.untitledProject"),
      }),
    );
    if (!confirmed) {
      return;
    }
    try {
      await deleteLocalProject(targetProject.id);
      await refreshProjectCatalog();
    } catch (error) {
      console.warn("Failed to delete project from welcome screen:", error);
    }
  };

  const handleDuplicateProjectFromWelcome = async (targetProject: Project) => {
    const now = new Date().toISOString();
    const baseTitle = targetProject.title.trim() || t("sidebar.untitledProject");
    const copySuffix = locale === "zh-CN" ? "\u526F\u672C" : "Copy";
    const duplicatedProject: Project = {
      ...structuredClone(targetProject),
      id: createId("project"),
      title: `${baseTitle} ${copySuffix}`,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveLocalDraft(duplicatedProject);
      await refreshProjectCatalog();
    } catch (error) {
      console.warn("Failed to duplicate project from welcome screen:", error);
    }
  };

  if (view === "welcome") {
    return (
      <WelcomeScreen
        projects={projectsCatalog}
        loading={projectsLoading}
        title={projectTitleInput}
        projectType={projectTypeInput}
        draftAvailable={draftAvailable}
        onTitleChange={setProjectTitleInput}
        onProjectTypeChange={setProjectTypeInput}
        onCreateProject={() => void handleCreateProjectFromWelcome()}
        onRestoreDraft={() => void handleRestoreDraftFromWelcome()}
        onOpenProject={(nextProject) => void handleOpenProjectFromWelcome(nextProject)}
        onDuplicateProject={(targetProject) =>
          void handleDuplicateProjectFromWelcome(targetProject)
        }
        onDeleteProject={(targetProject) => void handleDeleteProjectFromWelcome(targetProject)}
        onSetLocale={(nextLocale) => void executeCommand("setLocale", { locale: nextLocale })}
      />
    );
  }

  return (
    <div
      ref={appShellRef}
      className={`app-shell${isLayoutResizing ? " layout-resizing" : ""}`}
      style={
        {
          "--left-sidebar-width": `${leftSidebarWidth}px`,
          "--right-sidebar-width": `${rightSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <Sidebar
        project={project}
        selectedPageId={selectedPage?.id ?? null}
        onSelectPage={(pageId) => void executeCommand("selectPage", { pageId })}
        onAddPage={(insertAfterPageId) =>
          void executeCommand(
            "addPage",
            insertAfterPageId ? { insertAfterPageId } : {},
          )
        }
        onDuplicatePage={(pageId) => void executeCommand("duplicatePage", { pageId })}
        onDeletePage={(pageId) => handleDeletePage(pageId)}
        onMovePageUp={(pageId) => handleMovePage(pageId, -1)}
        onMovePageDown={(pageId) => handleMovePage(pageId, 1)}
        onRenameProject={(title) => void executeCommand("renameProject", { title })}
        onSetProjectType={(type) => void executeCommand("setProjectType", { type })}
      />
      <div
        className="sidebar-splitter sidebar-splitter-left"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleSidebarResizeStart("left")}
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
          onSetTool={(tool: ToolMode) => void executeCommand("setTool", { tool })}
          onSave={() => void handleSaveProject()}
          onGoHome={() => void handleReturnHome()}
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
            projectType={projectTypeInput}
            onTitleChange={setProjectTitleInput}
            onProjectTypeChange={setProjectTypeInput}
            draftAvailable={draftAvailable}
            projectCreated={project.title.trim().length > 0}
            onCreateProject={() =>
              void executeCommand("createProject", {
                title: projectTitleInput.trim() || getDefaultProjectTitle(locale),
                type: projectTypeInput,
              })
            }
            onRestoreDraft={() => void executeCommand("loadProject", { source: "localDraft" })}
            onCreateFirstPage={() => void executeCommand("addPage", {})}
          />
        ) : (
          <>
            {selectedPage ? (
              <CanvasView
                page={selectedPage}
                onRequestImportImage={(pageId, panelId) => handleImportImageForPanel(pageId, panelId)}
                isLayoutResizing={isLayoutResizing}
              />
            ) : null}
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
      <div
        className="sidebar-splitter sidebar-splitter-right"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleSidebarResizeStart("right")}
      />
      <Inspector
        page={selectedPage}
        activeTool={activeTool}
        onExportProjectPdf={() => void handleExportProjectPdf()}
        onImportImage={handleImportImage}
        onCreatePanel={() =>
          selectedPage ? void executeCommand("setTool", { tool: "panel" }) : undefined
        }
        onInsertBubble={(bubbleType) => handleInsertBubble(bubbleType)}
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
