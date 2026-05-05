import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentAvailableModel,
  AgentChatRequest,
  AgentChatResponse,
  AgentConfig,
  AgentDebugSnapshot,
} from "./types";
import { validateAgentChatResponse } from "./agentResponseSchema";

const AGENT_API_BASE = "/__mangamaker__/agent";

const isTauriRuntime = () => typeof window !== "undefined" && isTauri();

const readJsonResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Agent request failed (${response.status}).`);
  });
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Agent request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
};

export const getAgentConfig = async (): Promise<AgentConfig> => {
  if (isTauriRuntime()) {
    return invoke<AgentConfig>("get_agent_config");
  }
  const response = await fetch(`${AGENT_API_BASE}/config`);
  return readJsonResponse<AgentConfig>(response);
};

export const getAgentModels = async (): Promise<AgentAvailableModel[]> => {
  if (isTauriRuntime()) {
    return [];
  }
  const response = await fetch(`${AGENT_API_BASE}/models`);
  return readJsonResponse<AgentAvailableModel[]>(response);
};

export const chatWithAgent = async (request: AgentChatRequest): Promise<AgentChatResponse> => {
  if (isTauriRuntime()) {
    const response = await invoke<AgentChatResponse>("chat_agent", { payload: request });
    return validateAgentChatResponse(response);
  }
  const response = await fetch(`${AGENT_API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return validateAgentChatResponse(await readJsonResponse<unknown>(response));
};

export const publishAgentDebugSnapshot = async (snapshot: AgentDebugSnapshot): Promise<void> => {
  if (isTauriRuntime()) {
    return;
  }
  await fetch(`${AGENT_API_BASE}/debug`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  }).catch(() => {
    // Debug mirroring must never affect the user's editing or chat flow.
  });
};
