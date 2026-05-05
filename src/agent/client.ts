import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentChatRequest, AgentChatResponse, AgentConfig } from "./types";
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
