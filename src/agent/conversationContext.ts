import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import type { AgentChatMessage, AgentConversationContext } from "./types";

const CONTEXT_KEY_PREFIX = "mangamaker:agent:conversation-context:v1:";
const LEGACY_HISTORY_KEY_PREFIX = "mangamaker:agent:chat:v1:";
const AGENT_API_BASE = "/__mangamaker__/agent";
const MAX_STORED_MESSAGES = 200;
const DEFAULT_CONVERSATION_ROLE_ID = "assistant";

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
});

const contextSchema = z.object({
  projectId: z.string(),
  roleId: z.string(),
  updatedAt: z.string(),
  messages: z.array(messageSchema),
  storagePath: z.string().optional(),
});

const keyForProjectRole = (projectId: string, roleId: string) => `${CONTEXT_KEY_PREFIX}${projectId}:${roleId}`;
const legacyKeyForProject = (projectId: string) => `${LEGACY_HISTORY_KEY_PREFIX}${projectId}`;

const isTauriRuntime = () => typeof window !== "undefined" && isTauri();

const getStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const readJsonResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Agent conversation context request failed (${response.status}).`);
  });
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Agent conversation context request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
};

const normalizeConversationContext = (
  projectId: string,
  roleId: string,
  messages: AgentChatMessage[],
): AgentConversationContext =>
  contextSchema.parse({
    projectId,
    roleId,
    updatedAt: new Date().toISOString(),
    messages: messages.slice(-MAX_STORED_MESSAGES),
  });

const loadLocalStorageContext = (
  projectId: string,
  roleId: string,
): AgentConversationContext | null => {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  const raw =
    storage.getItem(keyForProjectRole(projectId, roleId)) ??
    (roleId === DEFAULT_CONVERSATION_ROLE_ID ? storage.getItem(legacyKeyForProject(projectId)) : null);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    return contextSchema.parse({
      ...record,
      projectId,
      roleId: typeof record.roleId === "string" ? record.roleId : roleId,
    });
  } catch (error) {
    console.warn(`Failed to load Agent conversation context for ${projectId}/${roleId}:`, error);
    return null;
  }
};

const saveLocalStorageContext = (context: AgentConversationContext) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(keyForProjectRole(context.projectId, context.roleId), JSON.stringify(context));
    storage.removeItem(legacyKeyForProject(context.projectId));
  } catch {
    // File-backed context is the source of truth; localStorage is only a migration fallback.
  }
};

const deleteLocalStorageContext = (projectId: string, roleId: string) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(keyForProjectRole(projectId, roleId));
    storage.removeItem(legacyKeyForProject(projectId));
  } catch {
    // Ignore local cleanup failures.
  }
};

export const loadAgentConversationContext = async (
  projectId: string,
  roleId: string,
): Promise<AgentConversationContext | null> => {
  try {
    if (isTauriRuntime()) {
      const context = await invoke<AgentConversationContext | null>("read_agent_conversation_context", {
        projectId,
        roleId,
      });
      return context ? contextSchema.parse(context) : null;
    }
    const response = await fetch(
      `${AGENT_API_BASE}/conversation-context?projectId=${encodeURIComponent(projectId)}&roleId=${encodeURIComponent(roleId)}`,
    );
    const context = await readJsonResponse<AgentConversationContext | null>(response);
    return context ? contextSchema.parse(context) : null;
  } catch (error) {
    console.warn(`Failed to load Agent conversation context for ${projectId}/${roleId}:`, error);
    const localContext = loadLocalStorageContext(projectId, roleId);
    if (localContext) {
      void saveAgentConversationContext(projectId, roleId, localContext.messages);
    }
    return localContext;
  }
};

export const saveAgentConversationContext = async (
  projectId: string,
  roleId: string,
  messages: AgentChatMessage[],
): Promise<boolean> => {
  try {
    const context = normalizeConversationContext(projectId, roleId, messages);
    if (isTauriRuntime()) {
      await invoke("write_agent_conversation_context", { context });
    } else {
      const response = await fetch(`${AGENT_API_BASE}/conversation-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      await readJsonResponse<AgentConversationContext>(response);
    }
    saveLocalStorageContext(context);
    return true;
  } catch (error) {
    console.warn(`Failed to save Agent conversation context for ${projectId}/${roleId}:`, error);
    saveLocalStorageContext(normalizeConversationContext(projectId, roleId, messages));
    return false;
  }
};

export const deleteAgentConversationContext = async (
  projectId: string,
  roleId: string,
): Promise<boolean> => {
  try {
    if (isTauriRuntime()) {
      await invoke("delete_agent_conversation_context", { projectId, roleId });
    } else {
      const response = await fetch(
        `${AGENT_API_BASE}/conversation-context?projectId=${encodeURIComponent(projectId)}&roleId=${encodeURIComponent(roleId)}`,
        { method: "DELETE" },
      );
      await readJsonResponse<{ ok: boolean }>(response);
    }
    deleteLocalStorageContext(projectId, roleId);
    return true;
  } catch (error) {
    console.warn(`Failed to delete Agent conversation context for ${projectId}/${roleId}:`, error);
    deleteLocalStorageContext(projectId, roleId);
    return false;
  }
};
