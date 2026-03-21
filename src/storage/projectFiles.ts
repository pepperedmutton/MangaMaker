import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type { Project } from "../domain/schema";

const isTauriRuntime = () => typeof window !== "undefined" && isTauri();
const isWebRuntime = () => typeof window !== "undefined" && !isTauriRuntime();
const WEB_PERSISTENCE_API_BASE = "/__mangamaker__/persistence";

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Web persistence request failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
};

export const isProjectsFilePersistenceAvailable = () =>
  isTauriRuntime() || isWebRuntime();

export const saveProjectToProjectsFolder = async (project: Project) => {
  if (isTauriRuntime()) {
    return invoke<string>("write_project_draft", {
      project_id: project.id,
      project_title: project.title,
      project_json: JSON.stringify(project),
    });
  }
  if (!isWebRuntime()) {
    return null;
  }
  const result = await fetchJson<{ path: string }>(
    `${WEB_PERSISTENCE_API_BASE}/write_project_draft`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: project.id,
        project_title: project.title,
        project_json: JSON.stringify(project),
      }),
    },
  );
  return result.path;
};

export const loadProjectFromProjectsFolder = async () => {
  if (isTauriRuntime()) {
    return invoke<string | null>("read_project_draft");
  }
  if (!isWebRuntime()) {
    return null;
  }
  const result = await fetchJson<{ project_json: string | null }>(
    `${WEB_PERSISTENCE_API_BASE}/read_project_draft`,
  );
  return result.project_json;
};

export const listProjectsFromProjectsFolder = async () => {
  if (isTauriRuntime()) {
    return invoke<string[]>("list_project_drafts");
  }
  if (!isWebRuntime()) {
    return [] as string[];
  }
  const result = await fetchJson<{ projects: string[] }>(
    `${WEB_PERSISTENCE_API_BASE}/list_project_drafts`,
  );
  return result.projects;
};

export const deleteProjectFromProjectsFolder = async (projectId: string) => {
  if (isTauriRuntime()) {
    await invoke("delete_project_draft", {
      project_id: projectId,
    });
    return;
  }
  if (!isWebRuntime()) {
    return;
  }
  await fetchJson<{ ok: boolean }>(
    `${WEB_PERSISTENCE_API_BASE}/delete_project_draft`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: projectId,
      }),
    },
  );
};

export const persistImportedImageForProject = async (
  projectId: string,
  projectTitle: string,
  file: File,
) => {
  if (isTauriRuntime()) {
    const buffer = await file.arrayBuffer();
    const path = await invoke<string>("save_imported_image", {
      project_id: projectId,
      project_title: projectTitle,
      original_file_name: file.name,
      bytes: Array.from(new Uint8Array(buffer)),
    });
    return convertFileSrc(path);
  }
  if (!isWebRuntime()) {
    return fileToDataUrl(file);
  }
  const buffer = await file.arrayBuffer();
  const result = await fetchJson<{ path: string }>(
    `${WEB_PERSISTENCE_API_BASE}/save_imported_image`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: projectId,
        project_title: projectTitle,
        original_file_name: file.name,
        bytes: Array.from(new Uint8Array(buffer)),
      }),
    },
  );
  return result.path;
};
