import { commandRegistry } from "../../src/commands/registry";
import {
  createBlankProject,
  DEFAULT_TEXT_INSERT_DEFAULTS,
  DEFAULT_ZOOM,
} from "../../src/domain/defaults";
import type { Project } from "../../src/domain/schema";
import type { EditorSessionState, HistoryEntry } from "../../src/state/types";

export const createHarness = () => {
  let session: EditorSessionState = {
    project: createBlankProject(""),
    selectedPageId: null,
    selection: null,
    panelImageEditing: null,
    locale: "en",
    activeTool: "select",
    textInsertDefaults: { ...DEFAULT_TEXT_INSERT_DEFAULTS },
    zoom: DEFAULT_ZOOM,
    lastExport: null,
    statusMessage: null,
    saveStatus: {
      target: null,
      lastSavedAt: null,
    },
  };

  let history: { past: HistoryEntry[]; future: HistoryEntry[] } = {
    past: [],
    future: [],
  };

  const context = {
    getProject: () => session.project,
    setProject: (project: Project) => {
      session = { ...session, project };
    },
    getSession: () => session,
    setSession: (patch: unknown) => {
      const nextPatch =
        typeof patch === "function"
          ? (patch as (current: EditorSessionState) => Partial<EditorSessionState>)(session)
          : (patch as Partial<EditorSessionState>);
      session = { ...session, ...nextPatch };
    },
    getHistory: () => history,
    setHistory: (nextHistory: { past: HistoryEntry[]; future: HistoryEntry[] }) => {
      history = nextHistory;
    },
  };

  return {
    context,
    readSession: () => session,
    readHistory: () => history,
  };
};

export const runCommand = async (
  harness: ReturnType<typeof createHarness>,
  commandId: keyof typeof commandRegistry,
  payload: unknown,
) => {
  const command = commandRegistry[commandId];
  const input = command.inputSchema.parse(payload);
  return command.execute(harness.context, input);
};
