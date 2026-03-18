import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type { Project } from "../domain/schema";

const isTauriRuntime = () => typeof window !== "undefined" && isTauri();

export const isProjectsFilePersistenceAvailable = () => isTauriRuntime();

export const saveProjectToProjectsFolder = async (project: Project) => {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<string>("write_project_draft", {
    project_id: project.id,
    project_json: JSON.stringify(project),
  });
};

export const loadProjectFromProjectsFolder = async () => {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<string | null>("read_project_draft");
};

export const listProjectsFromProjectsFolder = async () => {
  if (!isTauriRuntime()) {
    return [] as string[];
  }
  return invoke<string[]>("list_project_drafts");
};

export const persistImportedImageForProject = async (
  projectId: string,
  file: File,
) => {
  if (!isTauriRuntime()) {
    return URL.createObjectURL(file);
  }
  const buffer = await file.arrayBuffer();
  const path = await invoke<string>("save_imported_image", {
    project_id: projectId,
    original_file_name: file.name,
    bytes: Array.from(new Uint8Array(buffer)),
  });
  return convertFileSrc(path);
};
