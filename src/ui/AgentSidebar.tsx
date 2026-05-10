import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAgentRun,
  createAgentRequestTraceMetadata,
  AgentRunError,
  getAgentConfig,
  getAgentRequestTraceFromError,
  listAgentRuns,
  publishAgentDebugSnapshot,
  reportAgentCommandPlanResult,
  resumeAgentRunTurn,
  startAgentRunTurn,
  waitForExistingAgentRunTurn,
} from "../agent/client";
import {
  deleteAgentConversationContext,
  loadAgentConversationContext,
  saveAgentConversationContext,
} from "../agent/conversationContext";
import { getAgentContext } from "../agent/context";
import { createAgentDebugSnapshot, setLatestAgentDebugSnapshot } from "../agent/debug";
import { createProjectRole, deleteProjectRole, readProjectDocument } from "../agent/documents";
import { buildAgentHarness, createAgentHarnessToolResult, executeAgentHarnessToolCall } from "../agent/harness";
import { createAgentToolCallKey } from "../agent/toolCallPolicy";
import {
  DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS,
  MIN_AGENT_CONTEXT_WINDOW_TOKENS,
  parseAgentContextWindowTokens,
} from "../agent/contextWindow";
import {
  createAgentRoleMetadocPath,
  type AgentDocumentManifest,
} from "../agent/documentSchema";
import {
  AGENT_ROLES,
  DEFAULT_AGENT_ROLE_ID,
  createAgentRoleId,
  getAgentRole,
  type AgentRoleDefinition,
  type AgentRoleId,
} from "../agent/roles";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../agent/systemPrompt";
import { executeCommandPlan, previewCommandPlan } from "../agent/tools";
import type {
  AgentChatMessage,
  AgentChatRequest,
  AgentChatResponse,
  AgentConfig,
  AgentCommandPlan,
  AgentConversationEntry,
  AgentContextSnapshot,
  AgentHarnessToolResult,
  AgentRun,
  AgentRunEvent,
  AgentRunStep,
  AgentRequestTrace,
  AgentToolCallRequest,
  AgentToolLogEntry,
} from "../agent/types";
import { AgentCommandPlan as AgentCommandPlanView } from "./AgentCommandPlan";
import { AgentMessageList } from "./AgentMessageList";

const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const createMessage = (role: AgentChatMessage["role"], content: string): AgentChatMessage => ({
  id: createId("message"),
  role,
  content,
  createdAt: new Date().toISOString(),
});

const createLog = (
  label: string,
  status: AgentToolLogEntry["status"],
  detail?: string,
): AgentToolLogEntry => ({
  id: createId("tool"),
  label,
  status,
  detail,
  createdAt: new Date().toISOString(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const createBackendToolLogsFromStep = (step: AgentRunStep): AgentToolLogEntry[] => {
  if (step.kind !== "tool_result" || step.status !== "success" || !step.summary.includes("backend")) {
    return [];
  }
  const resultSummaries = Array.isArray(step.output) ? step.output : step.input;
  if (!Array.isArray(resultSummaries)) {
    return [];
  }
  return resultSummaries
    .filter(isRecord)
    .map((entry) => {
      const toolName = typeof entry.toolName === "string" ? entry.toolName : "agentTool";
      const contentLength = typeof entry.contentLength === "number" ? `contentLength=${entry.contentLength}` : null;
      const resultKeys = Array.isArray(entry.resultKeys)
        ? entry.resultKeys.filter((key): key is string => typeof key === "string")
        : [];
      const keySummary = resultKeys.length > 0 ? `keys=${resultKeys.slice(0, 6).join(",")}` : null;
      return createLog(toolName, "success", [contentLength, keySummary].filter(Boolean).join("; ") || "Backend tool result");
    });
};

const hasToolBudgetPauseWarning = (payload: AgentChatResponse) =>
  Boolean(payload.requestedToolCalls?.length && payload.warning?.toLowerCase().includes("tool budget"));

type AgentLocalOperation = {
  id: string;
  cancelled: boolean;
};

const isToolBudgetPausedRun = (run: AgentRun | null | undefined) =>
  Boolean(run?.status === "waiting_for_tool" && run.latestResponse && hasToolBudgetPauseWarning(run.latestResponse));

const markRunAsContinuing = (run: AgentRun): AgentRun => ({
  ...run,
  status: "running",
  pendingToolCalls: [],
  latestResponse: run.latestResponse
    ? {
        ...run.latestResponse,
        warning: undefined,
        requestedToolCalls: [],
      }
    : run.latestResponse,
});

const createMessageEntry = (message: AgentChatMessage): AgentConversationEntry => ({
  id: message.id,
  kind: "message",
  message,
  createdAt: message.createdAt,
});

const createToolEntry = (log: AgentToolLogEntry): AgentConversationEntry => ({
  id: log.id,
  kind: "tool",
  log,
  createdAt: log.createdAt,
});

const sanitizePlan = (plan: AgentCommandPlan | null | undefined): AgentCommandPlan | null => {
  if (!plan || !Array.isArray(plan.commands) || plan.commands.length === 0) {
    return null;
  }
  return previewCommandPlan({
    summary: plan.summary || "Command plan",
    commands: plan.commands.map((command) => ({
      commandId: command.commandId,
      payload: command.payload ?? {},
      reason: command.reason,
    })),
  });
};

const MAX_AGENT_TOOL_ROUNDS = 24;
const MAX_AGENT_TOOL_CALLS = 72;
const MAX_AGENT_TOOL_CALLS_PER_ROUND = 24;
const DEFAULT_AGENT_GREETING = "Ready. I can inspect the current project, offer suggestions, and prepare bounded command plans.";
const RESTORABLE_RUN_STATUSES = new Set(["queued", "running", "waiting_for_tool", "waiting_for_confirmation"]);
const CANCELLABLE_RUN_STATUSES = new Set<AgentRun["status"]>([
  "queued",
  "running",
  "waiting_for_tool",
  "waiting_for_confirmation",
]);
const createDefaultAgentMessages = () => [
  createMessage("assistant", DEFAULT_AGENT_GREETING),
];
const createDefaultConversationEntries = () =>
  createDefaultAgentMessages().map(createMessageEntry);

const isOnlyDefaultAgentGreeting = (messages: AgentChatMessage[]) =>
  messages.length === 1 &&
  messages[0].role === "assistant" &&
  messages[0].content === DEFAULT_AGENT_GREETING;

const toAgentWireMessages = (
  messages: AgentChatMessage[],
  internalNotice?: string,
): Array<{ role: "user" | "assistant"; content: string }> => [
  ...messages.map(({ role, content }) => ({ role, content })),
  ...(internalNotice ? [{ role: "user" as const, content: internalNotice }] : []),
];

type AgentContinuationState = {
  id: string;
  run: AgentRun | null;
  messages: AgentChatMessage[];
  systemPrompt: string;
  context: AgentContextSnapshot;
  activeRole: AgentRoleDefinition;
  activeDocumentId: string | null;
  dynamicToolResults: AgentHarnessToolResult[];
  completedToolCallKeys: string[];
  requestedToolCalls: AgentToolCallRequest[];
  totalExecutedToolCallCount: number;
  pauseReason: string;
  createdAt: string;
};

type ConversationContextScope = {
  projectId: string;
  roleId: string;
};

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const describeToolCallForLog = (call: { toolName: string; input: unknown }) => {
  const input = readRecord(call.input);
  if (call.toolName === "writeDocument") {
    const content = typeof input.content === "string" ? input.content : "";
    return `documentId=${String(input.id ?? "unknown")}; title=${String(input.title ?? "untitled")}; contentLength=${content.length}`;
  }
  if (call.toolName === "readDocument" || call.toolName === "validateDocumentAgainstProject") {
    return `documentId=${String(input.documentId ?? "unknown")}`;
  }
  if (call.toolName === "readPages" || call.toolName === "renderPages") {
    const pageIds = Array.isArray(input.pageIds) ? input.pageIds : [];
    return `pageIds=${pageIds.length}`;
  }
  if (call.toolName === "readPage" || call.toolName === "renderPage") {
    return `pageId=${String(input.pageId ?? "unknown")}`;
  }
  if (call.toolName === "searchProject" || call.toolName === "searchDocuments" || call.toolName === "listImageAssets") {
    return `queryLength=${typeof input.query === "string" ? input.query.length : 0}; limit=${String(input.limit ?? "default")}`;
  }
  return "Completed";
};

const RUNTIME_CONFIG_KEY_PREFIX = "mangamaker:agent:runtimeConfig:v1:";

const runtimeConfigKeyForProject = (projectId: string) => `${RUNTIME_CONFIG_KEY_PREFIX}${projectId}`;

type AgentRuntimeConfig = {
  systemPrompt: string;
  contextWindowTokens: number | null;
};

const loadRuntimeConfig = (projectId: string): AgentRuntimeConfig => {
  try {
    const raw = window.localStorage.getItem(runtimeConfigKeyForProject(projectId));
    if (!raw) {
      return { systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT, contextWindowTokens: null };
    }
    const parsed = JSON.parse(raw) as { systemPrompt?: unknown; contextWindowTokens?: unknown };
    return {
      systemPrompt:
        typeof parsed.systemPrompt === "string" && parsed.systemPrompt.trim().length > 0
          ? parsed.systemPrompt
          : DEFAULT_AGENT_SYSTEM_PROMPT,
      contextWindowTokens: parseAgentContextWindowTokens(parsed.contextWindowTokens),
    };
  } catch {
    return { systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT, contextWindowTokens: null };
  }
};

const saveRuntimeConfig = (
  projectId: string,
  config: { systemPrompt: string; contextWindowTokens: number | null },
) => {
  try {
    window.localStorage.setItem(
      runtimeConfigKeyForProject(projectId),
      JSON.stringify({
        systemPrompt: config.systemPrompt,
        contextWindowTokens: config.contextWindowTokens,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Runtime config is a front-end override. Failing to persist it must not block chat.
  }
};

const formatTokenCount = (tokens: number | null | undefined) =>
  typeof tokens === "number" && Number.isFinite(tokens)
    ? new Intl.NumberFormat("en-US").format(tokens)
    : "unknown";

export const AgentSidebar = ({
  selectedDocumentId = null,
  documentManifest = null,
  onSelectDocument,
  onDocumentsChanged,
}: {
  selectedDocumentId?: string | null;
  documentManifest?: AgentDocumentManifest | null;
  onSelectDocument?: (documentId: string | null) => void;
  onDocumentsChanged?: () => void;
}) => {
  const [conversationEntries, setConversationEntries] = useState<AgentConversationEntry[]>(
    createDefaultConversationEntries,
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<AgentCommandPlan | null>(null);
  const [pendingPlanRun, setPendingPlanRun] = useState<{ runId: string; projectId: string } | null>(null);
  const [contextSnapshot, setContextSnapshot] = useState<AgentContextSnapshot | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const [conversationContextScope, setConversationContextScope] = useState<ConversationContextScope | null>(null);
  const [conversationContextLoaded, setConversationContextLoaded] = useState(false);
  const [activeRoleId, setActiveRoleId] = useState<AgentRoleId>(DEFAULT_AGENT_ROLE_ID);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_AGENT_SYSTEM_PROMPT);
  const [contextWindowInput, setContextWindowInput] = useState(String(DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS));
  const [configPanelOpen, setConfigPanelOpen] = useState(false);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [pendingContinuation, setPendingContinuation] = useState<AgentContinuationState | null>(null);
  const [localDocumentManifest, setLocalDocumentManifest] = useState<AgentDocumentManifest | null>(null);
  const [requestTraces, setRequestTraces] = useState<AgentRequestTrace[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [continuingToolBudgetRunId, setContinuingToolBudgetRunId] = useState<string | null>(null);
  const [toolBudgetActionRunId, setToolBudgetActionRunId] = useState<string | null>(null);
  const handledRunResponsesRef = useRef(new Set<string>());
  const handledRunStepLogIdsRef = useRef(new Set<string>());
  const localRunControlRef = useRef(false);
  const reconnectingRunRef = useRef<string | null>(null);
  const suppressCompletedRunRestoreRef = useRef(false);
  const continuingToolBudgetRunRef = useRef<{ runId: string; previousModelTurnIndex: number } | null>(null);
  const toolBudgetActionRunIdRef = useRef<string | null>(null);
  const currentAgentOperationRef = useRef<AgentLocalOperation | null>(null);
  const [newRole, setNewRole] = useState({
    name: "",
    title: "",
    prompt: "",
    metadocMode: "new" as "new" | "existing",
    metadocId: "",
    metadocTitle: "",
    metadocPath: "",
  });
  const messages = useMemo(
    () =>
      conversationEntries
        .filter((entry): entry is Extract<AgentConversationEntry, { kind: "message" }> =>
          entry.kind === "message",
        )
        .map((entry) => entry.message),
    [conversationEntries],
  );
  const effectiveDocumentManifest = localDocumentManifest ?? documentManifest;

  useEffect(() => {
    setLocalDocumentManifest(null);
  }, [documentManifest?.updatedAt]);
  const toolLogs = useMemo(
    () =>
      conversationEntries
        .filter((entry): entry is Extract<AgentConversationEntry, { kind: "tool" }> =>
          entry.kind === "tool",
        )
        .map((entry) => entry.log)
        .reverse(),
    [conversationEntries],
  );

  const recordRequestTrace = (trace: AgentRequestTrace | null | undefined) => {
    if (!trace) {
      return;
    }
    setRequestTraces((current) => [
      trace,
      ...current.filter((entry) => entry.requestId !== trace.requestId),
    ].slice(0, 30));
  };

  const beginContinuingToolBudgetRun = (run: AgentRun) => {
    continuingToolBudgetRunRef.current = {
      runId: run.id,
      previousModelTurnIndex: run.modelTurnIndex,
    };
    setContinuingToolBudgetRunId(run.id);
  };

  const clearContinuingToolBudgetRun = (runId?: string | null) => {
    if (!runId || continuingToolBudgetRunRef.current?.runId === runId) {
      continuingToolBudgetRunRef.current = null;
      setContinuingToolBudgetRunId(null);
    }
  };

  const beginToolBudgetAction = (actionId: string) => {
    if (toolBudgetActionRunIdRef.current === actionId) {
      return false;
    }
    toolBudgetActionRunIdRef.current = actionId;
    setToolBudgetActionRunId(actionId);
    return true;
  };

  const clearToolBudgetAction = (actionId?: string | null) => {
    if (!actionId || toolBudgetActionRunIdRef.current === actionId) {
      toolBudgetActionRunIdRef.current = null;
      setToolBudgetActionRunId(null);
    }
  };

  const isAgentOperationCancelled = (operationId: string) =>
    currentAgentOperationRef.current?.id === operationId &&
    currentAgentOperationRef.current.cancelled;

  const cancelCurrentAgentOperation = () => {
    if (currentAgentOperationRef.current) {
      currentAgentOperationRef.current.cancelled = true;
    }
  };

  const recordAgentRunUpdate = (run: AgentRun, _event?: AgentRunEvent) => {
    const continuingRun = continuingToolBudgetRunRef.current;
    if (
      continuingRun?.runId === run.id &&
      run.modelTurnIndex <= continuingRun.previousModelTurnIndex &&
      isToolBudgetPausedRun(run)
    ) {
      return;
    }
    if (
      continuingRun?.runId === run.id &&
      run.modelTurnIndex > continuingRun.previousModelTurnIndex &&
      (run.status === "waiting_for_tool" || run.status === "waiting_for_confirmation" || run.status === "completed" || run.status === "failed" || run.status === "cancelled")
    ) {
      clearContinuingToolBudgetRun(run.id);
    }
    setActiveRun(run);
    for (const step of run.steps) {
      if (handledRunStepLogIdsRef.current.has(step.id)) {
        continue;
      }
      const backendLogs = createBackendToolLogsFromStep(step);
      if (backendLogs.length === 0) {
        continue;
      }
      handledRunStepLogIdsRef.current.add(step.id);
      for (const log of backendLogs) {
        appendLog(log);
      }
    }
    setRequestTraces((current) => {
      const byId = new Map(current.map((trace) => [trace.requestId, trace]));
      for (const trace of run.trace) {
        byId.set(trace.requestId, trace);
      }
      return Array.from(byId.values())
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 30);
    });
  };

  const recordAgentError = (error: unknown) => {
    recordRequestTrace(getAgentRequestTraceFromError(error));
    if (error instanceof AgentRunError && error.run) {
      recordAgentRunUpdate(error.run);
    }
  };

  const sendAgentRunRequest = async (
    request: Omit<AgentChatRequest, "requestTrace">,
    stage: string,
    operationId?: string,
  ) => {
    const result = await startAgentRunTurn({
      ...request,
      contextWindowTokens: effectiveContextWindowTokens,
      requestTrace: createAgentRequestTraceMetadata(stage),
    }, (run, event) => {
      if (operationId && isAgentOperationCancelled(operationId)) {
        return;
      }
      recordAgentRunUpdate(run, event);
    });
    recordRequestTrace(result.response.requestTrace);
    return result;
  };

  useEffect(() => {
    const snapshot = createAgentDebugSnapshot({
      mounted: true,
      busy,
      messages,
      toolLogs,
      requestTraces,
      config,
      configError,
      lastWarning,
      pendingPlan,
      contextSnapshot,
      activeRoleId,
      activeDocumentId: selectedDocumentId,
      activeRun,
    });
    setLatestAgentDebugSnapshot(snapshot);
    void publishAgentDebugSnapshot(snapshot);
  }, [busy, messages, toolLogs, requestTraces, config, configError, lastWarning, pendingPlan, contextSnapshot, activeRoleId, selectedDocumentId, activeRun, continuingToolBudgetRunId]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([getAgentConfig(), getAgentContext()]).then(async ([configResult, contextResult]) => {
      if (!active) {
        return;
      }
      if (configResult.status === "fulfilled") {
        setConfig(configResult.value);
      } else {
        const message =
          configResult.reason instanceof Error ? configResult.reason.message : String(configResult.reason);
        setConfig({
          enabled: false,
          provider: "unavailable",
          model: null,
          apiKeyConfigured: false,
          testMode: false,
          visionEnabled: false,
          contextWindowTokens: DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS,
          contextWindowMaxTokens: null,
          contextWindowSource: "default",
          reason: message,
        });
        setConfigError(message);
      }
      if (contextResult.status === "fulfilled") {
        setContextSnapshot(contextResult.value);
        const projectId = contextResult.value.project.id;
        const runtimeConfig = loadRuntimeConfig(projectId);
        const backendContextWindow =
          configResult.status === "fulfilled"
            ? configResult.value.contextWindowTokens
            : DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS;
        setSystemPrompt(runtimeConfig.systemPrompt);
        setContextWindowInput(String(runtimeConfig.contextWindowTokens ?? backendContextWindow));
      }
    });
    return () => {
      active = false;
      const snapshot = createAgentDebugSnapshot({
        mounted: false,
        busy: false,
        messages,
        toolLogs,
        requestTraces,
        config,
        configError,
        lastWarning,
        pendingPlan,
        contextSnapshot,
        activeRoleId,
        activeDocumentId: selectedDocumentId,
        activeRun,
      });
      setLatestAgentDebugSnapshot(snapshot);
      void publishAgentDebugSnapshot(snapshot);
    };
  }, []);

  useEffect(() => {
    if (!conversationContextLoaded || !conversationContextScope) {
      return;
    }
    saveRuntimeConfig(conversationContextScope.projectId, {
      systemPrompt,
      contextWindowTokens: parseAgentContextWindowTokens(contextWindowInput),
    });
  }, [contextWindowInput, conversationContextLoaded, conversationContextScope, systemPrompt]);

  useEffect(() => {
    if (busy) {
      return;
    }
    setConversationEntries((current) => {
      let changed = false;
      const next = current.map((entry) => {
        if (entry.kind !== "tool" || entry.log.status !== "pending") {
          return entry;
        }
        changed = true;
        return {
          ...entry,
          log: {
            ...entry.log,
            status: "error" as const,
            detail: entry.log.detail
              ? `${entry.log.detail}; operation ended before this tool reported a result`
              : "Operation ended before this tool reported a result.",
          },
        };
      });
      return changed ? next : current;
    });
  }, [busy]);

  const availableRoles = useMemo(
    () => (effectiveDocumentManifest ? effectiveDocumentManifest.roles : AGENT_ROLES),
    [effectiveDocumentManifest],
  );
  const metadocRoleIds = useMemo(
    () => new Set(availableRoles.map((role) => role.metadocId)),
    [availableRoles],
  );
  const ordinaryDocuments = useMemo(
    () => (effectiveDocumentManifest?.documents ?? []).filter((document) => !metadocRoleIds.has(document.id)),
    [effectiveDocumentManifest, metadocRoleIds],
  );

  const effectiveContextWindowTokens =
    parseAgentContextWindowTokens(contextWindowInput) ??
    config?.contextWindowTokens ??
    DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS;

  const configSummary = useMemo(() => {
    if (!config) {
      return "Checking Agent configuration...";
    }
    const contextLabel = `context ${formatTokenCount(effectiveContextWindowTokens)} tokens`;
    if (config.testMode) {
      return `Test mode · ${config.visionEnabled ? "vision enabled" : "vision unavailable"} · ${contextLabel}`;
    }
    if (!config.enabled) {
      return config.reason ?? "Agent backend is not configured.";
    }
    return `OpenRouter · ${config.model ?? "model not set"} · ${
      config.visionEnabled ? "vision enabled" : "vision unavailable"
    } · ${contextLabel}`;
  }, [config, effectiveContextWindowTokens]);
  const activeRole = useMemo(
    () => (availableRoles.length > 0 ? getAgentRole(activeRoleId, availableRoles) : null),
    [activeRoleId, availableRoles],
  );
  const activeRoleMetadoc = useMemo(
    () =>
      activeRole
        ? effectiveDocumentManifest?.documents.find((document) => document.id === activeRole.metadocId) ?? null
        : null,
    [activeRole, effectiveDocumentManifest],
  );

  useEffect(() => {
    if (availableRoles.length === 0) {
      if (activeRoleId) {
        setActiveRoleId("");
      }
      return;
    }
    if (!availableRoles.some((role) => role.id === activeRoleId)) {
      setActiveRoleId(availableRoles[0].id);
    }
  }, [activeRoleId, availableRoles]);

  useEffect(() => {
    const projectId = contextSnapshot?.project.id;
    const roleId = activeRole?.id;
    if (!projectId || !roleId) {
      setConversationContextLoaded(false);
      setConversationContextScope(null);
      return;
    }

    let active = true;
    suppressCompletedRunRestoreRef.current = false;
    setConversationContextLoaded(false);
    setConversationEntries(createDefaultConversationEntries());
    setPendingPlan(null);
    setLastWarning(null);
    setPendingContinuation(null);
    void loadAgentConversationContext(projectId, roleId).then((storedContext) => {
      if (!active) {
        return;
      }
      setConversationEntries(
        (storedContext && storedContext.messages.length > 0
          ? storedContext.messages
          : createDefaultAgentMessages()
        ).map(createMessageEntry),
      );
      setConversationContextScope({ projectId, roleId });
      setConversationContextLoaded(true);
    });

    return () => {
      active = false;
    };
  }, [contextSnapshot?.project.id, activeRole?.id]);

  useEffect(() => {
    if (!conversationContextLoaded || !conversationContextScope || !activeRole) {
      return;
    }
    if (conversationContextScope.roleId !== activeRole.id) {
      return;
    }
    if (isOnlyDefaultAgentGreeting(messages)) {
      return;
    }
    void saveAgentConversationContext(
      conversationContextScope.projectId,
      conversationContextScope.roleId,
      messages,
    );
  }, [activeRole, conversationContextLoaded, conversationContextScope, messages]);

  const appendLog = (log: AgentToolLogEntry) => {
    setConversationEntries((current) => {
      const withoutSupersededPending = current.filter(
        (entry) =>
          !(
            entry.kind === "tool" &&
            entry.log.label === log.label &&
            entry.log.status === "pending"
          ),
      );
      const next = [...withoutSupersededPending, createToolEntry(log)];
      const toolEntries = next.filter((entry) => entry.kind === "tool");
      if (toolEntries.length <= 80) {
        return next;
      }
      const toolIdsToDrop = new Set(
        toolEntries.slice(0, toolEntries.length - 80).map((entry) => entry.id),
      );
      return next.filter((entry) => entry.kind !== "tool" || !toolIdsToDrop.has(entry.id));
    });
  };

  const markPendingLogsAsError = (detail: string) => {
    setConversationEntries((current) =>
      current.map((entry) => {
        if (entry.kind !== "tool" || entry.log.status !== "pending") {
          return entry;
        }
        return {
          ...entry,
          log: {
            ...entry.log,
            status: "error",
            detail: entry.log.detail ? `${entry.log.detail}; ${detail}` : detail,
          },
        };
      }),
    );
  };

  const appendMessage = (message: AgentChatMessage) => {
    setConversationEntries((current) => [...current, createMessageEntry(message)]);
  };

  const clearConversationContext = () => {
    const projectId = contextSnapshot?.project.id ?? conversationContextScope?.projectId;
    const roleId = activeRole?.id ?? conversationContextScope?.roleId;
    suppressCompletedRunRestoreRef.current = true;
    if (projectId && roleId) {
      void deleteAgentConversationContext(projectId, roleId);
    }
    setConversationEntries(createDefaultConversationEntries());
    setActiveRun(null);
    if (projectId && roleId) {
      setConversationContextScope({ projectId, roleId });
    }
    setConversationContextLoaded(Boolean(projectId && roleId));
    setPendingPlan(null);
    setLastWarning(null);
    setPendingContinuation(null);
  };

  const openRoleDialog = (metadocId?: string) => {
    setRoleError(null);
    setNewRole({
      name: "",
      title: "",
      prompt: "",
      metadocMode: metadocId ? "existing" : "new",
      metadocId: metadocId ?? ordinaryDocuments[0]?.id ?? "",
      metadocTitle: "",
      metadocPath: "",
    });
    setRoleDialogOpen(true);
  };

  const createRole = async (event: FormEvent) => {
    event.preventDefault();
    const projectId = effectiveDocumentManifest?.projectId ?? contextSnapshot?.project.id ?? conversationContextScope?.projectId;
    const name = newRole.name.trim();
    if (!projectId) {
      setRoleError("Project context is not loaded yet.");
      return;
    }
    if (!name) {
      setRoleError("Role name is required.");
      return;
    }
    if (newRole.metadocMode === "existing" && !newRole.metadocId) {
      setRoleError("Choose a metadoc document or create a new metadoc.");
      return;
    }
    const roleId = createAgentRoleId(name, availableRoles);
    setRoleSaving(true);
    setRoleError(null);
    try {
      const manifest = await createProjectRole(projectId, {
        id: roleId,
        name,
        title: newRole.title.trim() || name,
        prompt: newRole.prompt.trim() || undefined,
        ...(newRole.metadocMode === "existing"
          ? { metadocId: newRole.metadocId }
          : {
              metadocTitle: name,
            }),
      });
      setLocalDocumentManifest(manifest);
      setActiveRoleId(roleId);
      setRoleDialogOpen(false);
      onDocumentsChanged?.();
    } catch (error) {
      setRoleError(error instanceof Error ? error.message : String(error));
    } finally {
      setRoleSaving(false);
    }
  };

  const deleteRole = async (role: AgentRoleDefinition) => {
    const projectId = effectiveDocumentManifest?.projectId ?? contextSnapshot?.project.id ?? conversationContextScope?.projectId;
    if (!projectId) {
      setRoleError("Project context is not loaded yet.");
      return;
    }
    const confirmed = window.confirm(
      `Delete role "${role.name}"?\n\nIts metadoc will be kept as an ordinary Markdown document.`,
    );
    if (!confirmed) {
      return;
    }
    setRoleSaving(true);
    setRoleError(null);
    try {
      const manifest = await deleteProjectRole(projectId, role.id);
      setLocalDocumentManifest(manifest);
      setActiveRoleId("");
      onDocumentsChanged?.();
    } catch (error) {
      setRoleError(error instanceof Error ? error.message : String(error));
    } finally {
      setRoleSaving(false);
    }
  };

  const updateMessage = (
    messageId: string,
    patch: Partial<Pick<AgentChatMessage, "role" | "content">>,
  ) => {
    setConversationEntries((current) =>
      current.map((entry) =>
        entry.kind === "message" && entry.message.id === messageId
          ? {
              ...entry,
              message: {
                ...entry.message,
                ...patch,
              },
            }
          : entry,
      ),
    );
  };

  const deleteMessage = (messageId: string) => {
    setConversationEntries((current) =>
      current.filter((entry) => entry.kind !== "message" || entry.message.id !== messageId),
    );
  };

  const addContextMessage = (role: AgentChatMessage["role"]) => {
    setConversationEntries((current) => [...current, createMessageEntry(createMessage(role, ""))]);
  };

  const runPlan = async (
    plan: AgentCommandPlan,
    approved: boolean,
    sourceRun: { runId: string; projectId: string } | null = pendingPlanRun,
  ) => {
    setBusy(true);
    appendLog(createLog("executeCommandPlan", "pending", plan.summary));
    try {
      const result = await executeCommandPlan(plan, { approved, persistProject: true });
      const executedCommandIds = result.results.map((entry) => entry.commandId);
      appendLog(
        createLog(
          "executeCommandPlan",
          "success",
          executedCommandIds.join(", "),
        ),
      );
      setPendingPlan(null);
      setPendingPlanRun(null);
      if (sourceRun) {
        const completedRun = await reportAgentCommandPlanResult(sourceRun.runId, {
          projectId: sourceRun.projectId,
          status: "success",
          commandIds: executedCommandIds,
          saved: executedCommandIds.includes("saveProject"),
        });
        if (completedRun) {
          recordAgentRunUpdate(completedRun);
        }
      }
      const nextContext = await getAgentContext();
      setContextSnapshot(nextContext);
      appendMessage(createMessage("assistant", `Executed: ${executedCommandIds.join(", ")}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(createLog("executeCommandPlan", "error", message));
      if (sourceRun) {
        try {
          const failedRun = await reportAgentCommandPlanResult(sourceRun.runId, {
            projectId: sourceRun.projectId,
            status: "error",
            commandIds: plan.commands.map((entry) => entry.commandId),
            error: message,
          });
          if (failedRun) {
            recordAgentRunUpdate(failedRun);
          }
        } catch (reportError) {
          appendLog(createLog("agentRun", "error", reportError instanceof Error ? reportError.message : String(reportError)));
        }
      }
      appendMessage(createMessage("assistant", message));
    } finally {
      setBusy(false);
    }
  };

  const finishAgentPayload = async (
    payload: AgentChatResponse,
    options: { suppressMessage?: boolean; sourceRun?: AgentRun | null } = {},
  ) => {
    if (payload.error) {
      throw new Error(payload.error);
    }
    appendLog(createLog("agentChat", "success", payload.usedVision === false ? "Responded without visual input" : "Model response received"));
    const warning = payload.warning ?? payload.visionUnavailableReason ?? null;
    if (warning) {
      setLastWarning(warning);
      appendLog(createLog("agentWarning", "error", warning));
    }
    if (!options.suppressMessage) {
      appendMessage(createMessage("assistant", payload.message));
    }
    for (const log of payload.toolLogs ?? []) {
      appendLog(log);
    }
    const plan = sanitizePlan(payload.pendingCommandPlan);
    if (!plan) {
      return;
    }
    const sourceRun =
      options.sourceRun && options.sourceRun.projectId
        ? { runId: options.sourceRun.id, projectId: options.sourceRun.projectId }
        : null;
    setPendingPlan(plan);
    setPendingPlanRun(sourceRun);
    if (!plan.requiresConfirmation) {
      await runPlan(plan, true, sourceRun);
    }
  };

  const finishRunResponse = async (run: AgentRun) => {
    const response = run.latestResponse;
    if (!response) {
      return;
    }
    const responseKey = `${run.id}:${run.modelTurnIndex}`;
    if (handledRunResponsesRef.current.has(responseKey)) {
      return;
    }
    handledRunResponsesRef.current.add(responseKey);
    const responseAlreadyVisible = messages.some(
      (message) => message.role === "assistant" && message.content === response.message,
    );
    if (responseAlreadyVisible && !response.pendingCommandPlan) {
      return;
    }
    await finishAgentPayload(response, { suppressMessage: responseAlreadyVisible, sourceRun: run });
  };

  const pauseForToolBudget = ({
    messages,
    systemPromptSnapshot,
    context,
    activeRoleSnapshot,
    activeDocumentId,
    run,
    dynamicToolResults,
    completedToolCallKeys,
    requestedToolCalls,
    totalExecutedToolCallCount,
    segmentExecutedToolCallCount,
    pauseReason,
  }: {
    messages: AgentChatMessage[];
    systemPromptSnapshot: string;
    context: AgentContextSnapshot;
    activeRoleSnapshot: AgentRoleDefinition;
    activeDocumentId: string | null;
    run: AgentRun | null;
    dynamicToolResults: AgentHarnessToolResult[];
    completedToolCallKeys: string[];
    requestedToolCalls: AgentToolCallRequest[];
    totalExecutedToolCallCount: number;
    segmentExecutedToolCallCount: number;
    pauseReason: string;
  }) => {
    clearContinuingToolBudgetRun(run?.id);
    const nextTotalExecutedToolCallCount = totalExecutedToolCallCount + segmentExecutedToolCallCount;
    const nextDynamicToolResults = [
      ...dynamicToolResults,
      createAgentHarnessToolResult("toolBudget", {}, {
        exhausted: true,
        remainingToolCalls: 0,
        totalExecutedToolCallCount: nextTotalExecutedToolCallCount,
        segmentExecutedToolCallCount,
        maxToolCallsPerSegment: MAX_AGENT_TOOL_CALLS,
        maxRoundsPerSegment: MAX_AGENT_TOOL_ROUNDS,
        deniedToolCalls: requestedToolCalls.map(({ toolName, input, reason }) => ({ toolName, input, reason })),
        reason: pauseReason,
      }),
    ];
    setPendingContinuation({
      id: createId("continuation"),
      run,
      messages,
      systemPrompt: systemPromptSnapshot,
      context,
      activeRole: activeRoleSnapshot,
      activeDocumentId,
      dynamicToolResults: nextDynamicToolResults,
      completedToolCallKeys,
      requestedToolCalls,
      totalExecutedToolCallCount: nextTotalExecutedToolCallCount,
      pauseReason,
      createdAt: new Date().toISOString(),
    });
    setLastWarning("Tool budget reached. Choose Continue or Stop.");
    appendLog(createLog("agentToolBudget", "error", pauseReason));
    appendLog(createLog("agentChat", "success", "Paused at tool budget; waiting for creator decision"));
    appendMessage(
      createMessage(
        "assistant",
        `Tool budget reached. I paused instead of answering from incomplete evidence.\n\nExecuted tool calls so far: ${nextTotalExecutedToolCallCount}\nPending tool requests: ${requestedToolCalls.length}\n\nChoose Continue to run another tool segment, or Stop to end this task.`,
      ),
    );
  };

  const runAgentToolLoop = async ({
    initialPayload,
    initialRun,
    messages,
    systemPromptSnapshot,
    context,
    activeRoleSnapshot,
    activeDocumentId,
    dynamicToolResults: initialDynamicToolResults,
    completedToolCallKeys,
    totalExecutedToolCallCount,
    continueBackendBudgetSegment,
  }: {
    initialPayload: AgentChatResponse;
    initialRun?: AgentRun | null;
    messages: AgentChatMessage[];
    systemPromptSnapshot: string;
    context: AgentContextSnapshot;
    activeRoleSnapshot: AgentRoleDefinition;
    activeDocumentId: string | null;
    dynamicToolResults: AgentHarnessToolResult[];
    completedToolCallKeys?: string[];
    totalExecutedToolCallCount?: number;
    continueBackendBudgetSegment?: boolean;
  }) => {
    let payload = initialPayload;
    let currentRun = initialRun ?? null;
    let dynamicToolResults = initialDynamicToolResults;
    let segmentExecutedToolCallCount = 0;
    let shouldContinueBackendBudgetSegment = continueBackendBudgetSegment === true;
    const completedToolCalls = new Set(completedToolCallKeys ?? []);

    if (hasToolBudgetPauseWarning(payload)) {
      pauseForToolBudget({
        messages,
        systemPromptSnapshot,
        context,
        activeRoleSnapshot,
        activeDocumentId,
        run: currentRun,
        dynamicToolResults,
        completedToolCallKeys: Array.from(completedToolCalls),
        requestedToolCalls: payload.requestedToolCalls ?? [],
        totalExecutedToolCallCount: totalExecutedToolCallCount ?? 0,
        segmentExecutedToolCallCount,
        pauseReason:
          payload.warning ??
          "Agent reached the backend tool budget. It paused instead of answering from incomplete evidence.",
      });
      return;
    }

    for (let round = 0; round < MAX_AGENT_TOOL_ROUNDS && payload.requestedToolCalls?.length; round += 1) {
      if (hasToolBudgetPauseWarning(payload)) {
        pauseForToolBudget({
          messages,
          systemPromptSnapshot,
          context,
          activeRoleSnapshot,
          activeDocumentId,
          run: currentRun,
          dynamicToolResults,
          completedToolCallKeys: Array.from(completedToolCalls),
          requestedToolCalls: payload.requestedToolCalls ?? [],
          totalExecutedToolCallCount: totalExecutedToolCallCount ?? 0,
          segmentExecutedToolCallCount,
          pauseReason:
            payload.warning ??
            "Agent reached the backend tool budget. It paused instead of answering from incomplete evidence.",
        });
        return;
      }
      const requestedCalls = payload.requestedToolCalls;
      const remainingToolCalls = Math.max(0, MAX_AGENT_TOOL_CALLS - segmentExecutedToolCallCount);
      if (remainingToolCalls === 0) {
        break;
      }
      const executableCalls = requestedCalls.slice(0, Math.min(remainingToolCalls, MAX_AGENT_TOOL_CALLS_PER_ROUND));
      const deferredCalls = requestedCalls.slice(executableCalls.length);
      if (deferredCalls.length > 0) {
        dynamicToolResults = [
          ...dynamicToolResults,
          createAgentHarnessToolResult("toolBudget", {}, {
            exhausted: false,
            remainingToolCalls,
            deferredToolCalls: deferredCalls.map(({ toolName, input, reason }) => ({ toolName, input, reason })),
            reason: "Per-round tool call limit reached; request fewer or batch related reads.",
          }),
        ];
        appendLog(createLog("agentToolBudget", "error", `${deferredCalls.length} tool call(s) deferred by per-round limit`));
      }
      appendLog(createLog("agentToolCalls", "pending", requestedCalls.map((call) => call.toolName).join(", ")));
      const toolResults: AgentHarnessToolResult[] = [];
      for (const call of executableCalls) {
        const toolCallKey = createAgentToolCallKey(call);
        if (completedToolCalls.has(toolCallKey)) {
          const skipped = createAgentHarnessToolResult("toolCallSkipped", {
            toolName: call.toolName,
            input: call.input,
          }, {
            reason: "Duplicate tool call skipped; the previous result is already present in the harness.",
          });
          toolResults.push(skipped);
          appendLog(createLog(call.toolName, "success", "Skipped duplicate tool call"));
          continue;
        }
        appendLog(createLog(call.toolName, "pending", call.reason));
        const toolResult = await executeAgentHarnessToolCall(context, call);
        toolResults.push(toolResult);
        if (call.toolName === "writeDocument") {
          onDocumentsChanged?.();
        }
        completedToolCalls.add(toolCallKey);
        segmentExecutedToolCallCount += 1;
        appendLog(createLog(call.toolName, "success", describeToolCallForLog(call)));
      }
      dynamicToolResults = [
        ...dynamicToolResults,
        ...toolResults,
        createAgentHarnessToolResult("toolBudget", {}, {
          exhausted: segmentExecutedToolCallCount >= MAX_AGENT_TOOL_CALLS,
          remainingToolCalls: Math.max(0, MAX_AGENT_TOOL_CALLS - segmentExecutedToolCallCount),
          segmentExecutedToolCallCount,
          totalExecutedToolCallCount: (totalExecutedToolCallCount ?? 0) + segmentExecutedToolCallCount,
          maxToolCallsPerSegment: MAX_AGENT_TOOL_CALLS,
          maxRoundsPerSegment: MAX_AGENT_TOOL_ROUNDS,
        }),
      ];
      appendLog(createLog("agentToolCalls", "success", `${toolResults.length} tool result(s)`));
      appendLog(createLog("agentChat", "pending", `Waiting for model response after ${toolResults.length} tool result(s)`));
      const harness = buildAgentHarness(context, dynamicToolResults);
      const nextRequest = {
        messages: toAgentWireMessages(messages),
        systemPrompt: systemPromptSnapshot,
        agentContext: context,
        activeRoleId: activeRoleSnapshot.id,
        activeRole: activeRoleSnapshot,
        activeDocumentId,
        harness,
        canvasSnapshot: context.canvasSnapshot,
      };
      if (currentRun && !currentRun.id.startsWith("agent-run-tauri")) {
        const result = await resumeAgentRunTurn(
          currentRun.id,
          currentRun.modelTurnIndex,
          {
            harness,
            toolResults,
            dynamicToolResults,
            continueBudgetSegment: shouldContinueBackendBudgetSegment,
          },
          recordAgentRunUpdate,
        );
        shouldContinueBackendBudgetSegment = false;
        currentRun = result.run;
        payload = result.response;
      } else {
        const result = await sendAgentRunRequest(nextRequest, "after-tool-results");
        currentRun = result.run;
        payload = result.response;
      }
    }

    if (payload.error) {
      throw new Error(payload.error);
    }
    if (payload.requestedToolCalls?.length) {
      const pauseReason =
        segmentExecutedToolCallCount >= MAX_AGENT_TOOL_CALLS
          ? "Agent reached the current tool-call budget. It paused instead of answering from incomplete evidence."
          : "Agent reached the current tool-round budget. It paused instead of answering from incomplete evidence.";
      pauseForToolBudget({
        messages,
        systemPromptSnapshot,
        context,
        activeRoleSnapshot,
        activeDocumentId,
        run: currentRun,
        dynamicToolResults,
        completedToolCallKeys: Array.from(completedToolCalls),
        requestedToolCalls: payload.requestedToolCalls,
        totalExecutedToolCallCount: totalExecutedToolCallCount ?? 0,
        segmentExecutedToolCallCount,
        pauseReason,
      });
      return;
    }

    await finishAgentPayload(payload, { sourceRun: currentRun });
  };

  const continueAgentRun = async () => {
    if (!pendingContinuation) {
      return;
    }
    const continuation = pendingContinuation;
    const actionId = continuation.run?.id ?? continuation.id;
    if (!beginToolBudgetAction(actionId)) {
      return;
    }
    setPendingContinuation(null);
    setLastWarning(null);
    localRunControlRef.current = true;
    setBusy(true);
    if (continuation.run) {
      const continuingRunId = continuation.run.id;
      beginContinuingToolBudgetRun(continuation.run);
      setActiveRun((current) =>
        current?.id === continuingRunId ? markRunAsContinuing(current) : current,
      );
    }
    appendLog(createLog("agentToolBudget", "success", "Continuing with a new tool budget segment"));
    try {
      await runAgentToolLoop({
        initialPayload: {
          message: "Continuing paused tool requests.",
          pendingCommandPlan: null,
          requestedToolCalls: continuation.requestedToolCalls,
        },
        messages: continuation.messages,
        systemPromptSnapshot: continuation.systemPrompt,
        context: continuation.context,
        activeRoleSnapshot: continuation.activeRole,
        activeDocumentId: continuation.activeDocumentId,
        initialRun: continuation.run,
        dynamicToolResults: [
          ...continuation.dynamicToolResults,
          createAgentHarnessToolResult("toolBudget", {}, {
            exhausted: false,
            continuedByCreator: true,
            reason: "Creator continued the run after the previous tool budget segment was exhausted.",
          }),
        ],
        completedToolCallKeys: continuation.completedToolCallKeys,
        totalExecutedToolCallCount: continuation.totalExecutedToolCallCount,
        continueBackendBudgetSegment: true,
      });
    } catch (error) {
      clearContinuingToolBudgetRun(continuation.run?.id);
      recordAgentError(error);
      const message = error instanceof Error ? error.message : String(error);
      markPendingLogsAsError(message);
      appendMessage(createMessage("assistant", message));
    } finally {
      localRunControlRef.current = false;
      clearToolBudgetAction(actionId);
      setBusy(false);
    }
  };

  const continueBudgetPausedActiveRun = async () => {
    if (!activeRun) {
      return;
    }
    const actionId = activeRun.id;
    if (!beginToolBudgetAction(actionId)) {
      return;
    }
    if (!activeRole) {
      clearToolBudgetAction(actionId);
      appendMessage(createMessage("assistant", "Create or restore an Agent role before continuing this run."));
      return;
    }
    const response = activeRun.latestResponse ?? {
      message: "Continuing paused tool requests.",
      pendingCommandPlan: null,
      requestedToolCalls: activeRun.pendingToolCalls,
    };
    const requestedToolCalls = response.requestedToolCalls ?? activeRun.pendingToolCalls;
    if (requestedToolCalls.length === 0) {
      clearToolBudgetAction(actionId);
      appendMessage(createMessage("assistant", "This paused run has no pending tool requests to continue."));
      return;
    }
    setLastWarning(null);
    localRunControlRef.current = true;
    setBusy(true);
    beginContinuingToolBudgetRun(activeRun);
    setActiveRun((current) =>
      current?.id === activeRun.id ? markRunAsContinuing(current) : current,
    );
    appendLog(createLog("agentToolBudget", "success", "Continuing persisted run with a new tool budget segment"));
    try {
      const context = await getAgentContext();
      setContextSnapshot(context);
      await runAgentToolLoop({
        initialPayload: {
          ...response,
          warning: undefined,
          requestedToolCalls,
        },
        initialRun: activeRun,
        messages,
        systemPromptSnapshot: systemPrompt,
        context,
        activeRoleSnapshot: activeRole,
        activeDocumentId: selectedDocumentId,
        dynamicToolResults: [
          createAgentHarnessToolResult("toolBudget", {}, {
            exhausted: false,
            continuedByCreator: true,
            reason: "Creator continued a persisted run after the previous backend tool budget segment was exhausted.",
          }),
        ],
        totalExecutedToolCallCount: 0,
        continueBackendBudgetSegment: true,
      });
    } catch (error) {
      clearContinuingToolBudgetRun(activeRun.id);
      recordAgentError(error);
      const message = error instanceof Error ? error.message : String(error);
      markPendingLogsAsError(message);
      appendMessage(createMessage("assistant", message));
    } finally {
      localRunControlRef.current = false;
      clearToolBudgetAction(actionId);
      setBusy(false);
    }
  };

  const resumeActiveRun = async () => {
    if (!activeRun || busy) {
      return;
    }
    if (isToolBudgetPausedRun(activeRun)) {
      await continueBudgetPausedActiveRun();
      return;
    }
    setLastWarning(null);
    localRunControlRef.current = true;
    setBusy(true);
    appendLog(createLog("agentRun", "pending", `Resuming ${activeRun.id}`));
    try {
      if (activeRun.status === "queued" || activeRun.status === "running") {
        const completedRun = await waitForExistingAgentRunTurn(
          activeRun.id,
          activeRun.modelTurnIndex,
          recordAgentRunUpdate,
        );
        await finishRunResponse(completedRun);
        return;
      }
      if (activeRun.status === "waiting_for_confirmation" || activeRun.status === "completed") {
        await finishRunResponse(activeRun);
        return;
      }
      if (activeRun.status !== "waiting_for_tool") {
        throw new Error(`Agent run cannot be resumed from status ${activeRun.status}.`);
      }
      if (!activeRole) {
        throw new Error("Create or restore an Agent role before resuming this run.");
      }
      const context = await getAgentContext();
      setContextSnapshot(context);
      await runAgentToolLoop({
        initialPayload: activeRun.latestResponse ?? {
          message: "Resuming pending tool requests.",
          pendingCommandPlan: null,
          requestedToolCalls: activeRun.pendingToolCalls,
        },
        initialRun: activeRun,
        messages,
        systemPromptSnapshot: systemPrompt,
        context,
        activeRoleSnapshot: activeRole,
        activeDocumentId: selectedDocumentId,
        dynamicToolResults: [],
      });
    } catch (error) {
      recordAgentError(error);
      const message = error instanceof Error ? error.message : String(error);
      markPendingLogsAsError(message);
      appendMessage(createMessage("assistant", message));
    } finally {
      localRunControlRef.current = false;
      setBusy(false);
    }
  };

  const stopAgentRun = async () => {
    if (!pendingContinuation) {
      return;
    }
    const run = pendingContinuation.run;
    const actionId = run?.id ?? pendingContinuation.id;
    if (!beginToolBudgetAction(actionId)) {
      return;
    }
    setPendingContinuation(null);
    setLastWarning(null);
    clearContinuingToolBudgetRun(run?.id);
    setActiveRun((current) => (run && current?.id === run.id ? null : current));
    appendLog(createLog("agentToolBudget", "success", "Stopped paused Agent run"));
    appendMessage(createMessage("assistant", "Stopped the paused Agent run. No final answer was generated from incomplete evidence."));
    if (run && !run.id.startsWith("agent-run-tauri")) {
      try {
        const cancelledRun = await cancelAgentRun(run.id, { projectId: run.projectId });
        recordAgentRunUpdate(cancelledRun);
        setActiveRun(null);
      } catch (error) {
        appendLog(createLog("agentRun", "error", error instanceof Error ? error.message : String(error)));
      }
    }
    clearToolBudgetAction(actionId);
    setBusy(false);
  };

  const stopActiveRun = async () => {
    if (!activeRun) {
      return;
    }
    cancelCurrentAgentOperation();
    const run = activeRun;
    const actionId = run.id;
    if (!beginToolBudgetAction(actionId)) {
      return;
    }
    setLastWarning(null);
    clearContinuingToolBudgetRun(run.id);
    setActiveRun(null);
    appendLog(createLog("agentRun", "success", "Stopped Agent run"));
    appendMessage(createMessage("assistant", "Stopped the Agent run. No final answer was generated from incomplete evidence."));
    if (!run.id.startsWith("agent-run-tauri")) {
      try {
        const cancelledRun = await cancelAgentRun(run.id, { projectId: run.projectId });
        recordAgentRunUpdate(cancelledRun);
        setActiveRun(null);
      } catch (error) {
        appendLog(createLog("agentRun", "error", error instanceof Error ? error.message : String(error)));
      }
    }
    clearToolBudgetAction(actionId);
    setBusy(false);
  };

  const stopCurrentAgentOperation = async () => {
    if (activeRun && activeRunCanStop) {
      await stopActiveRun();
      return;
    }
    if (!busy) {
      return;
    }
    const operationId = currentAgentOperationRef.current?.id ?? createId("agent-operation");
    if (!beginToolBudgetAction(operationId)) {
      return;
    }
    cancelCurrentAgentOperation();
    localRunControlRef.current = false;
    setLastWarning(null);
    setPendingContinuation(null);
    setBusy(false);
    markPendingLogsAsError("Stopped by creator before a backend Agent run was created.");
    appendLog(createLog("agentRun", "success", "Stopped local Agent operation before backend run was created"));
    appendMessage(createMessage("assistant", "Stopped the Agent before a backend run was created."));
    clearToolBudgetAction(operationId);
  };

  useEffect(() => {
    const projectId = contextSnapshot?.project.id;
    const roleId = activeRole?.id;
    if (!conversationContextLoaded || !projectId || !roleId || busy) {
      return;
    }
    let active = true;
    void listAgentRuns(projectId, { roleId, limit: 5 })
      .then(async (runs) => {
        if (!active || runs.length === 0) {
          return;
        }
        const candidate = runs.find((run) => {
          if (RESTORABLE_RUN_STATUSES.has(run.status)) {
            return true;
          }
          if (suppressCompletedRunRestoreRef.current) {
            return false;
          }
          const responseMessage = run.latestResponse?.message;
          return Boolean(
            run.status === "completed" &&
              responseMessage &&
              !messages.some((message) => message.role === "assistant" && message.content === responseMessage),
          );
        });
        if (!candidate) {
          return;
        }
        setActiveRun(candidate);
        if (
          (candidate.status === "completed" || candidate.status === "waiting_for_confirmation") &&
          candidate.latestResponse
        ) {
          await finishRunResponse(candidate);
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        appendLog(createLog("agentRun", "error", error instanceof Error ? error.message : String(error)));
      });
    return () => {
      active = false;
    };
  }, [activeRole?.id, busy, contextSnapshot?.project.id, conversationContextLoaded, messages]);

  useEffect(() => {
    if (
      !activeRun ||
      busy ||
      localRunControlRef.current ||
      reconnectingRunRef.current === activeRun.id ||
      (activeRun.status !== "queued" && activeRun.status !== "running")
    ) {
      return;
    }
    let active = true;
    reconnectingRunRef.current = activeRun.id;
    setBusy(true);
    appendLog(createLog("agentRun", "pending", `Reconnected to ${activeRun.id}`));
    void waitForExistingAgentRunTurn(activeRun.id, activeRun.modelTurnIndex, recordAgentRunUpdate)
      .then(async (run) => {
        if (!active) {
          return;
        }
        await finishRunResponse(run);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        recordAgentError(error);
        appendLog(createLog("agentRun", "error", error instanceof Error ? error.message : String(error)));
      })
      .finally(() => {
        if (active) {
          setBusy(false);
        }
      });
    return () => {
      active = false;
      if (reconnectingRunRef.current === activeRun.id) {
        reconnectingRunRef.current = null;
      }
    };
  }, [activeRun?.id, activeRun?.modelTurnIndex, activeRun?.status]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || agentSendDisabled) {
      return;
    }
    setInput("");
    setPendingPlan(null);
    setLastWarning(null);
    setPendingContinuation(null);
    suppressCompletedRunRestoreRef.current = false;
    localRunControlRef.current = true;
    const operationId = createId("agent-operation");
    currentAgentOperationRef.current = { id: operationId, cancelled: false };
    const userMessage = createMessage("user", trimmed);
    const nextMessages = [...messages, userMessage];
    setConversationEntries((current) => [...current, createMessageEntry(userMessage)]);
    setBusy(true);
    appendLog(createLog("readContext", "pending"));
    try {
      if (!config?.enabled) {
        throw new Error(config?.reason ?? "Agent backend is not configured.");
      }
      if (!activeRole) {
        throw new Error("Create or restore an Agent role before chatting. Every role must have a metadoc.");
      }
      const context = await getAgentContext();
      if (isAgentOperationCancelled(operationId)) {
        return;
      }
      setContextSnapshot(context);
      appendLog(
        createLog(
          "readContext",
          "success",
          `${context.project.pageCount} pages, ${context.pages.reduce(
            (count, page) => count + page.objects.length,
            0,
          )} objects, viewing ${context.currentPage?.name ?? "no page"}`,
        ),
      );
      appendLog(createLog("readMetadoc", "pending", activeRole.metadocId));
      const activeMetadoc = await readProjectDocument(context.project.id, activeRole.metadocId);
      if (isAgentOperationCancelled(operationId)) {
        return;
      }
      const metadocContentLimit = 12000;
      const metadocResult = createAgentHarnessToolResult("readActiveRoleMetadoc", {
        documentId: activeRole.metadocId,
        roleId: activeRole.id,
      }, {
        role: {
          id: activeRole.id,
          name: activeRole.name,
          title: activeRole.title,
          metadocId: activeRole.metadocId,
        },
        document: {
          id: activeMetadoc.id,
          title: activeMetadoc.title,
          path: activeMetadoc.path,
          status: activeMetadoc.status,
          summary: activeMetadoc.summary ?? "",
          content: activeMetadoc.content.slice(0, metadocContentLimit),
          contentLength: activeMetadoc.content.length,
          truncated: activeMetadoc.content.length > metadocContentLimit,
        },
      });
      appendLog(createLog("readMetadoc", "success", activeMetadoc.path));
      const dynamicToolResults: AgentHarnessToolResult[] = [metadocResult];
      const harness = buildAgentHarness(context, dynamicToolResults);
      appendLog(
        createLog(
          "agentHarness",
          "success",
          `${harness.tools.length} tools, ${harness.initialToolResults.length} initial reads, active metadoc loaded`,
        ),
      );
      appendLog(createLog("agentChat", "pending", "Waiting for model response"));
      const initialRunResult = await sendAgentRunRequest({
        messages: toAgentWireMessages(nextMessages),
        systemPrompt,
        agentContext: context,
        activeRoleId: activeRole.id,
        activeRole,
        activeDocumentId: selectedDocumentId,
        harness,
        canvasSnapshot: context.canvasSnapshot,
      }, "initial-model-response", operationId);
      if (isAgentOperationCancelled(operationId)) {
        if (!initialRunResult.run.id.startsWith("agent-run-tauri")) {
          void cancelAgentRun(initialRunResult.run.id, { projectId: initialRunResult.run.projectId }).catch(() => undefined);
        }
        return;
      }
      await runAgentToolLoop({
        initialPayload: initialRunResult.response,
        initialRun: initialRunResult.run,
        messages: nextMessages,
        systemPromptSnapshot: systemPrompt,
        context,
        activeRoleSnapshot: activeRole,
        activeDocumentId: selectedDocumentId,
        dynamicToolResults,
      });
    } catch (error) {
      if (isAgentOperationCancelled(operationId)) {
        return;
      }
      recordAgentError(error);
      const message = error instanceof Error ? error.message : String(error);
      markPendingLogsAsError(message);
      appendMessage(createMessage("assistant", message));
    } finally {
      if (currentAgentOperationRef.current?.id === operationId) {
        currentAgentOperationRef.current = null;
      }
      localRunControlRef.current = false;
      setBusy(false);
    }
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    if (!agentSendDisabled) {
      event.currentTarget.form?.requestSubmit();
    }
  };

  const pendingContinuationIsContinuing =
    Boolean(pendingContinuation?.run?.id && pendingContinuation.run.id === continuingToolBudgetRunId);
  const activeRunIsContinuingToolBudget = Boolean(activeRun?.id && activeRun.id === continuingToolBudgetRunId);
  const activeRunIsToolBudgetPaused = !activeRunIsContinuingToolBudget && isToolBudgetPausedRun(activeRun);
  const pendingContinuationActionId = pendingContinuation?.run?.id ?? pendingContinuation?.id ?? null;
  const activeRunActionId = activeRun?.id ?? null;
  const localOperationActionId = currentAgentOperationRef.current?.id ?? null;
  const activeStopActionId = activeRunActionId ?? localOperationActionId;
  const activeRunCanStop = Boolean(activeRun && CANCELLABLE_RUN_STATUSES.has(activeRun.status));
  const agentStopAvailable = activeRunCanStop || busy;
  const agentStopActionInProgress = Boolean(activeStopActionId && activeStopActionId === toolBudgetActionRunId);
  const activeRunBlocksSend = Boolean(
    activeRun && CANCELLABLE_RUN_STATUSES.has(activeRun.status) && !activeRunIsContinuingToolBudget,
  );
  const pendingContinuationBlocksInput = Boolean(pendingContinuation && !pendingContinuationIsContinuing);
  const activeRunBlocksInput = Boolean(
    activeRun?.status === "waiting_for_tool" && !activeRunIsContinuingToolBudget,
  );
  const agentPromptDisabled = config?.enabled !== true || !activeRole;
  const agentSendDisabled =
    agentPromptDisabled ||
    busy ||
    pendingContinuationBlocksInput ||
    activeRunBlocksInput ||
    activeRunBlocksSend ||
    input.trim().length === 0;
  const agentPromptPlaceholder =
    pendingContinuationBlocksInput
      ? "Continue or stop the paused Agent run. You can still type a draft here."
      : activeRunBlocksInput
        ? "Resume or stop the paused backend Agent run. You can still type a draft here."
      : activeRunCanStop || busy
        ? "Agent is running. You can type a draft while waiting."
      : config?.enabled
      ? activeRole
        ? "Ask the agent..."
        : "Create an Agent role first."
      : "Configure the Agent backend first.";

  useEffect(() => {
    if (!busy) {
      return;
    }
    if (pendingContinuationBlocksInput || activeRunIsToolBudgetPaused) {
      localRunControlRef.current = false;
      setBusy(false);
    }
  }, [activeRunIsToolBudgetPaused, busy, pendingContinuationBlocksInput]);

  return (
    <aside className="right-sidebar agent-sidebar" aria-label="Agent sidebar">
      <section className="agent-header">
        <div>
          <p className="eyebrow">Agent</p>
          <h3>MangaMaker Agent</h3>
        </div>
      </section>

      <section className="agent-config" aria-label="Agent configuration status">
        <h3>Configuration</h3>
        <p>{configSummary}</p>
        {activeRun ? (
          <div className="agent-run-status-row">
            <p className="agent-run-status">
              Run {activeRun.status.replace(/_/g, " ")} - {activeRun.steps.length} steps
            </p>
          </div>
        ) : null}
        {configError ? <p className="agent-warning">{configError}</p> : null}
        {lastWarning ? <p className="agent-warning">{lastWarning}</p> : null}
      </section>

      <details
        className="agent-manual-config"
        aria-label="Agent manual config"
        open={configPanelOpen}
        onToggle={(event) => setConfigPanelOpen(event.currentTarget.open)}
      >
        <summary>Agent Config</summary>
        <div className="agent-config-editor">
          <label>
            <span>System prompt</span>
            <textarea
              aria-label="Agent system prompt"
              rows={10}
              value={systemPrompt}
              spellCheck={false}
              onChange={(event) => setSystemPrompt(event.currentTarget.value)}
            />
          </label>
          <div className="agent-config-actions">
            <button
              type="button"
              onClick={() => setSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT)}
            >
              Reset prompt
            </button>
          </div>
          <label>
            <span>Context window tokens</span>
            <input
              aria-label="Agent context window tokens"
              type="number"
              min={MIN_AGENT_CONTEXT_WINDOW_TOKENS}
              step={1024}
              value={contextWindowInput}
              onChange={(event) => setContextWindowInput(event.currentTarget.value)}
            />
          </label>
          <p className="agent-muted">
            Effective {formatTokenCount(effectiveContextWindowTokens)} tokens; backend default{" "}
            {formatTokenCount(config?.contextWindowTokens)} tokens, model max{" "}
            {formatTokenCount(config?.contextWindowMaxTokens)}.
          </p>
          <div className="agent-context-editor" aria-label="Agent conversation context editor">
            <div className="agent-context-editor-header">
              <h3>Conversation Context</h3>
              <div>
                <button type="button" disabled={!conversationContextLoaded} onClick={() => addContextMessage("user")}>
                  Add user
                </button>
                <button type="button" disabled={!conversationContextLoaded} onClick={() => addContextMessage("assistant")}>
                  Add agent
                </button>
                <button type="button" disabled={!conversationContextLoaded} onClick={clearConversationContext}>
                  Clear context
                </button>
              </div>
            </div>
            {messages.length === 0 ? (
              <p className="hint">No context messages. Add a user or agent message before sending.</p>
            ) : (
              messages.map((message, index) => (
                <div className="agent-context-message-editor" key={message.id}>
                  <div className="agent-context-message-toolbar">
                    <span>#{index + 1}</span>
                    <select
                      aria-label={`Context message ${index + 1} role`}
                      value={message.role}
                      disabled={!conversationContextLoaded}
                      onChange={(event) =>
                        updateMessage(message.id, {
                          role: event.currentTarget.value as AgentChatMessage["role"],
                        })
                      }
                    >
                      <option value="user">User</option>
                      <option value="assistant">Agent</option>
                    </select>
                    <button type="button" disabled={!conversationContextLoaded} onClick={() => deleteMessage(message.id)}>
                      Delete
                    </button>
                  </div>
                  <textarea
                    aria-label={`Context message ${index + 1} content`}
                    rows={3}
                    value={message.content}
                    disabled={!conversationContextLoaded}
                    onChange={(event) =>
                      updateMessage(message.id, {
                        content: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </details>

      <section className="agent-role" aria-label="Agent role">
        <h3>Role</h3>
        <label>
          <span>Active role</span>
          <select
            value={activeRoleId}
            onChange={(event) => {
              setConversationContextLoaded(false);
              setActiveRoleId(event.currentTarget.value as AgentRoleId);
            }}
            disabled={busy || availableRoles.length === 0}
          >
            {availableRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        {activeRole ? (
          <>
            <p>{activeRole.title}</p>
            <p>
              Metadoc: {activeRoleMetadoc?.path ?? activeRole.metadocId}
            </p>
          </>
        ) : (
          <p>No Agent role is active. Create a role with a metadoc before chatting.</p>
        )}
        <p>Active document: {selectedDocumentId ?? "none"}</p>
        {roleError ? <p className="agent-warning">{roleError}</p> : null}
        <div className="agent-role-actions">
          <button type="button" disabled={busy || roleSaving} onClick={() => openRoleDialog()}>
            New role
          </button>
          <button
            type="button"
            disabled={
              busy ||
              roleSaving ||
              !selectedDocumentId ||
              metadocRoleIds.has(selectedDocumentId)
            }
            onClick={() => selectedDocumentId ? openRoleDialog(selectedDocumentId) : undefined}
          >
            Role from active doc
          </button>
          <button
            type="button"
            disabled={busy || roleSaving || !activeRole}
            onClick={() => activeRole ? void deleteRole(activeRole) : undefined}
          >
            Delete role
          </button>
          <button
            type="button"
            disabled={!activeRoleMetadoc}
            onClick={() => activeRoleMetadoc ? onSelectDocument?.(activeRoleMetadoc.id) : undefined}
          >
            Open metadoc
          </button>
        </div>
      </section>

      {roleDialogOpen ? (
        <div className="document-dialog-backdrop">
          <form
            className="document-dialog"
            role="dialog"
            aria-label="New Agent role"
            onSubmit={(event) => void createRole(event)}
          >
            <h3>New Agent role</h3>
            <label>
              <span>Name</span>
              <input
                aria-label="New role name"
                value={newRole.name}
                autoFocus
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setNewRole((current) => ({ ...current, name }));
                }}
              />
            </label>
            <label>
              <span>Title</span>
              <input
                aria-label="New role title"
                value={newRole.title}
                onChange={(event) => {
                  const title = event.currentTarget.value;
                  setNewRole((current) => ({ ...current, title }));
                }}
              />
            </label>
            <label>
              <span>Metadoc</span>
              <select
                aria-label="New role metadoc mode"
                value={newRole.metadocMode}
                onChange={(event) => {
                  const metadocMode = event.currentTarget.value as "new" | "existing";
                  setNewRole((current) => ({
                    ...current,
                    metadocMode,
                    metadocId: metadocMode === "existing" ? current.metadocId || ordinaryDocuments[0]?.id || "" : "",
                  }));
                }}
              >
                <option value="new">Create new metadoc</option>
                <option value="existing" disabled={ordinaryDocuments.length === 0}>
                  Use ordinary doc
                </option>
              </select>
            </label>
            {newRole.metadocMode === "existing" ? (
              <label>
                <span>Document</span>
                <select
                  aria-label="Existing metadoc document"
                  value={newRole.metadocId}
                  onChange={(event) => {
                    const metadocId = event.currentTarget.value;
                    setNewRole((current) => ({ ...current, metadocId }));
                  }}
                >
                  {ordinaryDocuments.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title} / {document.path}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="agent-muted">
                Metadoc will be created as {createAgentRoleMetadocPath(newRole.name || "role")}.
              </p>
            )}
            <label>
              <span>Role prompt</span>
              <textarea
                aria-label="New role prompt"
                rows={4}
                value={newRole.prompt}
                onChange={(event) => {
                  const prompt = event.currentTarget.value;
                  setNewRole((current) => ({ ...current, prompt }));
                }}
              />
            </label>
            {roleError ? <p className="document-error">{roleError}</p> : null}
            <div className="document-dialog-actions">
              <button type="button" disabled={roleSaving} onClick={() => setRoleDialogOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={roleSaving || newRole.name.trim().length === 0}
              >
                {roleSaving ? "Creating..." : "Create role"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pendingContinuation && !pendingContinuationIsContinuing ? (
        <section className="agent-continuation" aria-label="Paused Agent run">
          <div>
            <h3>Tool Budget Reached</h3>
            <p>{pendingContinuation.pauseReason}</p>
            <p>
              Executed tool calls: {pendingContinuation.totalExecutedToolCallCount}. Pending tool requests:{" "}
              {pendingContinuation.requestedToolCalls.length}.
            </p>
          </div>
          <div className="agent-plan-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => void continueAgentRun()}
              disabled={pendingContinuationActionId === toolBudgetActionRunId}
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => void stopAgentRun()}
              disabled={pendingContinuationActionId === toolBudgetActionRunId}
            >
              Stop
            </button>
          </div>
        </section>
      ) : null}

      {!pendingContinuation && activeRunIsToolBudgetPaused ? (
        <section className="agent-continuation" aria-label="Paused Agent run">
          <div>
            <h3>Tool Budget Reached</h3>
            <p>
              {activeRun?.latestResponse?.warning ??
                "Agent reached the backend tool budget and paused instead of answering from incomplete evidence."}
            </p>
            <p>Pending tool requests: {activeRun?.pendingToolCalls.length ?? 0}.</p>
          </div>
          <div className="agent-plan-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => void continueBudgetPausedActiveRun()}
              disabled={activeRunActionId === toolBudgetActionRunId}
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => void stopActiveRun()}
              disabled={activeRunActionId === toolBudgetActionRunId}
            >
              Stop
            </button>
          </div>
        </section>
      ) : null}

      {!pendingContinuation && activeRun && activeRun.status === "waiting_for_tool" && !activeRunIsToolBudgetPaused ? (
        <section className="agent-continuation" aria-label="Resumable Agent run">
          <div>
            <h3>Agent Run Paused</h3>
            <p>This run is persisted on the backend and is waiting for {activeRun.pendingToolCalls.length} browser tool call(s).</p>
          </div>
          <div className="agent-plan-actions">
            <button type="button" className="primary-button" onClick={() => void resumeActiveRun()} disabled={busy}>
              Resume Run
            </button>
            <button
              type="button"
              onClick={() => void stopActiveRun()}
              disabled={activeRunActionId === toolBudgetActionRunId}
            >
              Stop
            </button>
          </div>
        </section>
      ) : null}

      <AgentMessageList entries={conversationEntries} />

      <AgentCommandPlanView
        plan={pendingPlan}
        busy={busy}
        onConfirm={() => {
          if (pendingPlan) {
            void runPlan(pendingPlan, true, pendingPlanRun);
          }
        }}
        onCancel={() => {
          setPendingPlan(null);
          setPendingPlanRun(null);
          appendLog(createLog("commandPlan", "success", "Cancelled"));
        }}
      />

      <div className="agent-composer">
        {agentStopAvailable ? (
          <section className="agent-run-control" aria-label="Active Agent run control">
            <div>
              <strong>{activeRunCanStop ? "Agent is running" : "Agent is starting"}</strong>
              <span>
                {activeRun
                  ? `Run ${activeRun.status.replace(/_/g, " ")} - ${activeRun.steps.length} steps`
                  : "Waiting for run id"}
              </span>
            </div>
            <button
              type="button"
              className="danger-btn agent-stop-button"
              onClick={() => void stopCurrentAgentOperation()}
              disabled={!agentStopAvailable || agentStopActionInProgress}
            >
              Stop Agent
            </button>
          </section>
        ) : null}
        <form className="agent-input-row" onSubmit={sendMessage}>
          <textarea
            aria-label="Agent prompt"
            value={input}
            rows={3}
            placeholder={agentPromptPlaceholder}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={handlePromptKeyDown}
            disabled={agentPromptDisabled}
          />
          <button
            type="submit"
            className="primary-button"
            disabled={agentSendDisabled}
          >
            Send
          </button>
        </form>
      </div>
    </aside>
  );
};
