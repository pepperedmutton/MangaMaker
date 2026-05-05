import { commandRegistry } from "../commands/registry";
import { buildCommandManifest } from "../agent/commandManifest";
import type { AgentCommandManifestEntry } from "../agent/types";
import { projectSchema, type Project } from "../domain/schema";
import { normalizeProjectForCurrentVersion } from "../storage/projectMigration";
import { useEditorStore } from "../state/editorStore";

declare global {
  interface Window {
    mangaMaker?: {
      commands: {
        list: () => string[];
        describe: () => AgentCommandManifestEntry[];
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
      describe: () => buildCommandManifest(),
      execute: (commandId, payload) => useEditorStore.getState().executeCommand(commandId, payload),
    },
    project: {
      get: () => useEditorStore.getState().project,
      load: (project) =>
        useEditorStore
          .getState()
          .executeCommand("loadProject", {
            project: projectSchema.parse(normalizeProjectForCurrentVersion(project)),
          }),
      reset: () => useEditorStore.getState().resetProject(),
    },
    session: {
      get: () => useEditorStore.getState(),
    },
  };
};
