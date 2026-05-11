import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentAvailableModel,
  AgentChatRequest,
  AgentChatResponse,
  AgentCommandPlanExecutionDiff,
  AgentCommandPlanResultStatus,
  AgentConfig,
  AgentDebugSnapshot,
  AgentHarnessSnapshot,
  AgentHarnessToolResult,
  AgentRun,
  AgentRunEvent,
  AgentRequestTrace,
  AgentRequestTraceEvent,
  AgentRequestTraceMetadata,
  AgentRequestTraceStatus,
} from "./types";
import { validateAgentChatResponse } from "./agentResponseSchema";

const AGENT_API_BASE = "/__mangamaker__/agent";
const AGENT_CHAT_TIMEOUT_MS = 120_000;

const isTauriRuntime = () => typeof window !== "undefined" && isTauri();

const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const createAgentRequestTraceMetadata = (
  stage: string,
  parentRequestId?: string,
): AgentRequestTraceMetadata => ({
  requestId: createId("agent-request"),
  ...(parentRequestId ? { parentRequestId } : {}),
  stage,
  createdAt: new Date().toISOString(),
});

const elapsedSince = (startedAt: string, now: string) => {
  const start = Date.parse(startedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(current)) {
    return 0;
  }
  return Math.max(0, current - start);
};

const createTraceEvent = (
  metadata: AgentRequestTraceMetadata,
  phase: string,
  message?: string,
): AgentRequestTraceEvent => {
  const at = new Date().toISOString();
  return {
    phase,
    at,
    elapsedMs: elapsedSince(metadata.createdAt, at),
    ...(message ? { message } : {}),
  };
};

const createClientTrace = (
  metadata: AgentRequestTraceMetadata,
  status: AgentRequestTraceStatus,
  events: AgentRequestTraceEvent[],
  error?: string,
): AgentRequestTrace => {
  const updatedAt = new Date().toISOString();
  return {
    requestId: metadata.requestId,
    ...(metadata.parentRequestId ? { parentRequestId: metadata.parentRequestId } : {}),
    stage: metadata.stage,
    status,
    provider: null,
    model: null,
    usedVision: null,
    startedAt: metadata.createdAt,
    updatedAt,
    durationMs: elapsedSince(metadata.createdAt, updatedAt),
    events,
    ...(error ? { error } : {}),
  };
};

const appendClientTraceEvent = (
  trace: AgentRequestTrace,
  phase: string,
  status: AgentRequestTraceStatus,
  message?: string,
): AgentRequestTrace => {
  const at = new Date().toISOString();
  const event: AgentRequestTraceEvent = {
    phase,
    at,
    elapsedMs: elapsedSince(trace.startedAt, at),
    ...(message ? { message } : {}),
  };
  return {
    ...trace,
    status,
    updatedAt: at,
    durationMs: elapsedSince(trace.startedAt, at),
    events: [...trace.events, event],
    ...(status === "error" || status === "timeout" ? { error: message } : {}),
  };
};

export class AgentRequestError extends Error {
  readonly requestTrace: AgentRequestTrace;

  constructor(message: string, requestTrace: AgentRequestTrace) {
    super(message);
    this.name = "AgentRequestError";
    this.requestTrace = requestTrace;
  }
}

export const getAgentRequestTraceFromError = (error: unknown) =>
  error instanceof AgentRequestError ? error.requestTrace : null;

export class AgentRunError extends Error {
  readonly run: AgentRun | null;

  constructor(message: string, run: AgentRun | null = null) {
    super(message);
    this.name = "AgentRunError";
    this.run = run;
  }
}

const createTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeoutId),
  };
};

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

const readAgentChatResponse = async (
  response: Response,
  requestTrace: AgentRequestTraceMetadata,
  clientEvents: AgentRequestTraceEvent[],
): Promise<AgentChatResponse> => {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Agent request failed (${response.status}).`);
  });
  let validated: AgentChatResponse;
  try {
    validated = validateAgentChatResponse(payload);
  } catch (error) {
    if (response.ok) {
      throw error;
    }
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Agent request failed (${response.status}).`;
    throw new AgentRequestError(
      message,
      createClientTrace(requestTrace, "error", [
        ...clientEvents,
        createTraceEvent(requestTrace, "client_response_invalid", message),
      ], message),
    );
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Agent request failed (${response.status}).`;
    throw new AgentRequestError(
      message,
      appendClientTraceEvent(
        validated.requestTrace ?? createClientTrace(requestTrace, "pending", clientEvents),
        "client_response_error",
        "error",
        message,
      ),
    );
  }
  return validated;
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
  const requestTrace = request.requestTrace ?? createAgentRequestTraceMetadata("agentChat");
  const requestWithTrace: AgentChatRequest = {
    ...request,
    requestTrace,
  };
  const clientEvents = [
    createTraceEvent(requestTrace, "client_request_created"),
    createTraceEvent(requestTrace, "client_request_sent"),
  ];
  if (isTauriRuntime()) {
    try {
      const response = await invoke<AgentChatResponse>("chat_agent", { payload: requestWithTrace });
      const validated = validateAgentChatResponse(response);
      return {
        ...validated,
        requestTrace: appendClientTraceEvent(
          validated.requestTrace ?? createClientTrace(requestTrace, "pending", clientEvents),
          "client_response_received",
          "success",
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AgentRequestError(
        message,
        createClientTrace(requestTrace, "error", [
          ...clientEvents,
          createTraceEvent(requestTrace, "client_request_failed", message),
        ], message),
      );
    }
  }
  const timeout = createTimeoutSignal(AGENT_CHAT_TIMEOUT_MS);
  try {
    const response = await fetch(`${AGENT_API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestWithTrace),
      signal: timeout.signal,
    });
    const validated = await readAgentChatResponse(response, requestTrace, clientEvents);
    return {
      ...validated,
      requestTrace: appendClientTraceEvent(
        validated.requestTrace ?? createClientTrace(requestTrace, "pending", clientEvents),
        "client_response_received",
        "success",
      ),
    };
  } catch (error) {
    if (error instanceof AgentRequestError) {
      throw error;
    }
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      const message = "Agent request timed out after 120 seconds. Try a narrower document edit or retry with fewer tool reads.";
      throw new AgentRequestError(
        message,
        createClientTrace(requestTrace, "timeout", [
          ...clientEvents,
          createTraceEvent(requestTrace, "client_timeout", message),
        ], message),
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AgentRequestError(
      message,
      createClientTrace(requestTrace, "error", [
        ...clientEvents,
        createTraceEvent(requestTrace, "client_request_failed", message),
      ], message),
    );
  } finally {
    timeout.clear();
  }
};

const readAgentRunResponse = async (response: Response): Promise<AgentRun> => {
  const payload = await readJsonResponse<unknown>(response);
  return payload as AgentRun;
};

const isAgentRunTurnComplete = (run: AgentRun, previousModelTurnIndex: number) =>
  Boolean(run.latestResponse) &&
  run.modelTurnIndex > previousModelTurnIndex &&
  (run.status === "completed" ||
    run.status === "waiting_for_tool" ||
    run.status === "waiting_for_confirmation");

const createSyntheticCompletedRun = (
  request: AgentChatRequest,
  response: AgentChatResponse,
): AgentRun => ({
  id: createId("agent-run-tauri"),
  projectId: request.agentContext.project.id,
  roleId: request.activeRoleId ?? "assistant",
  ...(request.conversationContextId ? { conversationContextId: request.conversationContextId } : {}),
  ...(request.conversationContextFingerprint ? { conversationContextFingerprint: request.conversationContextFingerprint } : {}),
  ...(request.conversationContextUpdatedAt ? { conversationContextUpdatedAt: request.conversationContextUpdatedAt } : {}),
  status: response.requestedToolCalls?.length
    ? "waiting_for_tool"
    : response.pendingCommandPlan?.requiresConfirmation
      ? "waiting_for_confirmation"
      : "completed",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  modelTurnIndex: 1,
  steps: [],
  trace: response.requestTrace ? [response.requestTrace] : [],
  pendingToolCalls: response.requestedToolCalls ?? [],
  latestResponse: response,
  ...(response.error ? { error: response.error } : {}),
});

const createAgentRunEventSource = (runId: string) =>
  new EventSource(`${AGENT_API_BASE}/runs/${encodeURIComponent(runId)}/events`);

export const listAgentRuns = async (
  projectId: string,
  options: {
    roleId?: string | null;
    limit?: number;
    conversationContextId?: string | null;
    conversationContextFingerprint?: string | null;
  } = {},
): Promise<AgentRun[]> => {
  if (isTauriRuntime()) {
    return [];
  }
  const params = new URLSearchParams({
    projectId,
    limit: String(options.limit ?? 20),
  });
  if (options.roleId) {
    params.set("roleId", options.roleId);
  }
  if (options.conversationContextId) {
    params.set("conversationContextId", options.conversationContextId);
  }
  if (options.conversationContextFingerprint) {
    params.set("conversationContextFingerprint", options.conversationContextFingerprint);
  }
  const response = await fetch(`${AGENT_API_BASE}/runs?${params.toString()}`);
  const payload = await readJsonResponse<{ runs?: AgentRun[] }>(response);
  return payload.runs ?? [];
};

export const getAgentRun = async (
  runId: string,
  options: { projectId?: string | null } = {},
): Promise<AgentRun> => {
  if (isTauriRuntime()) {
    throw new AgentRunError("Tauri Agent runs do not support persisted run lookup yet.");
  }
  const params = new URLSearchParams();
  if (options.projectId) {
    params.set("projectId", options.projectId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${AGENT_API_BASE}/runs/${encodeURIComponent(runId)}${suffix}`);
  return readAgentRunResponse(response);
};

export const subscribeToAgentRun = (
  runId: string,
  onRunUpdate: (run: AgentRun, event: AgentRunEvent) => void,
  onError?: (error: Error) => void,
) => {
  if (isTauriRuntime()) {
    return () => undefined;
  }
  const source = createAgentRunEventSource(runId);
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as AgentRunEvent;
      if ("run" in payload && payload.run) {
        onRunUpdate(payload.run, payload);
        return;
      }
      if (payload.type === "run_error") {
        onError?.(new AgentRunError(payload.error, payload.run ?? null));
      }
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  source.onerror = () => {
    onError?.(new AgentRunError("Agent run event stream disconnected."));
  };
  return () => source.close();
};

const waitForAgentRunTurn = (
  runId: string,
  previousModelTurnIndex: number,
  onRunUpdate?: (run: AgentRun, event: AgentRunEvent) => void,
) =>
  new Promise<AgentRun>((resolve, reject) => {
    const source = createAgentRunEventSource(runId);
    const close = () => source.close();

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as AgentRunEvent;
        if ("run" in payload && payload.run) {
          onRunUpdate?.(payload.run, payload);
          if (isAgentRunTurnComplete(payload.run, previousModelTurnIndex)) {
            close();
            resolve(payload.run);
            return;
          }
          if (payload.run.status === "failed" || payload.run.status === "cancelled") {
            close();
            reject(new AgentRunError(payload.run.error ?? `Agent run ${payload.run.status}.`, payload.run));
          }
          return;
        }
        if (payload.type === "run_error") {
          close();
          reject(new AgentRunError(payload.error, payload.run ?? null));
        }
      } catch (error) {
        close();
        reject(error);
      }
    };

    source.onerror = () => {
      close();
      reject(new AgentRunError("Agent run event stream disconnected."));
    };
  });

export const waitForExistingAgentRunTurn = async (
  runId: string,
  previousModelTurnIndex: number,
  onRunUpdate?: (run: AgentRun, event: AgentRunEvent) => void,
): Promise<AgentRun> => waitForAgentRunTurn(runId, previousModelTurnIndex, onRunUpdate);

export const startAgentRunTurn = async (
  request: AgentChatRequest,
  onRunUpdate?: (run: AgentRun, event: AgentRunEvent) => void,
): Promise<{ run: AgentRun; response: AgentChatResponse }> => {
  if (isTauriRuntime()) {
    const response = await chatWithAgent(request);
    const run = createSyntheticCompletedRun(request, response);
    onRunUpdate?.(run, { type: "run_snapshot", run });
    return { run, response };
  }
  const response = await fetch(`${AGENT_API_BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const run = await readAgentRunResponse(response);
  onRunUpdate?.(run, { type: "run_snapshot", run });
  if (isAgentRunTurnComplete(run, 0)) {
    return { run, response: run.latestResponse! };
  }
  const completedRun = await waitForAgentRunTurn(run.id, run.modelTurnIndex, onRunUpdate);
  if (!completedRun.latestResponse) {
    throw new AgentRunError("Agent run completed without a model response.", completedRun);
  }
  return { run: completedRun, response: completedRun.latestResponse };
};

export const resumeAgentRunTurn = async (
  runId: string,
  previousModelTurnIndex: number,
  payload: {
    conversationContextId?: string | null;
    conversationContextFingerprint?: string;
    harness: AgentHarnessSnapshot;
    toolResults: AgentHarnessToolResult[];
    dynamicToolResults: AgentHarnessToolResult[];
    continueBudgetSegment?: boolean;
    finalAnswerOnly?: boolean;
  },
  onRunUpdate?: (run: AgentRun, event: AgentRunEvent) => void,
): Promise<{ run: AgentRun; response: AgentChatResponse }> => {
  if (isTauriRuntime()) {
    throw new AgentRunError("Tauri Agent runs do not support browser-side tool resume yet.");
  }
  const response = await fetch(`${AGENT_API_BASE}/runs/${encodeURIComponent(runId)}/tool-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const run = await readAgentRunResponse(response);
  onRunUpdate?.(run, { type: "run_snapshot", run });
  if (isAgentRunTurnComplete(run, previousModelTurnIndex)) {
    return { run, response: run.latestResponse! };
  }
  const completedRun = await waitForAgentRunTurn(run.id, previousModelTurnIndex, onRunUpdate);
  if (!completedRun.latestResponse) {
    throw new AgentRunError("Agent run completed without a model response.", completedRun);
  }
  return { run: completedRun, response: completedRun.latestResponse };
};

export const cancelAgentRun = async (
  runId: string,
  options: { projectId?: string | null } = {},
): Promise<AgentRun> => {
  if (isTauriRuntime()) {
    throw new AgentRunError("Tauri Agent runs do not support persisted run cancellation yet.");
  }
  const params = new URLSearchParams();
  if (options.projectId) {
    params.set("projectId", options.projectId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${AGENT_API_BASE}/runs/${encodeURIComponent(runId)}/cancel${suffix}`, {
    method: "POST",
  });
  return readAgentRunResponse(response);
};

export const reportAgentCommandPlanResult = async (
  runId: string,
  result: {
    projectId?: string | null;
    status: AgentCommandPlanResultStatus;
    commandIds: string[];
    saved?: boolean;
    executionDiff?: AgentCommandPlanExecutionDiff;
    error?: string;
  },
): Promise<AgentRun | null> => {
  if (isTauriRuntime()) {
    return null;
  }
  const params = new URLSearchParams();
  if (result.projectId) {
    params.set("projectId", result.projectId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${AGENT_API_BASE}/runs/${encodeURIComponent(runId)}/command-result${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: result.status,
      commandIds: result.commandIds,
      saved: result.saved === true,
      ...(result.executionDiff ? { executionDiff: result.executionDiff } : {}),
      ...(result.error ? { error: result.error } : {}),
    }),
  });
  return readAgentRunResponse(response);
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
