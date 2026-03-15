import { commandRegistry } from "../commands/registry";
import { projectSchema, type Project } from "../domain/schema";
import { useEditorStore } from "../state/editorStore";

declare global {
  interface Window {
    mangaMaker?: {
      commands: {
        list: () => string[];
        describe: () => Array<{ id: string; label: string; recordHistory: boolean }>;
        execute: (commandId: string, payload: unknown) => Promise<unknown>;
      };
      project: {
        get: () => Project;
        load: (project: Project) => Promise<unknown>;
        reset: () => void;
      };
      session: {
        get: () => ReturnType<typeof useEditorStore.getState>;
      };
    };
  }
}

export const installAutomationApi = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.mangaMaker = {
    commands: {
      list: () => Object.keys(commandRegistry),
      describe: () =>
        Object.values(commandRegistry).map((command) => ({
          id: command.id,
          label: command.label,
          recordHistory: "recordHistory" in command ? Boolean(command.recordHistory) : false,
        })),
      execute: (commandId, payload) => useEditorStore.getState().executeCommand(commandId, payload),
    },
    project: {
      get: () => useEditorStore.getState().project,
      load: (project) =>
        useEditorStore
          .getState()
          .executeCommand("loadProject", { project: projectSchema.parse(project) }),
      reset: () => useEditorStore.getState().resetProject(),
    },
    session: {
      get: () => useEditorStore.getState(),
    },
  };
};
