import { commandRegistry } from "../commands/registry";
import { buildCommandManifest } from "../agent/commandManifest";
import { getLatestAgentDebugSnapshot } from "../agent/debug";
import type { AgentCommandManifestEntry, AgentDebugSnapshot } from "../agent/types";
import { projectSchema, type Project } from "../domain/schema";
import { normalizeProjectForCurrentVersion } from "../storage/projectMigration";
import { useEditorStore } from "../state/editorStore";
import type { ExportArtifact } from "../state/types";

type ExportProjectAllPagesOptions = {
  format?: "jpgZip" | "pdf";
};

type ProjectAllPagesExportArtifact = NonNullable<ExportArtifact>;

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
        exportAllPages: (
          options?: ExportProjectAllPagesOptions,
        ) => Promise<ProjectAllPagesExportArtifact>;
      };
      session: {
        get: () => ReturnType<typeof useEditorStore.getState>;
      };
      agent: {
        getDebugSnapshot: () => AgentDebugSnapshot | null;
      };
    };
  }
}

export const installAutomationApi = () => {
  if (typeof window === "undefined") {
    return;
  }

  const normalizeIncomingProject = (project: Project) =>
    projectSchema.parse(normalizeProjectForCurrentVersion(project));

  window.mangaMaker = {
    commands: {
      list: () => Object.keys(commandRegistry),
      describe: () => buildCommandManifest(),
      execute: (commandId, payload) => useEditorStore.getState().executeCommand(commandId, payload),
    },
    project: {
      get: () => useEditorStore.getState().project,
      load: (project) => {
        const parsedProject = normalizeIncomingProject(project);
        const state = useEditorStore.getState();
        if (state.appView === "editor" && state.project.id === parsedProject.id) {
          state.setProject(parsedProject);
          return Promise.resolve(parsedProject);
        }
        return useEditorStore
          .getState()
          .executeCommand("loadProject", {
            project: parsedProject,
          });
      },
      reset: () => useEditorStore.getState().resetProject(),
      exportAllPages: (options = {}) =>
        useEditorStore
          .getState()
          .executeCommand("exportProjectAllPages", options) as Promise<ProjectAllPagesExportArtifact>,
    },
    session: {
      get: () => useEditorStore.getState(),
    },
    agent: {
      getDebugSnapshot: () => getLatestAgentDebugSnapshot(),
    },
  };
};
