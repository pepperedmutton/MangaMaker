import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type { Project } from "../domain/schema";
import { serializeProjectForStorage } from "./projectSerialization";

const isTauriRuntime = () => typeof window !== "undefined" && isTauri();
const isWebRuntime = () => typeof window !== "undefined" && !isTauriRuntime();
const WEB_PERSISTENCE_API_BASE = "/__mangamaker__/persistence";
const PERSISTENCE_CLIENT_ID_HEADER = "x-mangamaker-client-id";

export type ProjectDraftWrittenEvent = {
  type: "projectDraftWritten";
  project_id: string;
  path?: string;
  updated_at?: string;
  origin_client_id?: string;
};

let projectFileClientId: string | null = null;

export const getProjectFileClientId = () => {
  if (projectFileClientId) {
    return projectFileClientId;
  }
  const browserRandomId =
    typeof window !== "undefined" ? window.crypto?.randomUUID?.() : undefined;
  projectFileClientId =
    browserRandomId ??
    `mangamaker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return projectFileClientId;
};

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
  const projectJson = serializeProjectForStorage(project);
  if (isTauriRuntime()) {
    return invoke<string>("write_project_draft", {
      project_id: project.id,
      project_title: project.title,
      project_json: projectJson,
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
        [PERSISTENCE_CLIENT_ID_HEADER]: getProjectFileClientId(),
      },
      body: JSON.stringify({
        project_id: project.id,
        project_title: project.title,
        project_json: projectJson,
        client_id: getProjectFileClientId(),
      }),
    },
  );
  return result.path;
};

export const loadProjectFromProjectsFolder = async (projectId?: string) => {
  if (isTauriRuntime()) {
    return invoke<string | null>("read_project_draft");
  }
  if (!isWebRuntime()) {
    return null;
  }
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const result = await fetchJson<{ project_json: string | null }>(
    `${WEB_PERSISTENCE_API_BASE}/read_project_draft${query}`,
  );
  return result.project_json;
};

export const subscribeToProjectDraftUpdates = (
  onProjectDraftWritten: (event: ProjectDraftWrittenEvent) => void,
) => {
  if (!isWebRuntime() || typeof window.EventSource === "undefined") {
    return () => undefined;
  }

  const clientId = getProjectFileClientId();
  const source = new window.EventSource(
    `${WEB_PERSISTENCE_API_BASE}/events?client_id=${encodeURIComponent(clientId)}`,
  );
  const handleProjectDraftWritten = (event: MessageEvent) => {
    let parsed: ProjectDraftWrittenEvent;
    try {
      parsed = JSON.parse(event.data) as ProjectDraftWrittenEvent;
    } catch {
      return;
    }
    if (parsed.type !== "projectDraftWritten" || typeof parsed.project_id !== "string") {
      return;
    }
    if (parsed.origin_client_id === clientId) {
      return;
    }
    onProjectDraftWritten(parsed);
  };

  source.addEventListener("projectDraftWritten", handleProjectDraftWritten);
  return () => {
    source.removeEventListener("projectDraftWritten", handleProjectDraftWritten);
    source.close();
  };
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
