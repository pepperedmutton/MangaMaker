import { isAgentHarnessDiagnosticContent, sanitizeAgentConversationMessages } from "./conversationSanitizer";
import { isAgentDocumentMutationToolName, isVerifiedAgentDocumentMutationResult } from "./documentEditTools";

type AgentWireMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentCurrentTaskRecentMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentCurrentTaskToolResultIndexEntry = {
  index: number;
  toolName: string;
  inputSummary: string;
  resultKeys: string[];
  createdAt: string;
  status?: "verified_write" | "blocked" | "cache" | "skipped";
};

export type AgentCurrentTaskPacket = {
  version: 1;
  generatedAt: string;
  priority: "current_task";
  latestCreatorInstruction: string;
  pinnedTaskInstructions?: string;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  activeRole?: {
    id: string;
    name: string;
    metadocId: string;
    workingDirectory?: string;
  };
  activeDocumentId?: string | null;
  conversationPolicy: {
    latestCreatorInstructionWins: true;
    olderMessagesAreReferenceOnly: true;
    ignoreHarnessDiagnosticsAsCreatorIntent: true;
  };
  recentConversationReference: AgentCurrentTaskRecentMessage[];
  completedToolResultIndex: AgentCurrentTaskToolResultIndexEntry[];
  nextActionHint: string;
};

type AgentHarnessToolResult = {
  toolName: string;
  input: unknown;
  result: unknown;
  createdAt: string;
};

type CompileAgentCurrentTaskPacketInput = {
  messages: AgentWireMessage[];
  currentTaskPin?: string | null;
  currentTask?: AgentCurrentTaskPacket | null;
  activeRole?: {
    id: string;
    name: string;
    metadocId: string;
    workingDirectory?: string;
  } | null;
  activeDocumentId?: string | null;
  harness?: {
    initialToolResults?: AgentHarnessToolResult[];
    dynamicToolResults?: AgentHarnessToolResult[];
  } | null;
  now?: string;
};

const MAX_LATEST_INSTRUCTION_CHARS = 6000;
const MAX_PINNED_TASK_CHARS = 4000;
const MAX_RECENT_REFERENCE_MESSAGES = 6;
const MAX_RECENT_REFERENCE_MESSAGE_CHARS = 900;
const MAX_TOOL_INDEX_ENTRIES = 36;
const MAX_INPUT_SUMMARY_CHARS = 320;

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, Math.max(0, limit - 48))}\n[truncated for task packet]` : value;

const compactWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const inputSummary = (input: unknown): string => {
  if (input === null || input === undefined) {
    return "";
  }
  if (typeof input === "string") {
    return truncate(input, MAX_INPUT_SUMMARY_CHARS);
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return truncate(String(input), MAX_INPUT_SUMMARY_CHARS);
  }
  const record = input as Record<string, unknown>;
  const pairs = Object.entries(record)
    .filter(([key]) => key !== "content" && key !== "newContent" && key !== "replacement")
    .slice(0, 10)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}=[${value.length}]`;
      }
      if (value && typeof value === "object") {
        return `${key}={...}`;
      }
      return `${key}=${String(value)}`;
    });
  return truncate(pairs.join("; "), MAX_INPUT_SUMMARY_CHARS);
};

const resultKeys = (result: unknown): string[] =>
  result && typeof result === "object" && !Array.isArray(result)
    ? Object.keys(result as Record<string, unknown>).slice(0, 16)
    : [];

const toolResultStatus = (entry: AgentHarnessToolResult): AgentCurrentTaskToolResultIndexEntry["status"] | undefined => {
  if (entry.toolName === "toolCallSkipped") {
    return "skipped";
  }
  const result = entry.result && typeof entry.result === "object" && !Array.isArray(entry.result)
    ? entry.result as Record<string, unknown>
    : {};
  if (result.cacheHit === true) {
    return "cache";
  }
  if (result.blocked === true) {
    return "blocked";
  }
  if (isAgentDocumentMutationToolName(entry.toolName) && isVerifiedAgentDocumentMutationResult(entry.result)) {
    return "verified_write";
  }
  return undefined;
};

const buildToolResultIndex = (results: AgentHarnessToolResult[]): AgentCurrentTaskToolResultIndexEntry[] => {
  const selected = results.slice(-MAX_TOOL_INDEX_ENTRIES);
  const offset = Math.max(0, results.length - selected.length);
  return selected.map((entry, selectedIndex) => ({
    index: offset + selectedIndex,
    toolName: entry.toolName,
    inputSummary: inputSummary(entry.input),
    resultKeys: resultKeys(entry.result),
    createdAt: entry.createdAt,
    ...(toolResultStatus(entry) ? { status: toolResultStatus(entry) } : {}),
  }));
};

const getLatestCreatorInstruction = (messages: AgentWireMessage[]) =>
  [...messages]
    .reverse()
    .find((message) => message.role === "user" && !isAgentHarnessDiagnosticContent(message.content))
    ?.content
    .trim() ?? "";

const buildRecentReference = (
  messages: AgentWireMessage[],
  latestInstruction: string,
): AgentCurrentTaskRecentMessage[] => {
  const sanitized = sanitizeAgentConversationMessages(
    messages.filter((message) => !isAgentHarnessDiagnosticContent(message.content)),
  );
  const withoutLatest = [...sanitized];
  const latestIndex = latestInstruction
    ? withoutLatest.map((message) => message.content).lastIndexOf(latestInstruction)
    : -1;
  if (latestIndex >= 0) {
    withoutLatest.splice(latestIndex, 1);
  }
  return withoutLatest
    .slice(-MAX_RECENT_REFERENCE_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: truncate(message.content, MAX_RECENT_REFERENCE_MESSAGE_CHARS),
    }));
};

export const compileAgentCurrentTaskPacket = ({
  messages,
  currentTaskPin,
  currentTask,
  activeRole,
  activeDocumentId,
  harness,
  now = new Date().toISOString(),
}: CompileAgentCurrentTaskPacketInput): AgentCurrentTaskPacket => {
  if (currentTask?.version === 1) {
    return currentTask;
  }
  const sanitizedMessages = sanitizeAgentConversationMessages(messages);
  const latestCreatorInstruction = truncate(
    getLatestCreatorInstruction(sanitizedMessages) || "No creator instruction was supplied.",
    MAX_LATEST_INSTRUCTION_CHARS,
  );
  const pinnedTaskInstructions = typeof currentTaskPin === "string" && currentTaskPin.trim().length > 0
    ? truncate(currentTaskPin.trim(), MAX_PINNED_TASK_CHARS)
    : undefined;
  const dynamicToolResults = harness?.dynamicToolResults ?? [];
  const initialToolResults = harness?.initialToolResults ?? [];
  const completedToolResultIndex = buildToolResultIndex([...initialToolResults, ...dynamicToolResults]);
  const objective = compactWhitespace(latestCreatorInstruction).slice(0, 600) ||
    "Handle the creator's latest MangaMaker Agent request.";
  const constraints = [
    "Treat this Current Task Packet as higher priority than ordinary conversation history.",
    "The latestCreatorInstruction is the authoritative current request. If older messages conflict with it, follow latestCreatorInstruction.",
    "Use pinnedTaskInstructions as durable creator constraints for this task when present.",
    "Treat recentConversationReference as background only; it is not durable production state.",
    "Use PrimeDirective.md and the active role metadoc as pinned high-priority project/role context.",
    "Use tool results by index when available; do not repeat identical toolName/input calls just because old text appears in conversation history.",
  ];
  const acceptanceCriteria = [
    "The response or tool plan directly addresses latestCreatorInstruction.",
    "If a document change is required, a verified document mutation tool result is needed before reporting completion.",
    "If more input is needed, taskProgress.status must be waiting_for_user with a concrete request.",
    "If the task is complete, taskProgress.status must be completed and requestedToolCalls must be empty.",
  ];
  return {
    version: 1,
    generatedAt: now,
    priority: "current_task",
    latestCreatorInstruction,
    ...(pinnedTaskInstructions ? { pinnedTaskInstructions } : {}),
    objective,
    constraints,
    acceptanceCriteria,
    ...(activeRole
      ? {
          activeRole: {
            id: activeRole.id,
            name: activeRole.name,
            metadocId: activeRole.metadocId,
            ...(activeRole.workingDirectory ? { workingDirectory: activeRole.workingDirectory } : {}),
          },
        }
      : {}),
    activeDocumentId: activeDocumentId ?? null,
    conversationPolicy: {
      latestCreatorInstructionWins: true,
      olderMessagesAreReferenceOnly: true,
      ignoreHarnessDiagnosticsAsCreatorIntent: true,
    },
    recentConversationReference: buildRecentReference(sanitizedMessages, latestCreatorInstruction),
    completedToolResultIndex,
    nextActionHint:
      completedToolResultIndex.some((entry) => entry.status === "verified_write")
        ? "If the verified write satisfies latestCreatorInstruction, report completion instead of requesting more tools."
        : "Choose the smallest necessary next tool call, document mutation, answer, blocked state, or waiting_for_user request.",
  };
};
