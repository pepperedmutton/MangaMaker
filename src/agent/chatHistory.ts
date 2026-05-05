import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";
import type { AgentChatHistory, AgentChatMessage } from "./types";

const HISTORY_KEY_PREFIX = "mangamaker:agent:chat:v1:";
const AGENT_API_BASE = "/__mangamaker__/agent";
const MAX_STORED_MESSAGES = 200;

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
});

const historySchema = z.object({
  projectId: z.string(),
  updatedAt: z.string(),
  messages: z.array(messageSchema),
  storagePath: z.string().optional(),
});

const keyForProject = (projectId: string) => `${HISTORY_KEY_PREFIX}${projectId}`;

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
    throw new Error(text || `Agent chat history request failed (${response.status}).`);
  });
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Agent chat history request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
};

const normalizeHistory = (projectId: string, messages: AgentChatMessage[]): AgentChatHistory =>
  historySchema.parse({
    projectId,
    updatedAt: new Date().toISOString(),
    messages: messages.slice(-MAX_STORED_MESSAGES),
  });

const loadLegacyLocalStorageHistory = (projectId: string): AgentChatHistory | null => {
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  const raw = storage.getItem(keyForProject(projectId));
  if (!raw) {
    return null;
  }
  try {
    return historySchema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn(`Failed to load legacy Agent chat history for project ${projectId}:`, error);
    return null;
  }
};

const saveLegacyLocalStorageHistory = (history: AgentChatHistory) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(keyForProject(history.projectId), JSON.stringify(history));
  } catch {
    // File-backed history is the source of truth; localStorage is only a migration fallback.
  }
};

const deleteLegacyLocalStorageHistory = (projectId: string) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(keyForProject(projectId));
  } catch {
    // Ignore legacy cleanup failures.
  }
};

export const loadAgentChatHistory = async (projectId: string): Promise<AgentChatHistory | null> => {
  try {
    if (isTauriRuntime()) {
      const history = await invoke<AgentChatHistory | null>("read_agent_chat_history", { projectId });
      return history ? historySchema.parse(history) : null;
    }
    const response = await fetch(
      `${AGENT_API_BASE}/history?projectId=${encodeURIComponent(projectId)}`,
    );
    const history = await readJsonResponse<AgentChatHistory | null>(response);
    return history ? historySchema.parse(history) : null;
  } catch (error) {
    console.warn(`Failed to load Agent chat history for project ${projectId}:`, error);
    const legacy = loadLegacyLocalStorageHistory(projectId);
    if (legacy) {
      void saveAgentChatHistory(projectId, legacy.messages);
    }
    return legacy;
  }
};

export const saveAgentChatHistory = async (
  projectId: string,
  messages: AgentChatMessage[],
): Promise<boolean> => {
  try {
    const history = normalizeHistory(projectId, messages);
    if (isTauriRuntime()) {
      await invoke("write_agent_chat_history", { history });
    } else {
      const response = await fetch(`${AGENT_API_BASE}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(history),
      });
      await readJsonResponse<AgentChatHistory>(response);
    }
    saveLegacyLocalStorageHistory(history);
    return true;
  } catch (error) {
    console.warn(`Failed to save Agent chat history for project ${projectId}:`, error);
    saveLegacyLocalStorageHistory(normalizeHistory(projectId, messages));
    return false;
  }
};

export const deleteAgentChatHistory = async (projectId: string): Promise<boolean> => {
  try {
    if (isTauriRuntime()) {
      await invoke("delete_agent_chat_history", { projectId });
    } else {
      const response = await fetch(
        `${AGENT_API_BASE}/history?projectId=${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
      await readJsonResponse<{ ok: boolean }>(response);
    }
    deleteLegacyLocalStorageHistory(projectId);
    return true;
  } catch (error) {
    console.warn(`Failed to delete Agent chat history for project ${projectId}:`, error);
    deleteLegacyLocalStorageHistory(projectId);
    return false;
  }
};
