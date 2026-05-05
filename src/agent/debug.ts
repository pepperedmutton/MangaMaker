import type {
  AgentChatMessage,
  AgentConfig,
  AgentContextSnapshot,
  AgentDebugSnapshot,
  AgentToolLogEntry,
  AgentCommandPlan,
} from "./types";

const MAX_DEBUG_MESSAGES = 20;
const MAX_DEBUG_LOGS = 80;

let latestAgentDebugSnapshot: AgentDebugSnapshot | null = null;

const summarizeContext = (context: AgentContextSnapshot | null): AgentDebugSnapshot["context"] => {
  if (!context) {
    return { loaded: false };
  }
  return {
    loaded: true,
    projectTitle: context.project.title,
    pageCount: context.project.pageCount,
    selectedPageId: context.selectedPageId,
    currentPageId: context.currentPage?.id ?? null,
    objectCount: context.objects.length,
    currentPageObjectCount: context.currentPage?.objects.length ?? 0,
    totalObjectCount: context.pages.reduce((count, page) => count + page.objects.length, 0),
    pages: context.pages.map((page) => ({
      id: page.id,
      name: page.name,
      isCurrent: page.isCurrent,
      objectCount: page.objects.length,
    })),
    imageAssetCount: context.imageAssets.length,
    selection: context.selection
      ? `${context.selection.objectType}:${context.selection.objectId}`
      : null,
    activeTool: context.activeTool,
    canvasSnapshot: {
      available: Boolean(context.canvasSnapshot.dataUrl),
      width: context.canvasSnapshot.width,
      height: context.canvasSnapshot.height,
      source: context.canvasSnapshot.source,
      byteLength: context.canvasSnapshot.byteLength,
      reason: context.canvasSnapshot.reason,
    },
  };
};

const summarizePendingPlan = (plan: AgentCommandPlan | null): AgentDebugSnapshot["pendingPlan"] =>
  plan
    ? {
        summary: plan.summary,
        requiresConfirmation: plan.requiresConfirmation,
        commands: plan.commands.map((command) => ({
          commandId: command.commandId,
          dangerLevel: command.dangerLevel,
          reason: command.reason,
        })),
      }
    : null;

const getActiveToolCall = (toolLogs: AgentToolLogEntry[]) =>
  toolLogs.find((entry) => entry.status === "pending") ?? null;

const computePendingDurationMs = (toolCall: AgentToolLogEntry | null, now: string) => {
  if (!toolCall) {
    return null;
  }
  const startedAt = Date.parse(toolCall.createdAt);
  const current = Date.parse(now);
  if (!Number.isFinite(startedAt) || !Number.isFinite(current)) {
    return null;
  }
  return Math.max(0, current - startedAt);
};

export const createAgentDebugSnapshot = ({
  mounted,
  busy,
  messages,
  toolLogs,
  config,
  configError,
  lastWarning,
  pendingPlan,
  contextSnapshot,
}: {
  mounted: boolean;
  busy: boolean;
  messages: AgentChatMessage[];
  toolLogs: AgentToolLogEntry[];
  config: AgentConfig | null;
  configError: string | null;
  lastWarning: string | null;
  pendingPlan: AgentCommandPlan | null;
  contextSnapshot: AgentContextSnapshot | null;
}): AgentDebugSnapshot => {
  const updatedAt = new Date().toISOString();
  const activeToolCall = getActiveToolCall(toolLogs);
  return {
    mounted,
    busy,
    updatedAt,
    activeToolCall,
    pendingDurationMs: computePendingDurationMs(activeToolCall, updatedAt),
    messageCount: messages.length,
    messages: messages.slice(-MAX_DEBUG_MESSAGES),
    toolLogs: toolLogs.slice(0, MAX_DEBUG_LOGS),
    config,
    configError,
    lastWarning,
    pendingPlan: summarizePendingPlan(pendingPlan),
    context: summarizeContext(contextSnapshot),
  };
};

export const setLatestAgentDebugSnapshot = (snapshot: AgentDebugSnapshot) => {
  latestAgentDebugSnapshot = snapshot;
};

export const getLatestAgentDebugSnapshot = () => latestAgentDebugSnapshot;
