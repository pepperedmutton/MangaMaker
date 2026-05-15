import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAgentRun,
  createAgentRequestTraceMetadata,
  AgentRunError,
  getAgentConfig,
  getAgentModels,
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
import {
  createAgentConversationFingerprint,
  isAgentHarnessDiagnosticContent,
  isAgentMutationCompletionClaim,
  sanitizeAgentConversationMessages,
} from "../agent/conversationSanitizer";
import { getAgentContext } from "../agent/context";
import { createAgentDebugSnapshot, setLatestAgentDebugSnapshot } from "../agent/debug";
import { createProjectRole, deleteProjectRole, readProjectDocument } from "../agent/documents";
import { AGENT_PRIME_DIRECTIVE_DOCUMENT_ID } from "../agent/documentSchema";
import { buildAgentHarness, createAgentHarnessToolResult, executeAgentHarnessToolCall } from "../agent/harness";
import {
  createAgentToolCallKey,
  createCachedAgentToolResult,
  createDuplicateToolCallSkippedResult,
  findReusableAgentToolResult,
} from "../agent/toolCallPolicy";
import {
  DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS,
  MIN_AGENT_CONTEXT_WINDOW_TOKENS,
  parseAgentContextWindowTokens,
} from "../agent/contextWindow";
import { AGENT_MODEL_PRESETS } from "../agent/modelCatalog";
import {
  createAgentRoleMetadocPath,
  type AgentDocument,
  type AgentDocumentManifest,
} from "../agent/documentSchema";
import { isAgentDocumentMutationToolName } from "../agent/documentEditTools";
import {
  AGENT_ROLES,
  DEFAULT_AGENT_ROLE_ID,
  createAgentRoleId,
  createAgentRoleWorkingDirectory,
  getAgentRole,
  getAgentRoleWorkingDirectory,
  type AgentRoleDefinition,
  type AgentRoleId,
} from "../agent/roles";
import { DEFAULT_AGENT_SYSTEM_PROMPT, migrateAgentSystemPrompt } from "../agent/systemPrompt";
import { executeCommandPlan } from "../agent/tools";
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
  AgentTaskProgress,
  AgentToolCallRequest,
  AgentToolLogEntry,
  AgentAvailableModel,
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

const stringifyAgentDebugValue = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const createModelDebugLogsFromStep = (step: AgentRunStep): AgentToolLogEntry[] => {
  if ((step.kind !== "model_request" && step.kind !== "model_resume") || step.status !== "success") {
    return [];
  }
  const output = isRecord(step.output) ? step.output : null;
  if (!output) {
    return [];
  }
  const logs: AgentToolLogEntry[] = [];
  const modelDebug = isRecord(output.modelDebug) ? output.modelDebug : null;
  const rawAssistantContent = typeof modelDebug?.rawAssistantContent === "string"
    ? modelDebug.rawAssistantContent
    : null;
  const parsedResponse = modelDebug && "parsedResponse" in modelDebug
    ? modelDebug.parsedResponse
    : null;
  const requestedToolCallsDetail = output.requestedToolCallsDetail;
  if (rawAssistantContent || parsedResponse) {
    logs.push(createLog(
      "modelResponse",
      "success",
      rawAssistantContent ?? stringifyAgentDebugValue(parsedResponse),
    ));
  } else if (typeof output.message === "string" && output.message) {
    logs.push(createLog("modelResponse", "success", output.message));
  }
  if (Array.isArray(requestedToolCallsDetail) && requestedToolCallsDetail.length > 0) {
    logs.push(createLog("modelRequestedTools", "success", stringifyAgentDebugValue(requestedToolCallsDetail)));
  }
  return logs;
};

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

const createErrorLogsFromStep = (step: AgentRunStep): AgentToolLogEntry[] => {
  if (step.status !== "error") {
    return [];
  }
  return [createLog(step.kind === "error" ? "agentRun" : step.kind, "error", step.error ?? step.summary)];
};

const createHarnessStatusLogsFromStep = (step: AgentRunStep): AgentToolLogEntry[] => {
  if (step.status !== "success" || step.kind !== "tool_call") {
    return [];
  }
  if (!step.summary.toLowerCase().includes("suppressed")) {
    return [];
  }
  return [createLog("agentHarness", "success", step.summary)];
};

const stepIncludesBackendDocumentWrite = (step: AgentRunStep) => {
  if (step.kind !== "tool_result" || step.status !== "success") {
    return false;
  }
  const resultSummaries = Array.isArray(step.output) ? step.output : step.input;
  return Array.isArray(resultSummaries) && resultSummaries.some((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    return typeof entry.toolName === "string" && isAgentDocumentMutationToolName(entry.toolName);
  });
};

const stepIncludesCommandMutationResult = (step: AgentRunStep) =>
  step.kind === "command_result" && (step.status === "success" || step.status === "no_change");

const runHasVerifiedMutation = (run: AgentRun | null | undefined) =>
  Boolean(run?.steps.some((step) => stepIncludesBackendDocumentWrite(step) || stepIncludesCommandMutationResult(step)));

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
  return null;
};

const getActiveRunStepSummary = (run: AgentRun | null) => {
  const step = [...(run?.steps ?? [])].reverse().find((entry) =>
    entry.status === "running" || entry.status === "waiting",
  );
  return step ? `${step.kind.replace(/_/g, " ")}: ${step.summary}` : null;
};

const AgentTaskProgressView = ({
  progress,
  run,
}: {
  progress: AgentTaskProgress | null | undefined;
  run: AgentRun | null;
}) => {
  const activeStepSummary = getActiveRunStepSummary(run);
  if (!progress && !activeStepSummary) {
    return null;
  }
  const percent = typeof progress?.percent === "number"
    ? Math.max(0, Math.min(100, progress.percent))
    : null;
  return (
    <section className="agent-task-progress" aria-label="Agent task progress">
      <div className="agent-task-progress-header">
        <div>
          <h3>Task Progress</h3>
          <p>{progress?.objective ?? "Waiting for Agent task plan."}</p>
        </div>
        <span>{progress?.status?.replace(/_/g, " ") ?? run?.status.replace(/_/g, " ") ?? "pending"}</span>
      </div>
      {percent !== null ? (
        <div className="agent-task-progress-bar" aria-label="Agent progress percent">
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <div className="agent-task-progress-meta">
        {progress?.phase ? <span>Phase: {progress.phase.replace(/_/g, " ")}</span> : null}
        {progress?.nextAction ? <span>Next: {progress.nextAction}</span> : null}
        {activeStepSummary ? <span>Backend: {activeStepSummary}</span> : null}
      </div>
      {progress?.steps?.length ? (
        <ol>
          {progress.steps.map((step) => (
            <li key={step.id} className={`agent-task-step-${step.status}`}>
              <span>{step.title}</span>
              <small>{step.status.replace(/_/g, " ")}</small>
            </li>
          ))}
        </ol>
      ) : null}
      {progress?.stopCondition ? <p className="agent-muted">Stop: {progress.stopCondition}</p> : null}
      {progress?.stopReason ? <p className="agent-muted">Stopped: {progress.stopReason}</p> : null}
    </section>
  );
};

const MAX_AGENT_TOOL_ROUNDS = 24;
const MAX_AGENT_TOOL_CALLS = 72;
const MAX_AGENT_TOOL_CALLS_PER_ROUND = 24;
const MAX_DUPLICATE_TOOL_GUIDED_RETRIES = 4;
const MAX_FINAL_ANSWER_ONLY_REPAIRS = 1;
const DEFAULT_AGENT_GREETING = "Ready. I can inspect the current project, offer suggestions, and update project documents.";
const AGENT_PAGE_COMMAND_PLAN_DISABLED_MESSAGE =
  "Built-in Agent page/canvas edits are disabled. I can inspect pages and renders, then record proposed changes with Markdown document tools.";
const AGENT_COMMAND_PLAN_NO_CHANGE_MESSAGE = "The plan executed, but the project state did not change.";
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

const isAgentHarnessDiagnosticMessage = isAgentHarnessDiagnosticContent;

const toAgentWireMessages = (
  messages: AgentChatMessage[],
  internalNotice?: string,
): Array<{ role: "user" | "assistant"; content: string }> => [
  ...sanitizeAgentConversationMessages(messages).map(({ role, content }) => ({ role, content })),
  ...(internalNotice ? [{ role: "user" as const, content: internalNotice }] : []),
];

type AgentContinuationState = {
  id: string;
  run: AgentRun | null;
  messages: AgentChatMessage[];
  conversationContextId: string | null;
  conversationContextFingerprint: string;
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

const toolReuseOptionsForContext = (context: AgentContextSnapshot) => ({
  projectUpdatedAt: context.project.updatedAt,
  currentPageId: context.currentPage?.id ?? context.selectedPageId,
});

const harnessOptionsForConfig = (
  config: AgentConfig | null,
  activeRole: AgentRoleDefinition,
  primeDirective?: AgentDocument | null,
  modelCapabilityOverride?: AgentConfig["modelCapability"],
) => ({
  modelCapability: modelCapabilityOverride ?? config?.modelCapability ?? "multimodal" as const,
  activeMetadocId: activeRole.metadocId,
  activeRoleWorkingDirectory: getAgentRoleWorkingDirectory(activeRole),
  ...(primeDirective ? { primeDirective } : {}),
});

const runMatchesConversationContext = (
  run: AgentRun | null | undefined,
  contextId: string | null,
  fingerprint: string,
) =>
  Boolean(
    run &&
    contextId &&
    run.conversationContextId === contextId &&
    run.conversationContextFingerprint === fingerprint,
  );

const isDuplicateToolCallSkippedResult = (result: AgentHarnessToolResult) =>
  result.toolName === "toolCallSkipped" && readRecord(result.result).duplicate === true;

const isCachedToolResult = (result: AgentHarnessToolResult) =>
  readRecord(result.result).cacheHit === true;

const createDuplicateToolGuidanceNotice = (toolResults: AgentHarnessToolResult[]) => {
  const skippedTools = toolResults
    .filter(isDuplicateToolCallSkippedResult)
    .map((entry) => readRecord(entry.input).toolName)
    .filter((toolName): toolName is string => typeof toolName === "string" && toolName.length > 0);
  const cachedTools = toolResults
    .filter(isCachedToolResult)
    .map((entry) => entry.toolName)
    .filter((toolName) => toolName.length > 0);
  const uniqueTools = Array.from(new Set([...skippedTools, ...cachedTools]));
  return [
    "MangaMaker internal harness notice: your previous requested tool calls were exact duplicates of results already supplied in this run.",
    uniqueTools.length > 0 ? `Duplicate tools satisfied from cache: ${uniqueTools.join(", ")}.` : "Duplicate tool calls were satisfied from cache.",
    "Use the existing dynamicToolResults and completedToolCallIndex. Do not request the same toolName/input again.",
    "Complete the creator's task now by returning a final answer or a document write. pendingCommandPlan must be null, and requestedToolCalls should be empty unless a genuinely different missing tool is required.",
  ].join("\n");
};

const createFinalAnswerOnlyNotice = (toolResults: AgentHarnessToolResult[]) => [
  createDuplicateToolGuidanceNotice(toolResults),
  "Final-answer-only mode is now active.",
  "Return JSON with requestedToolCalls: []. Do not request read, render, search, or document tools again.",
  "Answer from the cached tool results already supplied. If the available evidence is insufficient, state the limitation directly and identify the smallest manual next step for the creator.",
].join("\n");

const createFinalAnswerOnlyRepairNotice = (payload: AgentChatResponse) => {
  const toolNames = Array.from(new Set((payload.requestedToolCalls ?? []).map((call) => call.toolName))).join(", ");
  return [
    "MangaMaker rejected your previous response because it still requested tools in final-answer-only mode.",
    toolNames ? `Rejected requestedToolCalls: ${toolNames}.` : "Rejected requestedToolCalls were present.",
    "Do not say you need to inspect/read/render anything. The cached tool results are already available in Agent harness JSON.",
    "Return a concrete final answer now with requestedToolCalls: []. If the cached evidence is insufficient, state the limitation directly and stop.",
  ].join("\n");
};

const coerceFinalAnswerOnlyPayload = (payload: AgentChatResponse): AgentChatResponse => {
  if (!payload.requestedToolCalls?.length) {
    return payload;
  }
  const toolNames = Array.from(new Set(payload.requestedToolCalls.map((call) => call.toolName))).join(", ");
  const rawMessage = payload.message.trim();
  const looksLikeToolPrelude =
    /need to|inspect|read|render|tool|查看|读取|渲染|需要先|让我/.test(rawMessage.toLowerCase());
  const baseMessage = rawMessage.length > 0 && !looksLikeToolPrelude
    ? payload.message.trim()
    : "The model still tried to request tools instead of producing a final answer. MangaMaker stopped tool execution and kept the run from looping.";
  return {
    ...payload,
    message: [
      baseMessage,
      `MangaMaker suppressed additional tool requests (${toolNames}) because this run is in final-answer-only mode after repeated duplicate tool calls. This answer is based only on the cached results already supplied.`,
    ].join("\n\n"),
    requestedToolCalls: [],
    warning: undefined,
  };
};

const describeToolCallForLog = (call: { toolName: string; input: unknown }) => {
  const input = readRecord(call.input);
  if (isAgentDocumentMutationToolName(call.toolName)) {
    const content = typeof input.content === "string"
      ? input.content
      : typeof input.newText === "string"
        ? input.newText
        : "";
    return `documentId=${String(input.documentId ?? input.id ?? "unknown")}; title=${String(input.title ?? "untitled")}; contentLength=${content.length}`;
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
  currentTaskPin: string;
  contextWindowTokens: number | null;
  repetitionPenalty: number | null;
  modelId: string | null;
};

const parseRepetitionPenaltyInput = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(2, Math.max(1, parsed));
};

const loadRuntimeConfig = (projectId: string): AgentRuntimeConfig => {
  try {
    const raw = window.localStorage.getItem(runtimeConfigKeyForProject(projectId));
    if (!raw) {
      return {
        systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
        currentTaskPin: "",
        contextWindowTokens: null,
        repetitionPenalty: null,
        modelId: null,
      };
    }
    const parsed = JSON.parse(raw) as {
      systemPrompt?: unknown;
      currentTaskPin?: unknown;
      contextWindowTokens?: unknown;
      repetitionPenalty?: unknown;
      modelId?: unknown;
    };
    return {
      systemPrompt:
        typeof parsed.systemPrompt === "string" && parsed.systemPrompt.trim().length > 0
          ? migrateAgentSystemPrompt(parsed.systemPrompt)
          : DEFAULT_AGENT_SYSTEM_PROMPT,
      currentTaskPin: typeof parsed.currentTaskPin === "string" ? parsed.currentTaskPin : "",
      contextWindowTokens: parseAgentContextWindowTokens(parsed.contextWindowTokens),
      repetitionPenalty: parseRepetitionPenaltyInput(parsed.repetitionPenalty),
      modelId:
        typeof parsed.modelId === "string" && parsed.modelId.trim().length > 0
          ? parsed.modelId.trim()
          : null,
    };
  } catch {
    return {
      systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      currentTaskPin: "",
      contextWindowTokens: null,
      repetitionPenalty: null,
      modelId: null,
    };
  }
};

const saveRuntimeConfig = (
  projectId: string,
  config: {
    systemPrompt: string;
    currentTaskPin: string;
    contextWindowTokens: number | null;
    repetitionPenalty: number | null;
    modelId: string | null;
  },
) => {
  try {
    window.localStorage.setItem(
      runtimeConfigKeyForProject(projectId),
      JSON.stringify({
        systemPrompt: config.systemPrompt,
        currentTaskPin: config.currentTaskPin,
        contextWindowTokens: config.contextWindowTokens,
        repetitionPenalty: config.repetitionPenalty,
        modelId: config.modelId,
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

const formatAgentModelOption = (model: AgentAvailableModel) => {
  const mode = model.capability === "metadoc" ? "text-only" : "multimodal";
  return `${model.name} (${model.id}, ${mode}, ${formatTokenCount(model.contextLength)} ctx)`;
};

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
  const [availableModels, setAvailableModels] = useState<AgentAvailableModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const [conversationContextScope, setConversationContextScope] = useState<ConversationContextScope | null>(null);
  const [conversationContextId, setConversationContextId] = useState<string | null>(null);
  const [conversationContextUpdatedAt, setConversationContextUpdatedAt] = useState<string | null>(null);
  const [conversationContextLoaded, setConversationContextLoaded] = useState(false);
  const [activeRoleId, setActiveRoleId] = useState<AgentRoleId>(DEFAULT_AGENT_ROLE_ID);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_AGENT_SYSTEM_PROMPT);
  const [currentTaskPin, setCurrentTaskPin] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [contextWindowInput, setContextWindowInput] = useState(String(DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS));
  const [repetitionPenaltyInput, setRepetitionPenaltyInput] = useState("1.05");
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
  const handledDocumentWriteStepIdsRef = useRef(new Set<string>());
  const localRunControlRef = useRef(false);
  const reconnectingRunRef = useRef<string | null>(null);
  const suppressCompletedRunRestoreRef = useRef(false);
  const continuingToolBudgetRunRef = useRef<{ runId: string; previousModelTurnIndex: number } | null>(null);
  const toolBudgetActionRunIdRef = useRef<string | null>(null);
  const currentAgentOperationRef = useRef<AgentLocalOperation | null>(null);
  const cancelledOperationRunIdsRef = useRef(new Set<string>());
  const conversationContextTouchedRef = useRef(false);
  const conversationContextIdRef = useRef<string | null>(null);
  const conversationFingerprintRef = useRef("");
  const [newRole, setNewRole] = useState({
    name: "",
    metadocMode: "new" as "new" | "existing",
    metadocId: "",
    workingDirectory: createAgentRoleWorkingDirectory("role"),
    workingDirectoryTouched: false,
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
  const conversationFingerprint = useMemo(
    () => createAgentConversationFingerprint(messages),
    [messages],
  );
  useEffect(() => {
    conversationContextIdRef.current = conversationContextId;
    conversationFingerprintRef.current = conversationFingerprint;
  }, [conversationContextId, conversationFingerprint]);
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
    if (
      activeRun?.id !== run.id &&
      !runMatchesConversationContext(run, conversationContextIdRef.current, conversationFingerprintRef.current)
    ) {
      return;
    }
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
      if (
        !handledDocumentWriteStepIdsRef.current.has(step.id) &&
        stepIncludesBackendDocumentWrite(step)
      ) {
        handledDocumentWriteStepIdsRef.current.add(step.id);
        onDocumentsChanged?.();
      }
      if (handledRunStepLogIdsRef.current.has(step.id)) {
        continue;
      }
      const stepLogs = [
        ...createModelDebugLogsFromStep(step),
        ...createBackendToolLogsFromStep(step),
        ...createHarnessStatusLogsFromStep(step),
        ...createErrorLogsFromStep(step),
      ];
      if (stepLogs.length === 0) {
        continue;
      }
      handledRunStepLogIdsRef.current.add(step.id);
      for (const log of stepLogs) {
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
    const requestMessages = request.messages.map(({ role, content }) => ({ role, content }));
    const result = await startAgentRunTurn({
      ...request,
      messages: requestMessages,
      ...(request.conversationContextId
        ? { conversationContextId: request.conversationContextId }
        : conversationContextId
          ? { conversationContextId }
          : {}),
      conversationContextFingerprint:
        request.conversationContextFingerprint ?? createAgentConversationFingerprint(requestMessages),
      ...(request.conversationContextUpdatedAt
        ? { conversationContextUpdatedAt: request.conversationContextUpdatedAt }
        : conversationContextUpdatedAt
          ? { conversationContextUpdatedAt }
          : {}),
      contextWindowTokens: effectiveContextWindowTokens,
      repetitionPenalty: effectiveRepetitionPenalty,
      ...(effectiveModelId ? { modelOverride: effectiveModelId } : {}),
      ...(currentTaskPin.trim() ? { currentTaskPin: currentTaskPin.trim() } : {}),
      requestTrace: createAgentRequestTraceMetadata(stage),
    }, (run, event) => {
      if (operationId && isAgentOperationCancelled(operationId)) {
        const cancelKey = `${operationId}:${run.id}`;
        if (
          !cancelledOperationRunIdsRef.current.has(cancelKey) &&
          !run.id.startsWith("agent-run-tauri") &&
          CANCELLABLE_RUN_STATUSES.has(run.status)
        ) {
          cancelledOperationRunIdsRef.current.add(cancelKey);
          void cancelAgentRun(run.id, { projectId: run.projectId })
            .then((cancelledRun) => {
              recordAgentRunUpdate(cancelledRun);
              setActiveRun(null);
            })
            .catch((error) => {
              appendLog(createLog("agentRun", "error", error instanceof Error ? error.message : String(error)));
            });
        }
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
    void Promise.allSettled([getAgentConfig(), getAgentContext(), getAgentModels()]).then(async ([
      configResult,
      contextResult,
      modelsResult,
    ]) => {
      if (!active) {
        return;
      }
      let backendModelId: string | null = null;
      if (configResult.status === "fulfilled") {
        setConfig(configResult.value);
        backendModelId = configResult.value.model;
      } else {
        const message =
          configResult.reason instanceof Error ? configResult.reason.message : String(configResult.reason);
        setConfig({
          enabled: false,
          provider: "unavailable",
          model: null,
          modelCapability: null,
          apiKeyConfigured: false,
          testMode: false,
          visionEnabled: false,
          contextWindowTokens: DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS,
          contextWindowMaxTokens: null,
          contextWindowSource: "default",
          repetitionPenalty: 1.05,
          reason: message,
        });
        setConfigError(message);
      }
      if (modelsResult.status === "fulfilled") {
        setAvailableModels(modelsResult.value);
        setModelsError(null);
      } else {
        const message =
          modelsResult.reason instanceof Error ? modelsResult.reason.message : String(modelsResult.reason);
        setModelsError(message);
      }
      if (contextResult.status === "fulfilled") {
        setContextSnapshot(contextResult.value);
        const projectId = contextResult.value.project.id;
        const runtimeConfig = loadRuntimeConfig(projectId);
        const backendContextWindow =
          configResult.status === "fulfilled"
            ? configResult.value.contextWindowTokens
            : DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS;
        const backendRepetitionPenalty =
          configResult.status === "fulfilled" ? configResult.value.repetitionPenalty : 1.05;
        setSystemPrompt(runtimeConfig.systemPrompt);
        setCurrentTaskPin(runtimeConfig.currentTaskPin);
        const defaultModelId =
          configResult.status === "fulfilled" && configResult.value.testMode
            ? ""
            : backendModelId ?? "";
        setSelectedModelId(runtimeConfig.modelId ?? defaultModelId);
        setContextWindowInput(String(runtimeConfig.contextWindowTokens ?? backendContextWindow));
        setRepetitionPenaltyInput(String(runtimeConfig.repetitionPenalty ?? backendRepetitionPenalty));
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
      currentTaskPin,
      contextWindowTokens: parseAgentContextWindowTokens(contextWindowInput),
      repetitionPenalty: parseRepetitionPenaltyInput(repetitionPenaltyInput),
      modelId: selectedModelId.trim() || null,
    });
  }, [
    contextWindowInput,
    conversationContextLoaded,
    conversationContextScope,
    currentTaskPin,
    repetitionPenaltyInput,
    selectedModelId,
    systemPrompt,
  ]);

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
  const effectiveRepetitionPenalty =
    parseRepetitionPenaltyInput(repetitionPenaltyInput) ??
    config?.repetitionPenalty ??
    1.05;
  const backendConfiguredModel = config?.model ?? "";
  const effectiveModelId = selectedModelId.trim() || backendConfiguredModel;
  const selectedAvailableModel = useMemo(
    () => availableModels.find((model) => model.id === effectiveModelId) ?? null,
    [availableModels, effectiveModelId],
  );
  const effectiveModelCapability =
    config?.testMode
      ? config.modelCapability
      : selectedAvailableModel?.capability ?? config?.modelCapability ?? null;
  const effectiveModelContextMax = selectedAvailableModel?.contextLength ?? config?.contextWindowMaxTokens ?? null;
  const agentBackendUsable =
    config?.testMode === true
      ? config.enabled
      : Boolean(config?.apiKeyConfigured && effectiveModelId && (selectedAvailableModel || availableModels.length === 0));

  const configSummary = useMemo(() => {
    if (!config) {
      return "Checking Agent configuration...";
    }
    const contextLabel = `context ${formatTokenCount(effectiveContextWindowTokens)} tokens`;
    const repetitionLabel = `repetition penalty ${effectiveRepetitionPenalty.toFixed(2)}`;
    const capabilityLabel = effectiveModelCapability === "metadoc"
      ? "text-only document model"
      : effectiveModelCapability === "multimodal"
        ? "multimodal model"
        : "model capability unavailable";
    const modeLabel = config.testMode
      ? "Test mode"
      : `OpenRouter - ${effectiveModelId || "model not set"}`;
    if (config.testMode) {
      return `${modeLabel} - ${capabilityLabel} - ${config.visionEnabled ? "vision enabled" : "vision unavailable"} - ${contextLabel} - ${repetitionLabel}`;
    }
    if (!agentBackendUsable) {
      if (effectiveModelId && availableModels.length > 0 && !selectedAvailableModel) {
        return `Selected model is not available for MangaMaker Agent: ${effectiveModelId}`;
      }
      return config.reason ?? "Agent backend is not configured.";
    }
    return `${modeLabel} - ${capabilityLabel} - ${
      effectiveModelCapability === "multimodal" ? "vision enabled" : "vision unavailable"
    } - ${contextLabel} - ${repetitionLabel}`;
  }, [
    agentBackendUsable,
    config,
    availableModels.length,
    effectiveContextWindowTokens,
    effectiveModelCapability,
    effectiveModelId,
    effectiveRepetitionPenalty,
    selectedAvailableModel,
  ]);
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
      setConversationContextId(null);
      setConversationContextUpdatedAt(null);
      return;
    }

    let active = true;
    suppressCompletedRunRestoreRef.current = false;
    conversationContextTouchedRef.current = false;
    const provisionalContextId = createId("conversation-context");
    const provisionalUpdatedAt = new Date().toISOString();
    conversationContextIdRef.current = provisionalContextId;
    conversationFingerprintRef.current = createAgentConversationFingerprint(createDefaultAgentMessages());
    setConversationContextLoaded(false);
    setConversationEntries(createDefaultConversationEntries());
    setConversationContextScope({ projectId, roleId });
    setConversationContextId(provisionalContextId);
    setConversationContextUpdatedAt(provisionalUpdatedAt);
    setConversationContextLoaded(true);
    setPendingPlan(null);
    setLastWarning(null);
    setPendingContinuation(null);
    void loadAgentConversationContext(projectId, roleId).then((storedContext) => {
      if (!active || conversationContextTouchedRef.current) {
        return;
      }
      setConversationEntries(
        (storedContext && storedContext.messages.length > 0
          ? sanitizeAgentConversationMessages(storedContext.messages)
          : createDefaultAgentMessages()
        ).map(createMessageEntry),
      );
      setConversationContextScope({ projectId, roleId });
      const loadedContextId = storedContext?.contextId ?? provisionalContextId;
      const loadedMessages = storedContext && storedContext.messages.length > 0
        ? sanitizeAgentConversationMessages(storedContext.messages)
        : createDefaultAgentMessages();
      conversationContextIdRef.current = loadedContextId;
      conversationFingerprintRef.current = createAgentConversationFingerprint(loadedMessages);
      setConversationContextId(loadedContextId);
      setConversationContextUpdatedAt(storedContext?.updatedAt ?? provisionalUpdatedAt);
      setConversationContextLoaded(true);
    });

    return () => {
      active = false;
    };
  }, [contextSnapshot?.project.id, activeRole?.id]);

  useEffect(() => {
    if (!conversationContextLoaded || !conversationContextScope || !conversationContextId || !activeRole) {
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
      sanitizeAgentConversationMessages(messages),
      conversationContextId,
    );
  }, [activeRole, conversationContextId, conversationContextLoaded, conversationContextScope, messages]);

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
    conversationContextTouchedRef.current = true;
    setConversationEntries((current) => [...current, createMessageEntry(message)]);
  };

  const clearConversationContext = () => {
    const projectId = contextSnapshot?.project.id ?? conversationContextScope?.projectId;
    const roleId = activeRole?.id ?? conversationContextScope?.roleId;
    suppressCompletedRunRestoreRef.current = true;
    conversationContextTouchedRef.current = true;
    cancelCurrentAgentOperation();
    if (activeRun && !activeRun.id.startsWith("agent-run-tauri")) {
      void cancelAgentRun(activeRun.id, { projectId: activeRun.projectId }).catch(() => undefined);
    }
    if (projectId && roleId) {
      void deleteAgentConversationContext(projectId, roleId);
    }
    const nextContextId = createId("conversation-context");
    conversationContextIdRef.current = nextContextId;
    conversationFingerprintRef.current = createAgentConversationFingerprint(createDefaultAgentMessages());
    setConversationEntries(createDefaultConversationEntries());
    setActiveRun(null);
    if (projectId && roleId) {
      setConversationContextScope({ projectId, roleId });
    }
    setConversationContextId(nextContextId);
    setConversationContextUpdatedAt(new Date().toISOString());
    setConversationContextLoaded(Boolean(projectId && roleId));
    setPendingPlan(null);
    setLastWarning(null);
    setPendingContinuation(null);
  };

  const openRoleDialog = (metadocId?: string) => {
    setRoleError(null);
    setNewRole({
      name: "",
      metadocMode: metadocId ? "existing" : "new",
      metadocId: metadocId ?? ordinaryDocuments[0]?.id ?? "",
      workingDirectory: createAgentRoleWorkingDirectory(createAgentRoleId("role", availableRoles)),
      workingDirectoryTouched: false,
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
    const workingDirectory =
      newRole.workingDirectory.trim() || createAgentRoleWorkingDirectory(roleId);
    if (!workingDirectory) {
      setRoleError("Working directory is required.");
      return;
    }
    setRoleSaving(true);
    setRoleError(null);
    try {
      const manifest = await createProjectRole(projectId, {
        id: roleId,
        name,
        workingDirectory,
        ...(newRole.metadocMode === "existing" ? { metadocId: newRole.metadocId } : {}),
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
    conversationContextTouchedRef.current = true;
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
    conversationContextTouchedRef.current = true;
    setConversationEntries((current) =>
      current.filter((entry) => entry.kind !== "message" || entry.message.id !== messageId),
    );
  };

  const addContextMessage = (role: AgentChatMessage["role"]) => {
    conversationContextTouchedRef.current = true;
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
      const noProjectChanges = !result.executionDiff.changed;
      const executionDetail = noProjectChanges
        ? AGENT_COMMAND_PLAN_NO_CHANGE_MESSAGE
        : `${executedCommandIds.join(", ")}; ${result.executionDiff.summary}`;
      appendLog(
        createLog(
          "executeCommandPlan",
          noProjectChanges ? "error" : "success",
          executionDetail,
        ),
      );
      setPendingPlan(null);
      setPendingPlanRun(null);
      if (sourceRun) {
        const completedRun = await reportAgentCommandPlanResult(sourceRun.runId, {
          projectId: sourceRun.projectId,
          status: noProjectChanges ? "no_change" : "success",
          commandIds: executedCommandIds,
          saved: executedCommandIds.includes("saveProject"),
          executionDiff: result.executionDiff,
          ...(noProjectChanges ? { error: AGENT_COMMAND_PLAN_NO_CHANGE_MESSAGE } : {}),
        });
        if (completedRun) {
          recordAgentRunUpdate(completedRun);
        }
      }
      const nextContext = await getAgentContext();
      setContextSnapshot(nextContext);
      appendMessage(
        createMessage(
          "assistant",
          noProjectChanges
            ? AGENT_COMMAND_PLAN_NO_CHANGE_MESSAGE
            : `Executed: ${executedCommandIds.join(", ")}. ${result.executionDiff.summary}`,
        ),
      );
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
    if (warning && !isAgentHarnessDiagnosticMessage(warning)) {
      setLastWarning(warning);
      appendLog(createLog("agentWarning", "error", warning));
    }
    const isHarnessDiagnostic = isAgentHarnessDiagnosticMessage(payload.message);
    const unverifiedMutationClaim =
      !isHarnessDiagnostic &&
      isAgentMutationCompletionClaim(payload.message) &&
      !runHasVerifiedMutation(options.sourceRun);
    if (unverifiedMutationClaim) {
      appendLog(createLog(
        "agentVerification",
        "error",
        "The model claimed a document or project change, but this run has no verified document mutation result or command execution result. The raw modelResponse is shown for debugging and was not saved into Conversation Context.",
      ));
    }
    if (!options.suppressMessage && !isHarnessDiagnostic && !unverifiedMutationClaim) {
      appendMessage(createMessage("assistant", payload.message));
    }
    for (const log of payload.toolLogs ?? []) {
      appendLog(log);
    }
    if (payload.pendingCommandPlan) {
      setLastWarning(AGENT_PAGE_COMMAND_PLAN_DISABLED_MESSAGE);
      appendLog(createLog("agentWarning", "error", AGENT_PAGE_COMMAND_PLAN_DISABLED_MESSAGE));
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
    if (
      activeRun?.id !== run.id &&
      !runMatchesConversationContext(run, conversationContextIdRef.current, conversationFingerprintRef.current)
    ) {
      return;
    }
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
    conversationContextId: runConversationContextId,
    conversationContextFingerprint: runConversationContextFingerprint,
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
    conversationContextId: string | null;
    conversationContextFingerprint: string;
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
      conversationContextId: runConversationContextId,
      conversationContextFingerprint: runConversationContextFingerprint,
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
    conversationContextId: runConversationContextId,
    conversationContextFingerprint: runConversationContextFingerprint,
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
    conversationContextId: string | null;
    conversationContextFingerprint: string;
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
    let duplicateOnlyRoundCount = 0;
    let shouldContinueBackendBudgetSegment = continueBackendBudgetSegment === true;
    let finalAnswerOnlyMode = false;
    let finalAnswerOnlyRepairCount = 0;
    const completedToolCalls = new Set(completedToolCallKeys ?? []);

    if (hasToolBudgetPauseWarning(payload)) {
      pauseForToolBudget({
        messages,
        conversationContextId: runConversationContextId,
        conversationContextFingerprint: runConversationContextFingerprint,
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
      if (finalAnswerOnlyMode) {
        if (finalAnswerOnlyRepairCount < MAX_FINAL_ANSWER_ONLY_REPAIRS) {
          finalAnswerOnlyRepairCount += 1;
          appendLog(createLog("agentChat", "pending", "Repairing final-answer-only response without executing tools"));
          const harness = buildAgentHarness(context, dynamicToolResults, harnessOptionsForConfig(config, activeRoleSnapshot));
          const repairRequest = {
            messages: toAgentWireMessages(messages, createFinalAnswerOnlyRepairNotice(payload)),
            ...(runConversationContextId ? { conversationContextId: runConversationContextId } : {}),
            conversationContextFingerprint: runConversationContextFingerprint,
            ...(conversationContextUpdatedAt ? { conversationContextUpdatedAt } : {}),
            systemPrompt: systemPromptSnapshot,
            agentContext: context,
            activeRoleId: activeRoleSnapshot.id,
            activeRole: activeRoleSnapshot,
            activeDocumentId,
            harness,
            canvasSnapshot: context.canvasSnapshot,
            finalAnswerOnly: true,
          };
          if (currentRun && !currentRun.id.startsWith("agent-run-tauri")) {
            const result = await resumeAgentRunTurn(
              currentRun.id,
              currentRun.modelTurnIndex,
              {
                conversationContextId: runConversationContextId,
                conversationContextFingerprint: runConversationContextFingerprint,
                harness,
                toolResults: [],
                dynamicToolResults,
                finalAnswerOnly: true,
              },
              recordAgentRunUpdate,
            );
            currentRun = result.run;
            payload = result.response;
          } else {
            const result = await sendAgentRunRequest(repairRequest, "final-answer-only-repair");
            currentRun = result.run;
            payload = result.response;
          }
          continue;
        }
        payload = coerceFinalAnswerOnlyPayload(payload);
        appendLog(createLog("agentToolCalls", "success", "Suppressed tool requests after final-answer-only repair limit"));
        break;
      }
      if (hasToolBudgetPauseWarning(payload)) {
        pauseForToolBudget({
          messages,
          conversationContextId: runConversationContextId,
          conversationContextFingerprint: runConversationContextFingerprint,
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
      let duplicateToolCallCount = 0;
      for (const call of executableCalls) {
        const reusableResult = findReusableAgentToolResult(
          [...dynamicToolResults, ...toolResults],
          call,
          toolReuseOptionsForContext(context),
        );
        const toolCallKey = createAgentToolCallKey(call);
        if (reusableResult) {
          const duplicateResult = isAgentDocumentMutationToolName(call.toolName)
            ? createDuplicateToolCallSkippedResult(call, undefined, reusableResult)
            : createCachedAgentToolResult(call, reusableResult);
          toolResults.push(duplicateResult);
          duplicateToolCallCount += 1;
          appendLog(createLog(call.toolName, "success", "Reused cached tool result"));
          continue;
        }
        appendLog(createLog(call.toolName, "pending", call.reason));
        const toolResult = await executeAgentHarnessToolCall(context, call, harnessOptionsForConfig(config, activeRoleSnapshot));
        toolResults.push(toolResult);
        if (isAgentDocumentMutationToolName(call.toolName)) {
          onDocumentsChanged?.();
        }
        completedToolCalls.add(toolCallKey);
        segmentExecutedToolCallCount += 1;
        appendLog(createLog(call.toolName, "success", describeToolCallForLog(call)));
      }
      const duplicateOnly =
        executableCalls.length > 0 &&
        deferredCalls.length === 0 &&
        duplicateToolCallCount === executableCalls.length;
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
      if (duplicateOnly) {
        duplicateOnlyRoundCount += 1;
        appendLog(createLog("agentToolCalls", "success", "Reused cached duplicate tool results; asking the model to continue"));
      } else {
        duplicateOnlyRoundCount = 0;
      }
      const forceFinalAnswerOnly = duplicateOnlyRoundCount >= MAX_DUPLICATE_TOOL_GUIDED_RETRIES;
      appendLog(createLog("agentChat", "pending", `Waiting for model response after ${toolResults.length} tool result(s)`));
      const harness = buildAgentHarness(context, dynamicToolResults, harnessOptionsForConfig(config, activeRoleSnapshot));
      const duplicateGuidanceNotice = forceFinalAnswerOnly
        ? createFinalAnswerOnlyNotice(toolResults)
        : duplicateOnly
          ? createDuplicateToolGuidanceNotice(toolResults)
          : undefined;
      const nextRequest = {
        messages: toAgentWireMessages(messages, duplicateGuidanceNotice),
        ...(runConversationContextId ? { conversationContextId: runConversationContextId } : {}),
        conversationContextFingerprint: runConversationContextFingerprint,
        ...(conversationContextUpdatedAt ? { conversationContextUpdatedAt } : {}),
        systemPrompt: systemPromptSnapshot,
        agentContext: context,
        activeRoleId: activeRoleSnapshot.id,
        activeRole: activeRoleSnapshot,
        activeDocumentId,
        harness,
        canvasSnapshot: context.canvasSnapshot,
        finalAnswerOnly: forceFinalAnswerOnly,
      };
      if (currentRun && !currentRun.id.startsWith("agent-run-tauri")) {
        const result = await resumeAgentRunTurn(
          currentRun.id,
          currentRun.modelTurnIndex,
          {
            conversationContextId: runConversationContextId,
            conversationContextFingerprint: runConversationContextFingerprint,
            harness,
            toolResults,
            dynamicToolResults,
            continueBudgetSegment: shouldContinueBackendBudgetSegment,
            finalAnswerOnly: forceFinalAnswerOnly,
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
      finalAnswerOnlyMode = forceFinalAnswerOnly;
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
        conversationContextId: runConversationContextId,
        conversationContextFingerprint: runConversationContextFingerprint,
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
        conversationContextId: continuation.conversationContextId,
        conversationContextFingerprint: continuation.conversationContextFingerprint,
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
      if (!runMatchesConversationContext(activeRun, conversationContextId, conversationFingerprint)) {
        throw new Error("This persisted run belongs to an older Conversation Context. Start a new Agent request from the visible context.");
      }
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
        conversationContextId,
        conversationContextFingerprint: conversationFingerprint,
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
      if (!runMatchesConversationContext(activeRun, conversationContextId, conversationFingerprint)) {
        throw new Error("This persisted run belongs to an older Conversation Context. Start a new Agent request from the visible context.");
      }
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
        conversationContextId,
        conversationContextFingerprint: conversationFingerprint,
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
    if (!conversationContextLoaded || !projectId || !roleId || !conversationContextId || busy) {
      return;
    }
    let active = true;
    void listAgentRuns(projectId, {
      roleId,
      limit: 5,
      conversationContextId,
      conversationContextFingerprint: conversationFingerprint,
    })
      .then(async (runs) => {
        if (!active || runs.length === 0) {
          return;
        }
        const candidate = runs.find((run) => {
          if (!runMatchesConversationContext(run, conversationContextId, conversationFingerprint)) {
            return false;
          }
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
              !isAgentHarnessDiagnosticMessage(responseMessage) &&
              (!isAgentMutationCompletionClaim(responseMessage) || runHasVerifiedMutation(run)) &&
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
  }, [activeRole?.id, busy, contextSnapshot?.project.id, conversationContextId, conversationContextLoaded, conversationFingerprint, messages]);

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
    const effectiveConversationContextId = conversationContextId ?? createId("conversation-context");
    if (!conversationContextId) {
      setConversationContextId(effectiveConversationContextId);
    }
    const userMessage = createMessage("user", trimmed);
    const nextMessages = [...messages, userMessage];
    const nextConversationFingerprint = createAgentConversationFingerprint(nextMessages);
    let nextConversationContextUpdatedAt = conversationContextUpdatedAt;
    conversationContextIdRef.current = effectiveConversationContextId;
    conversationFingerprintRef.current = nextConversationFingerprint;
    conversationContextTouchedRef.current = true;
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
      nextConversationContextUpdatedAt = new Date().toISOString();
      await saveAgentConversationContext(context.project.id, activeRole.id, nextMessages, effectiveConversationContextId);
      if (isAgentOperationCancelled(operationId)) {
        return;
      }
      setConversationContextUpdatedAt(nextConversationContextUpdatedAt);
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
      appendLog(createLog("readPrimeDirective", "pending", AGENT_PRIME_DIRECTIVE_DOCUMENT_ID));
      const primeDirective = await readProjectDocument(context.project.id, AGENT_PRIME_DIRECTIVE_DOCUMENT_ID);
      if (isAgentOperationCancelled(operationId)) {
        return;
      }
      const primeDirectiveContentLimit = 12000;
      const primeDirectiveResult = createAgentHarnessToolResult("readPrimeDirective", {
        documentId: AGENT_PRIME_DIRECTIVE_DOCUMENT_ID,
      }, {
        document: {
          id: primeDirective.id,
          title: primeDirective.title,
          path: primeDirective.path,
          status: primeDirective.status,
          summary: primeDirective.summary ?? "",
          content: primeDirective.content.slice(0, primeDirectiveContentLimit),
          contentLength: primeDirective.content.length,
          truncated: primeDirective.content.length > primeDirectiveContentLimit,
        },
        priority:
          "Pinned project-level directive. Interpret role metadocs, creator requests, page evidence, and output documents through this directive.",
        conflictRule:
          "If role instructions, chat, or ordinary documents conflict with PrimeDirective.md, follow PrimeDirective.md and report the conflict.",
      });
      appendLog(createLog("readPrimeDirective", "success", primeDirective.path));
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
          metadocId: activeRole.metadocId,
          workingDirectory: getAgentRoleWorkingDirectory(activeRole),
        },
        priority: "Pinned role prompt. This metadoc is the active role prompt/definition only; it is not the role's work-output log.",
        outputRule:
          "Write durable role output only to ordinary Markdown documents under the role working directory. Do not mutate this metadoc through Agent tools.",
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
      const dynamicToolResults: AgentHarnessToolResult[] = [primeDirectiveResult, metadocResult];
      const harness = buildAgentHarness(
        context,
        dynamicToolResults,
        harnessOptionsForConfig(config, activeRole, primeDirective, effectiveModelCapability),
      );
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
        conversationContextId: effectiveConversationContextId,
        conversationContextFingerprint: nextConversationFingerprint,
        ...(nextConversationContextUpdatedAt ? { conversationContextUpdatedAt: nextConversationContextUpdatedAt } : {}),
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
        conversationContextId: effectiveConversationContextId,
        conversationContextFingerprint: nextConversationFingerprint,
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
      for (const cancelKey of Array.from(cancelledOperationRunIdsRef.current)) {
        if (cancelKey.startsWith(`${operationId}:`)) {
          cancelledOperationRunIdsRef.current.delete(cancelKey);
        }
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
  const agentPromptDisabled = !agentBackendUsable || !activeRole;
  const agentSendDisabled =
    agentPromptDisabled ||
    !conversationContextLoaded ||
    !conversationContextId ||
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
      : agentBackendUsable
      ? activeRole
        ? "Ask the agent..."
        : "Create an Agent role first."
      : "Configure the Agent backend first.";
  const activeTaskProgress = activeRun?.latestResponse?.taskProgress ?? null;

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
        {effectiveModelCapability === "metadoc" ? (
          <p className="agent-warning">
            This text-only model cannot inspect pages, images, or renders. It uses PrimeDirective.md and the active role metadoc as pinned context, then reads/writes Markdown documents as needed.
          </p>
        ) : null}
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

      <AgentTaskProgressView progress={activeTaskProgress} run={activeRun} />

      <details
        className="agent-manual-config"
        aria-label="Agent manual config"
        open={configPanelOpen}
        onToggle={(event) => setConfigPanelOpen(event.currentTarget.open)}
      >
        <summary>Agent Config</summary>
        <div className="agent-config-editor">
          <label>
            <span>Model</span>
            <select
              aria-label="Agent model"
              value={selectedModelId}
              disabled={config?.testMode === true || busy}
              onChange={(event) => setSelectedModelId(event.currentTarget.value)}
            >
              <option value="">
                {backendConfiguredModel ? `Use backend default (${backendConfiguredModel})` : "Select a model"}
              </option>
              {AGENT_MODEL_PRESETS.map((preset) => {
                const model = availableModels.find((entry) => entry.id === preset.id);
                return (
                  <option
                    key={preset.id}
                    value={preset.id}
                    disabled={availableModels.length > 0 && !model}
                  >
                    {preset.label}: {model ? formatAgentModelOption(model) : preset.id}
                  </option>
                );
              })}
              {availableModels
                .filter((model) => !AGENT_MODEL_PRESETS.some((preset) => preset.id === model.id))
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {formatAgentModelOption(model)}
                  </option>
                ))}
            </select>
          </label>
          <p className="agent-muted">
            Effective model: {effectiveModelId || "not set"}.{" "}
            {effectiveModelCapability === "metadoc"
              ? "DeepSeek text-only mode can read and write Markdown documents but cannot inspect images."
              : effectiveModelCapability === "multimodal"
                ? "Multimodal mode can use page/render screenshots when requested."
                : "Select an allowlisted model to enable the Agent."}
          </p>
          {modelsError ? <p className="agent-warning">{modelsError}</p> : null}
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
            <span>Current Task Pin</span>
            <textarea
              aria-label="Agent current task pin"
              rows={5}
              value={currentTaskPin}
              spellCheck={false}
              placeholder="Optional high-priority constraints for the current task. Leave empty for automatic task extraction from the latest message."
              onChange={(event) => setCurrentTaskPin(event.currentTarget.value)}
            />
          </label>
          <p className="agent-muted">
            This is inserted into the Current Task Packet above ordinary chat history. Use it for constraints that must not be pushed out by a long conversation.
          </p>
          <div className="agent-config-actions">
            <button type="button" onClick={() => setCurrentTaskPin("")}>
              Clear task pin
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
            {formatTokenCount(effectiveModelContextMax)}.
          </p>
          <label>
            <span>Repetition penalty</span>
            <input
              aria-label="Agent repetition penalty"
              type="number"
              min={1}
              max={2}
              step={0.01}
              value={repetitionPenaltyInput}
              onChange={(event) => setRepetitionPenaltyInput(event.currentTarget.value)}
            />
          </label>
          <p className="agent-muted">
            Effective {effectiveRepetitionPenalty.toFixed(2)}. Higher values reduce repeated phrasing and repeated tool-call patterns; too high can make responses less coherent.
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
            <p>
              Role prompt: {activeRoleMetadoc?.path ?? activeRole.metadocId}
            </p>
            <p>
              Working dir: {getAgentRoleWorkingDirectory(activeRole)}
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
                  setNewRole((current) => ({
                    ...current,
                    name,
                    workingDirectory: current.workingDirectoryTouched
                      ? current.workingDirectory
                      : createAgentRoleWorkingDirectory(createAgentRoleId(name || "role", availableRoles)),
                  }));
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
                Metadoc will be created as {createAgentRoleMetadocPath(newRole.name || "role")} and used as the role prompt.
              </p>
            )}
            <p className="agent-muted">
              Edit the role prompt by editing the metadoc after the role is created.
            </p>
            <label>
              <span>Working dir</span>
              <input
                aria-label="New role working directory"
                value={newRole.workingDirectory}
                onChange={(event) => {
                  const workingDirectory = event.currentTarget.value;
                  setNewRole((current) => ({
                    ...current,
                    workingDirectory,
                    workingDirectoryTouched: true,
                  }));
                }}
              />
            </label>
            <p className="agent-muted">
              Working dir stores this role's durable output documents. It must be a directory under docs/, not a prompt.
            </p>
            {roleError ? <p className="document-error">{roleError}</p> : null}
            <div className="document-dialog-actions">
              <button type="button" disabled={roleSaving} onClick={() => setRoleDialogOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={roleSaving || newRole.name.trim().length === 0 || newRole.workingDirectory.trim().length === 0}
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
