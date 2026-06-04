import { projectSchema } from "../domain/schema";
import { useEditorStore } from "../state/editorStore";
import { normalizeProjectForCurrentVersion } from "./projectMigration";
import {
  loadProjectFromProjectsFolder,
  type ProjectDraftWrittenEvent,
} from "./projectFiles";

const parseProjectJson = (rawProjectJson: string) =>
  projectSchema.parse(normalizeProjectForCurrentVersion(JSON.parse(rawProjectJson)));

export const applyProjectDraftUpdateToOpenEditor = async (
  event: ProjectDraftWrittenEvent,
) => {
  const stateBeforeLoad = useEditorStore.getState();
  if (
    stateBeforeLoad.appView !== "editor" ||
    stateBeforeLoad.project.id !== event.project_id
  ) {
    return false;
  }

  const rawProjectJson = await loadProjectFromProjectsFolder(event.project_id);
  if (!rawProjectJson) {
    return false;
  }

  const nextProject = parseProjectJson(rawProjectJson);
  const stateBeforeApply = useEditorStore.getState();
  if (
    stateBeforeApply.appView !== "editor" ||
    stateBeforeApply.project.id !== nextProject.id
  ) {
    return false;
  }

  stateBeforeApply.setProject(nextProject);
  return true;
};
