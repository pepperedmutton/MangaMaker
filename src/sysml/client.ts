import { isTauri } from "@tauri-apps/api/core";
import type {
  SysmlConfig,
  SysmlFile,
  SysmlRepositoryManifest,
  SysmlValidationFileInput,
  SysmlValidationResult,
  SysmlWriteResult,
} from "./types";

const SYSML_API_BASE = "/__mangamaker__/sysml";

const isTauriRuntime = () => typeof window !== "undefined" && isTauri();

const readJsonResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    throw new Error(text || `SysML request failed (${response.status}).`);
  });
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `SysML request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
};

const unavailableTauriConfig = (): SysmlConfig => ({
  enabled: false,
  provider: "unavailable",
  version: null,
  reason: "Desktop SysML backend is not configured in this build.",
  javaConfigured: false,
  pilotJarConfigured: false,
  libraryConfigured: false,
  helperConfigured: false,
});

export const getSysmlConfig = async (): Promise<SysmlConfig> => {
  if (isTauriRuntime()) {
    return unavailableTauriConfig();
  }
  return readJsonResponse<SysmlConfig>(await fetch(`${SYSML_API_BASE}/config`));
};

export const listSysmlProjectFiles = async (projectId: string): Promise<SysmlRepositoryManifest> => {
  if (isTauriRuntime()) {
    throw new Error("Desktop SysML file API is not configured in this build.");
  }
  const params = new URLSearchParams({ projectId });
  return readJsonResponse<SysmlRepositoryManifest>(await fetch(`${SYSML_API_BASE}/files?${params.toString()}`));
};

export const readSysmlProjectFile = async (projectId: string, path: string): Promise<SysmlFile> => {
  if (isTauriRuntime()) {
    throw new Error("Desktop SysML file API is not configured in this build.");
  }
  const params = new URLSearchParams({ projectId, path });
  return readJsonResponse<SysmlFile>(await fetch(`${SYSML_API_BASE}/file?${params.toString()}`));
};

export const writeSysmlProjectFile = async (
  projectId: string,
  input: { path: string; content: string; operationId?: string },
): Promise<SysmlWriteResult> => {
  if (isTauriRuntime()) {
    throw new Error("Desktop SysML file API is not configured in this build.");
  }
  return readJsonResponse<SysmlWriteResult>(
    await fetch(`${SYSML_API_BASE}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, ...input }),
    }),
  );
};

export const deleteSysmlProjectFile = async (projectId: string, path: string) => {
  if (isTauriRuntime()) {
    throw new Error("Desktop SysML file API is not configured in this build.");
  }
  const params = new URLSearchParams({ projectId, path });
  return readJsonResponse<{ deleted: boolean; path: string; updatedAt: string }>(
    await fetch(`${SYSML_API_BASE}/file?${params.toString()}`, { method: "DELETE" }),
  );
};

export const validateSysmlProject = async (
  projectId: string,
  files?: SysmlValidationFileInput[],
): Promise<SysmlValidationResult> => {
  if (isTauriRuntime()) {
    return {
      ok: false,
      provider: "unavailable",
      durationMs: 0,
      issueCount: 0,
      issues: [],
      exception: null,
      validatedFiles: [],
      sourceHash: "",
      reason: "Desktop SysML validator is not configured in this build.",
    };
  }
  return readJsonResponse<SysmlValidationResult>(
    await fetch(`${SYSML_API_BASE}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, ...(files ? { files } : {}) }),
    }),
  );
};
