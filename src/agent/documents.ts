import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  agentDocumentManifestSchema,
  agentDocumentSchema,
  type AgentDocument,
  type AgentDocumentManifest,
  type AgentDocumentMeta,
} from "./documentSchema";
import {
  agentRoleDefinitionSchema,
  type AgentRoleDefinition,
} from "./roles";

const AGENT_API_BASE = "/__mangamaker__/agent";

const isTauriRuntime = () => typeof window !== "undefined" && isTauri();

const readJsonResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Agent document request failed (${response.status}).`);
  });
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Agent document request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
};

export const listProjectDocuments = async (projectId: string): Promise<AgentDocumentManifest> => {
  if (isTauriRuntime()) {
    return agentDocumentManifestSchema.parse(
      await invoke<unknown>("list_project_docs", { projectId }),
    );
  }
  const response = await fetch(
    `${AGENT_API_BASE}/documents?projectId=${encodeURIComponent(projectId)}`,
  );
  return agentDocumentManifestSchema.parse(await readJsonResponse<unknown>(response));
};

export const readProjectDocument = async (
  projectId: string,
  documentId: string,
): Promise<AgentDocument> => {
  if (isTauriRuntime()) {
    return agentDocumentSchema.parse(
      await invoke<unknown>("read_project_doc", { projectId, documentId }),
    );
  }
  const response = await fetch(
    `${AGENT_API_BASE}/document?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent(documentId)}`,
  );
  return agentDocumentSchema.parse(await readJsonResponse<unknown>(response));
};

export const writeProjectDocument = async (
  projectId: string,
  document: Partial<AgentDocumentMeta> & {
    content: string;
    operationId?: string;
    expectedUpdatedAt?: string;
  },
): Promise<AgentDocument> => {
  if (isTauriRuntime()) {
    return agentDocumentSchema.parse(
      await invoke<unknown>("write_project_doc", { projectId, document }),
    );
  }
  const response = await fetch(`${AGENT_API_BASE}/document`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, document }),
  });
  return agentDocumentSchema.parse(await readJsonResponse<unknown>(response));
};

export const deleteProjectDocument = async (
  projectId: string,
  documentId: string,
): Promise<AgentDocumentManifest> => {
  if (isTauriRuntime()) {
    return agentDocumentManifestSchema.parse(
      await invoke<unknown>("delete_project_doc", { projectId, documentId }),
    );
  }
  const response = await fetch(
    `${AGENT_API_BASE}/document?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent(documentId)}`,
    { method: "DELETE" },
  );
  return agentDocumentManifestSchema.parse(await readJsonResponse<unknown>(response));
};

export type CreateProjectRoleInput = Partial<Omit<AgentRoleDefinition, "metadocId">> & {
  name: string;
  metadocId?: string;
  metadocTitle?: string;
  metadocPath?: string;
};

export const createProjectRole = async (
  projectId: string,
  role: CreateProjectRoleInput,
): Promise<AgentDocumentManifest> => {
  if (isTauriRuntime()) {
    return agentDocumentManifestSchema.parse(
      await invoke<unknown>("create_project_role", { projectId, role }),
    );
  }
  const response = await fetch(`${AGENT_API_BASE}/role`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, role }),
  });
  return agentDocumentManifestSchema.parse(await readJsonResponse<unknown>(response));
};

export const deleteProjectRole = async (
  projectId: string,
  roleId: string,
): Promise<AgentDocumentManifest> => {
  if (isTauriRuntime()) {
    return agentDocumentManifestSchema.parse(
      await invoke<unknown>("delete_project_role", { projectId, roleId }),
    );
  }
  const response = await fetch(
    `${AGENT_API_BASE}/role?projectId=${encodeURIComponent(projectId)}&roleId=${encodeURIComponent(roleId)}`,
    { method: "DELETE" },
  );
  return agentDocumentManifestSchema.parse(await readJsonResponse<unknown>(response));
};

export const parseAgentRoleDefinition = (value: unknown): AgentRoleDefinition =>
  agentRoleDefinitionSchema.parse(value);
