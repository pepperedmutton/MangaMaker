import { z } from "zod";
import { create } from "zustand";
import { commandRegistry } from "../commands/registry";
import type { CommandDefinition } from "../commands/types";
import { createBlankProject, DEFAULT_ZOOM } from "../domain/defaults";
import { objectTypeSchema, projectSchema, type Project } from "../domain/schema";
import { resolveInitialLocale, type Locale } from "../i18n";
import {
  loadStoredTextInsertDefaults,
  persistTextInsertDefaults,
} from "../storage/textDefaults";
import { saveLocalDraft } from "../storage/localDraft";
import { shouldAutoSaveAfterCommand } from "./autoSavePolicy";
import type {
  EditorMultiSelection,
  EditorSelection,
  EditorSessionState,
  ExportArtifact,
  HistoryEntry,
  PanelImageEditingState,
  SaveStatus,
  StatusMessage,
  ToolMode,
  AppView,
} from "./types";

type EditorStore = EditorSessionState & {
  past: HistoryEntry[];
  future: HistoryEntry[];
  executeCommand: (
    commandId: string,
    payload: unknown,
    options?: ExecuteCommandOptions,
  ) => Promise<unknown>;
  setProject: (project: Project) => void;
  resetProject: () => void;
};

export type ExecuteCommandOptions = {
  historyKey?: string;
  transient?: boolean;
  commitHistory?: boolean;
  persistSession?: boolean;
  suppressStatus?: boolean;
};

const createInitialProject = () => createBlankProject("");
const initialProject = createInitialProject();
const initialLocale = resolveInitialLocale();
const initialTextInsertDefaults = loadStoredTextInsertDefaults();

const isSelectionItemValid = (
  project: Project,
  selection: {
    pageId: string;
    objectType: "panel" | "text" | "bubble" | "element";
    objectId: string;
  },
) => {
  const page = project.pages.find((entry) => entry.id === selection.pageId);
  if (!page) {
    return false;
  }

  const parsedType = objectTypeSchema.parse(selection.objectType);
  if (parsedType === "panel") {
    return page.panels.some((panel) => panel.id === selection.objectId);
  }
  if (parsedType === "text") {
    return page.texts.some((text) => text.id === selection.objectId);
  }
  if (parsedType === "element") {
    return (page.elements ?? []).some((element) => element.id === selection.objectId);
  }
  return page.bubbles.some((bubble) => bubble.id === selection.objectId);
};

const isSelectionValid = (project: Project, selection: EditorSelection) => {
  if (!selection) {
    return true;
  }
  return isSelectionItemValid(project, selection);
};

const resolveSelectedPageId = (project: Project, currentPageId: string | null) =>
  currentPageId && project.pages.some((page) => page.id === currentPageId)
    ? currentPageId
    : project.pages[0]?.id ?? null;

const isPanelImageEditingValid = (project: Project, state: PanelImageEditingState) => {
  if (!state) {
    return true;
  }

  const page = project.pages.find((entry) => entry.id === state.pageId);
  if (!page) {
    return false;
  }

  return page.panels.some((panel) => panel.id === state.panelId && panel.image);
};

const sanitizeProjectState = (
  project: Project,
  selectedPageId: string | null,
  selection: EditorSelection,
  multiSelection: EditorMultiSelection,
  panelImageEditing: PanelImageEditingState,
) => {
  const nextProject = projectSchema.parse(project);
  const nextSelectedPageId = resolveSelectedPageId(nextProject, selectedPageId);
  const nextSelection = isSelectionValid(nextProject, selection) ? selection : null;
  const nextMultiSelection = multiSelection.filter((entry) =>
    isSelectionItemValid(nextProject, entry),
  );
  return {
    project: nextProject,
    selectedPageId: nextSelectedPageId,
    selection: nextSelection,
    multiSelection: nextMultiSelection,
    panelImageEditing: isPanelImageEditingValid(nextProject, panelImageEditing)
      ? panelImageEditing
      : null,
  };
};

const createHistorySnapshot = (state: EditorSessionState): HistoryEntry => ({
  project: structuredClone(state.project),
  selectedPageId: state.selectedPageId,
  selection: state.selection ? { ...state.selection } : null,
  multiSelection: state.multiSelection.map((entry) => ({ ...entry })),
  panelImageEditing: state.panelImageEditing ? { ...state.panelImageEditing } : null,
});

const areTextInsertDefaultsEqual = (
  left: EditorSessionState["textInsertDefaults"],
  right: EditorSessionState["textInsertDefaults"],
) =>
  left.width === right.width &&
  left.height === right.height &&
  left.fontFamily === right.fontFamily &&
  left.fontSize === right.fontSize &&
  left.fontWeight === right.fontWeight &&
  left.letterSpacing === right.letterSpacing &&
  left.lineSpacing === right.lineSpacing &&
  left.strokeWidth === right.strokeWidth &&
  left.strokeColor === right.strokeColor;

export const useEditorStore = create<EditorStore>((set, get) => {
  const pendingHistorySnapshots = new Map<string, HistoryEntry>();
  let latestAutoSaveProject: Project | null = null;

  const queueMajorChangeAutoSave = (projectToSave: Project) => {
    if (projectToSave.title.trim().length === 0) {
      return;
    }
    latestAutoSaveProject = projectToSave;
    void saveLocalDraft(projectToSave, { mode: "last-write-wins" })
      .then((savedAt) => {
        if (!savedAt) {
          return;
        }
        set((state) => {
          if (state.project !== projectToSave || latestAutoSaveProject !== projectToSave) {
            return state;
          }
          return {
            saveStatus: {
              target: "localDraft",
              lastSavedAt: savedAt,
              hasUnsavedChanges: false,
            },
          };
        });
      })
      .catch((error) => {
        console.warn("Failed to auto-save major project change:", error);
      });
  };

  return {
    appView: "welcome",
    project: initialProject,
    selectedPageId: null,
    selection: null,
    multiSelection: [],
    panelImageEditing: null,
    locale: initialLocale,
    activeTool: "select",
    textInsertDefaults: { ...initialTextInsertDefaults },
    bubbleInsert: {
      mode: "preset",
      presetBubbleType: "round",
      customSmoothness: 0.45,
    },
    zoom: DEFAULT_ZOOM,
    lastExport: null,
    statusMessage: null,
    saveStatus: {
      target: null,
      lastSavedAt: null,
      hasUnsavedChanges: false,
    },
    past: [],
    future: [],
    executeCommand: async (commandId, payload, options = {}) => {
    const definition = commandRegistry[
      commandId as keyof typeof commandRegistry
    ] as CommandDefinition<z.ZodTypeAny, unknown> | undefined;

    if (!definition) {
      throw new Error(`Unknown command: ${commandId}`);
    }

    const input = definition.inputSchema.parse(payload);
    const shouldRecordDefinitionHistory = Boolean(definition.recordHistory);
    const historyKey = options.historyKey;
    const isTransient = options.transient === true;
    const isHistoryCommit = options.commitHistory === true && Boolean(historyKey);
    const stateBefore = get();
    const projectBefore = stateBefore.project;
    const historyBefore = shouldRecordDefinitionHistory
      ? {
          past: stateBefore.past,
          future: stateBefore.future,
        }
      : null;
    const pendingHistoryHadBefore = historyKey
      ? pendingHistorySnapshots.has(historyKey)
      : false;
    const pendingHistoryBefore = historyKey
      ? pendingHistorySnapshots.get(historyKey)
      : undefined;
    let shouldCreateNormalHistory =
      shouldRecordDefinitionHistory && !isTransient && !isHistoryCommit;

    if (shouldRecordDefinitionHistory && isTransient && historyKey) {
      if (!pendingHistorySnapshots.has(historyKey)) {
        pendingHistorySnapshots.set(historyKey, createHistorySnapshot(stateBefore));
      }
    }

    if (shouldRecordDefinitionHistory && isHistoryCommit && historyKey) {
      const pendingHistory = pendingHistorySnapshots.get(historyKey);
      if (pendingHistory) {
        set((state) => ({
          past: [...state.past, pendingHistory],
          future: [],
        }));
        pendingHistorySnapshots.delete(historyKey);
      } else {
        shouldCreateNormalHistory = true;
      }
    }

    if (shouldCreateNormalHistory) {
      const before = createHistorySnapshot(stateBefore);
      set((state) => ({
        past: [...state.past, before],
        future: [],
      }));
    }

    try {
      const result = await definition.execute(
        {
          getProject: () => get().project,
          setProject: (project) =>
            set((state) => ({
              ...sanitizeProjectState(
                project,
                state.selectedPageId,
                state.selection,
                state.multiSelection,
                state.panelImageEditing,
              ),
            })),
          getSession: () => ({
            project: get().project,
            appView: get().appView,
            selectedPageId: get().selectedPageId,
            selection: get().selection,
            multiSelection: get().multiSelection,
            panelImageEditing: get().panelImageEditing,
            locale: get().locale,
            activeTool: get().activeTool,
            textInsertDefaults: get().textInsertDefaults,
            bubbleInsert: get().bubbleInsert,
            zoom: get().zoom,
            lastExport: get().lastExport,
            statusMessage: get().statusMessage,
            saveStatus: get().saveStatus,
          }),
          setSession: (patch) =>
            set((state) => {
              const nextPatch = typeof patch === "function" ? patch(state) : patch;
              const selection =
                nextPatch.selection !== undefined ? nextPatch.selection : state.selection;
              const multiSelection =
                nextPatch.multiSelection !== undefined
                  ? (nextPatch.multiSelection as EditorMultiSelection)
                  : state.multiSelection;
              const selectedPageId =
                nextPatch.selectedPageId !== undefined
                  ? nextPatch.selectedPageId
                  : state.selectedPageId;
              const panelImageEditing =
                nextPatch.panelImageEditing !== undefined
                  ? (nextPatch.panelImageEditing as PanelImageEditingState)
                  : state.panelImageEditing;
              let nextTextInsertDefaults =
                nextPatch.textInsertDefaults !== undefined
                  ? {
                      ...state.textInsertDefaults,
                      ...(nextPatch.textInsertDefaults as Partial<typeof state.textInsertDefaults>),
                    }
                  : state.textInsertDefaults;
              if (
                nextTextInsertDefaults !== state.textInsertDefaults &&
                areTextInsertDefaultsEqual(nextTextInsertDefaults, state.textInsertDefaults)
              ) {
                nextTextInsertDefaults = state.textInsertDefaults;
              }
              const nextBubbleInsert =
                nextPatch.bubbleInsert !== undefined
                  ? {
                      ...state.bubbleInsert,
                      ...(nextPatch.bubbleInsert as Partial<typeof state.bubbleInsert>),
                    }
                  : state.bubbleInsert;

              if (
                nextTextInsertDefaults !== state.textInsertDefaults &&
                options.persistSession !== false
              ) {
                persistTextInsertDefaults(nextTextInsertDefaults);
              }

              const nextLocale =
                nextPatch.locale !== undefined ? (nextPatch.locale as Locale) : state.locale;
              const nextActiveTool =
                nextPatch.activeTool !== undefined
                  ? (nextPatch.activeTool as ToolMode)
                  : state.activeTool;
              const nextZoom = nextPatch.zoom !== undefined ? nextPatch.zoom : state.zoom;
              const nextLastExport =
                nextPatch.lastExport !== undefined
                  ? (nextPatch.lastExport as ExportArtifact)
                  : state.lastExport;
              const nextStatusMessage =
                options.suppressStatus === true && nextPatch.statusMessage !== undefined
                  ? state.statusMessage
                  : nextPatch.statusMessage !== undefined
                    ? (nextPatch.statusMessage as StatusMessage)
                    : state.statusMessage;
              const nextSaveStatus =
                nextPatch.saveStatus !== undefined
                  ? (nextPatch.saveStatus as SaveStatus)
                  : state.saveStatus;
              const nextAppView =
                nextPatch.appView !== undefined
                  ? (nextPatch.appView as AppView)
                  : state.appView;

              if (
                nextAppView === state.appView &&
                nextLocale === state.locale &&
                nextActiveTool === state.activeTool &&
                nextTextInsertDefaults === state.textInsertDefaults &&
                nextBubbleInsert === state.bubbleInsert &&
                nextZoom === state.zoom &&
                nextLastExport === state.lastExport &&
                nextStatusMessage === state.statusMessage &&
                nextSaveStatus === state.saveStatus &&
                selectedPageId === state.selectedPageId &&
                selection === state.selection &&
                multiSelection === state.multiSelection &&
                panelImageEditing === state.panelImageEditing
              ) {
                return state;
              }

              return {
                ...state,
                appView: nextAppView,
                locale: nextLocale,
                activeTool: nextActiveTool,
                textInsertDefaults: nextTextInsertDefaults,
                bubbleInsert: nextBubbleInsert,
                zoom: nextZoom,
                lastExport: nextLastExport,
                statusMessage: nextStatusMessage,
                saveStatus: nextSaveStatus,
                selectedPageId,
                selection,
                multiSelection,
                panelImageEditing,
              };
            }),
          getHistory: () => ({
            past: get().past,
            future: get().future,
          }),
          setHistory: (history) => set(history),
        },
        input,
      );
      const projectChanged = get().project !== projectBefore;
      if (
        projectChanged &&
        definition.id !== "saveProject" &&
        definition.id !== "loadProject"
      ) {
        set((state) => ({
          saveStatus: {
            ...state.saveStatus,
            hasUnsavedChanges: true,
          },
        }));
        if (shouldAutoSaveAfterCommand(definition.id)) {
          queueMajorChangeAutoSave(get().project);
        }
      }
      return result;
    } catch (error) {
      if (shouldRecordDefinitionHistory && historyBefore) {
        set(historyBefore);
      }
      if (historyKey) {
        if (pendingHistoryHadBefore && pendingHistoryBefore) {
          pendingHistorySnapshots.set(historyKey, pendingHistoryBefore);
        } else {
          pendingHistorySnapshots.delete(historyKey);
        }
      }
      throw error;
    }
  },
  setProject: (project) =>
    set((state) => ({
      ...sanitizeProjectState(
        project,
        state.selectedPageId,
        state.selection,
        state.multiSelection,
        state.panelImageEditing,
      ),
    })),
  resetProject: () =>
    set({
      project: createInitialProject(),
      appView: "welcome",
      selectedPageId: null,
      selection: null,
      multiSelection: [],
      panelImageEditing: null,
      locale: resolveInitialLocale(),
      activeTool: "select",
      textInsertDefaults: loadStoredTextInsertDefaults(),
      bubbleInsert: {
        mode: "preset",
        presetBubbleType: "round",
        customSmoothness: 0.45,
      },
      zoom: DEFAULT_ZOOM,
      lastExport: null,
      statusMessage: null,
      saveStatus: {
        target: null,
        lastSavedAt: null,
        hasUnsavedChanges: false,
      },
      past: [],
      future: [],
    }),
  };
});
