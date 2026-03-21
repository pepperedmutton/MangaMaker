import { z } from "zod";
import { create } from "zustand";
import { commandRegistry } from "../commands/registry";
import type { CommandDefinition } from "../commands/types";
import { createBlankProject, DEFAULT_ZOOM } from "../domain/defaults";
import { objectTypeSchema, projectSchema, type Project } from "../domain/schema";
import { resolveInitialLocale, type Locale } from "../i18n";
import { saveLocalDraft } from "../storage/localDraft";
import type {
  EditorSelection,
  EditorSessionState,
  ExportArtifact,
  HistoryEntry,
  PanelImageEditingState,
  SaveStatus,
  StatusMessage,
  ToolMode,
} from "./types";

type EditorStore = EditorSessionState & {
  past: HistoryEntry[];
  future: HistoryEntry[];
  executeCommand: (commandId: string, payload: unknown) => Promise<unknown>;
  setProject: (project: Project) => void;
  resetProject: () => void;
};

const createInitialProject = () => createBlankProject("");
const initialProject = createInitialProject();
const initialLocale = resolveInitialLocale();

const isSelectionValid = (project: Project, selection: EditorSelection) => {
  if (!selection) {
    return true;
  }

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
  return page.bubbles.some((bubble) => bubble.id === selection.objectId);
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
  panelImageEditing: PanelImageEditingState,
) => {
  const nextProject = projectSchema.parse(project);
  const nextSelectedPageId = resolveSelectedPageId(nextProject, selectedPageId);
  const nextSelection = isSelectionValid(nextProject, selection) ? selection : null;
  return {
    project: nextProject,
    selectedPageId: nextSelectedPageId,
    selection: nextSelection,
    panelImageEditing: isPanelImageEditingValid(nextProject, panelImageEditing)
      ? panelImageEditing
      : null,
  };
};

const createHistorySnapshot = (state: EditorSessionState): HistoryEntry => ({
  project: structuredClone(state.project),
  selectedPageId: state.selectedPageId,
  selection: state.selection ? { ...state.selection } : null,
  panelImageEditing: state.panelImageEditing ? { ...state.panelImageEditing } : null,
});

export const useEditorStore = create<EditorStore>((set, get) => ({
  project: initialProject,
  selectedPageId: null,
  selection: null,
  panelImageEditing: null,
  locale: initialLocale,
  activeTool: "select",
  zoom: DEFAULT_ZOOM,
  lastExport: null,
  statusMessage: null,
  saveStatus: {
    target: null,
    lastSavedAt: null,
  },
  past: [],
  future: [],
  executeCommand: async (commandId, payload) => {
    const definition = commandRegistry[
      commandId as keyof typeof commandRegistry
    ] as CommandDefinition<z.ZodTypeAny, unknown> | undefined;

    if (!definition) {
      throw new Error(`Unknown command: ${commandId}`);
    }

    const input = definition.inputSchema.parse(payload);
    const projectBefore = get().project;
    const before = createHistorySnapshot(get());
    const historyBefore = {
      past: get().past,
      future: get().future,
    };

    if (definition.recordHistory) {
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
                state.panelImageEditing,
              ),
            })),
          getSession: () => ({
            project: get().project,
            selectedPageId: get().selectedPageId,
            selection: get().selection,
            panelImageEditing: get().panelImageEditing,
            locale: get().locale,
            activeTool: get().activeTool,
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
              const selectedPageId =
                nextPatch.selectedPageId !== undefined
                  ? nextPatch.selectedPageId
                  : state.selectedPageId;
              const panelImageEditing =
                nextPatch.panelImageEditing !== undefined
                  ? (nextPatch.panelImageEditing as PanelImageEditingState)
                  : state.panelImageEditing;

              return {
                ...state,
                locale:
                  nextPatch.locale !== undefined ? (nextPatch.locale as Locale) : state.locale,
                activeTool:
                  nextPatch.activeTool !== undefined
                    ? (nextPatch.activeTool as ToolMode)
                    : state.activeTool,
                zoom: nextPatch.zoom !== undefined ? nextPatch.zoom : state.zoom,
                lastExport:
                  nextPatch.lastExport !== undefined
                    ? (nextPatch.lastExport as ExportArtifact)
                    : state.lastExport,
                statusMessage:
                  nextPatch.statusMessage !== undefined
                    ? (nextPatch.statusMessage as StatusMessage)
                    : state.statusMessage,
                saveStatus:
                  nextPatch.saveStatus !== undefined
                    ? (nextPatch.saveStatus as SaveStatus)
                    : state.saveStatus,
                selectedPageId,
                selection,
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
      if (projectChanged && definition.id !== "saveProject") {
        try {
          const savedAt = await saveLocalDraft(get().project);
          if (savedAt) {
            set((state) => ({
              ...state,
              saveStatus: {
                target: "localDraft",
                lastSavedAt: savedAt,
              },
            }));
          }
        } catch (error) {
          console.warn("Failed to autosave project after command execution:", error);
        }
      }
      return result;
    } catch (error) {
      if (definition.recordHistory) {
        set(historyBefore);
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
        state.panelImageEditing,
      ),
    })),
  resetProject: () =>
    set({
      project: createInitialProject(),
      selectedPageId: null,
      selection: null,
      panelImageEditing: null,
      locale: resolveInitialLocale(),
      activeTool: "select",
      zoom: DEFAULT_ZOOM,
      lastExport: null,
      statusMessage: null,
      saveStatus: {
        target: null,
        lastSavedAt: null,
      },
      past: [],
      future: [],
    }),
}));
