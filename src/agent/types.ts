import type { EditorMultiSelection, EditorSelection, SaveStatus, ToolMode } from "../state/types";
import type {
  AgentDocument,
  AgentDocumentManifest,
  AgentDocumentMeta,
} from "./documentSchema";
import type { AgentRoleDefinition, AgentRoleId } from "./roles";

export type AgentDangerLevel = "safe" | "normal" | "destructive";

export type AgentCommandManifestEntry = {
  id: string;
  label: string;
  description: string;
  inputJsonSchema: unknown;
  recordHistory: boolean;
  mutatesProject: boolean;
  dangerLevel: AgentDangerLevel;
  guiEquivalent: string;
  examples: unknown[];
};

export type AgentRenderDetail = "preview" | "detail";

export type AgentSnapshotCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AgentSnapshotOptions = {
  detail?: AgentRenderDetail;
  crop?: AgentSnapshotCrop;
};

export type AgentCommandPlanItem = {
  commandId: string;
  payload: unknown;
  reason?: string;
  dangerLevel?: AgentDangerLevel;
};

export type AgentCommandPlan = {
  summary: string;
  commands: AgentCommandPlanItem[];
  requiresConfirmation: boolean;
};

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AgentConversationContext = {
  contextId?: string;
  projectId: string;
  roleId: string;
  updatedAt: string;
  messages: AgentChatMessage[];
  storagePath?: string;
};

export type AgentToolLogEntry = {
  id: string;
  label: string;
  status: "pending" | "success" | "error";
  detail?: string;
  createdAt: string;
};

export type AgentRequestTraceStatus = "pending" | "success" | "error" | "timeout";

export type AgentRequestTraceDetailValue = string | number | boolean | null;

export type AgentRequestTraceEvent = {
  phase: string;
  at: string;
  elapsedMs: number;
  message?: string;
  detail?: Record<string, AgentRequestTraceDetailValue>;
};

export type AgentRequestTraceMetadata = {
  requestId: string;
  parentRequestId?: string;
  stage: string;
  createdAt: string;
};

export type AgentRequestTrace = {
  requestId: string;
  parentRequestId?: string;
  stage: string;
  status: AgentRequestTraceStatus;
  provider: AgentConfig["provider"] | null;
  model: string | null;
  usedVision: boolean | null;
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  events: AgentRequestTraceEvent[];
  error?: string;
};

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_tool"
  | "waiting_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRunStepKind =
  | "model_request"
  | "model_resume"
  | "tool_call"
  | "tool_result"
  | "command_plan"
  | "command_result"
  | "retry"
  | "error";

export type AgentRunStepStatus = "pending" | "running" | "success" | "error" | "waiting" | "no_change";

export type AgentCommandPlanResultStatus = "success" | "error" | "no_change";

export type AgentCommandPlanAffectedChange = {
  pageId?: string;
  pageName?: string;
  pageNumber?: number;
  objectType: "project" | "page" | "panel" | "text" | "bubble" | "element";
  objectId?: string;
  objectRef?: string;
  changeType: "created" | "updated" | "deleted";
  changedFields: string[];
};

export type AgentCommandPlanExecutionDiff = {
  changed: boolean;
  redacted: true;
  summary: string;
  changedPageIds: string[];
  changedObjectRefs: string[];
  changedFields: string[];
  affected: AgentCommandPlanAffectedChange[];
};

export type AgentRunStep = {
  id: string;
  runId: string;
  kind: AgentRunStepKind;
  status: AgentRunStepStatus;
  operationId: string;
  summary: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  input?: unknown;
  output?: unknown;
  trace?: AgentRequestTrace;
  error?: string;
};

export type AgentRun = {
  id: string;
  projectId: string;
  roleId: string;
  conversationContextId?: string;
  conversationContextFingerprint?: string;
  conversationContextUpdatedAt?: string;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  modelTurnIndex: number;
  steps: AgentRunStep[];
  trace: AgentRequestTrace[];
  pendingToolCalls: AgentToolCallRequest[];
  latestResponse?: AgentChatResponse;
  error?: string;
};

export type AgentRunEvent =
  | {
      type: "run_snapshot" | "run_updated";
      run: AgentRun;
    }
  | {
      type: "run_error";
      run?: AgentRun;
      error: string;
    };

export type AgentConversationEntry =
  | {
      id: string;
      kind: "message";
      message: AgentChatMessage;
      createdAt: string;
    }
  | {
      id: string;
      kind: "tool";
      log: AgentToolLogEntry;
      createdAt: string;
    };

export type AgentCanvasSnapshot = {
  scope: "canvas" | "selection";
  dataUrl: string | null;
  width: number;
  height: number;
  mimeType: "image/png";
  byteLength: number;
  capturedAt: string;
  reason?: string;
  source?: "page-render" | "konva-stage" | "dom-canvas";
  detail?: AgentRenderDetail;
  maxEdge?: number;
  crop?: AgentSnapshotCrop;
};

export type AgentImageAsset = {
  src: string;
  pageId: string;
  pageName: string;
  panelId: string;
  panelRef: string;
  sourceWidth: number;
  sourceHeight: number;
  viewBox: { x: number; y: number; width: number; height: number };
  clip?: { x: number; y: number; width: number; height: number };
  transform?: { x: number; y: number; scaleX: number; scaleY: number };
  prompt: string;
  description: string;
};

export type AgentObjectSummary = {
  id: string;
  objectType: "panel" | "text" | "bubble" | "element";
  objectRef: string;
  pageId: string;
  pageName: string;
  panelRef?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  layerRef: string;
  layerIndex?: number;
  content?: string;
  description?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  hasImage?: boolean;
  points?: Array<{ x: number; y: number }>;
  image?: AgentImageAsset;
  direction?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  textAlign?: string;
  verticalAlign?: string;
  bubbleType?: string;
  showTail?: boolean;
  tailTip?: { x: number; y: number };
  tailBase?: { x: number; y: number };
  backgroundColor?: string;
  opacity?: number;
  contentCenter?: { x: number; y: number };
};

export type AgentPageSummary = {
  id: string;
  pageNumber?: number;
  name: string;
  width: number;
  height: number;
  background: string;
  panelCount: number;
  textCount: number;
  bubbleCount: number;
  layerCount: number;
};

export type AgentPageContextSummary = AgentPageSummary & {
  isCurrent: boolean;
  viewing: boolean;
  selectedObject: AgentObjectSummary | null;
  objects: AgentObjectSummary[];
};

export type AgentContextSnapshot = {
  project: {
    id: string;
    title: string;
    type: string;
    createdAt: string;
    updatedAt: string;
    pageCount: number;
  };
  selectedPageId: string | null;
  currentPage: AgentPageContextSummary | null;
  pages: AgentPageContextSummary[];
  selection: EditorSelection;
  multiSelection: EditorMultiSelection;
  activeTool: ToolMode;
  zoom: number;
  saveStatus: SaveStatus;
  objects: AgentObjectSummary[];
  selectedObject: AgentObjectSummary | null;
  imageAssets: AgentImageAsset[];
  commandManifest: AgentCommandManifestEntry[];
  canvasSnapshot: AgentCanvasSnapshot;
  selectionSnapshot: AgentCanvasSnapshot | null;
};

export type AgentConfig = {
  enabled: boolean;
  provider: "openrouter" | "test" | "unavailable";
  model: string | null;
  apiKeyConfigured: boolean;
  testMode: boolean;
  visionEnabled: boolean;
  contextWindowTokens: number;
  contextWindowMaxTokens: number | null;
  contextWindowSource: "request" | "env" | "model" | "default" | "test";
  repetitionPenalty: number;
  reason?: string;
};

export type AgentAvailableModel = {
  id: string;
  name: string;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
};

export type AgentChatRequest = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  conversationContextId?: string;
  conversationContextFingerprint?: string;
  conversationContextUpdatedAt?: string;
  systemPrompt?: string;
  agentContext: AgentContextSnapshot;
  activeRoleId?: AgentRoleId;
  activeRole?: AgentRoleDefinition;
  activeDocumentId?: string | null;
  harness?: AgentHarnessSnapshot;
  canvasSnapshot?: AgentCanvasSnapshot | null;
  approvedCommandPlan?: AgentCommandPlan | null;
  contextWindowTokens?: number;
  repetitionPenalty?: number;
  finalAnswerOnly?: boolean;
  requestTrace?: AgentRequestTraceMetadata;
};

export type AgentChatResponse = {
  message: string;
  pendingCommandPlan?: AgentCommandPlan | null;
  requestedToolCalls?: AgentToolCallRequest[];
  toolLogs?: AgentToolLogEntry[];
  error?: string;
  usedVision?: boolean;
  warning?: string;
  visionUnavailableReason?: string;
  requestTrace?: AgentRequestTrace;
  modelDebug?: {
    rawAssistantContent?: string;
    parsedResponse?: unknown;
    finishReason?: string;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    providerRouting?: unknown;
  };
};

export type AgentHarnessToolDefinition = {
  name: string;
  description: string;
  inputSchema: unknown;
  outputDescription: string;
  mutatesProject: boolean;
  requiresConfirmation: boolean;
};

export type AgentHarnessToolResult = {
  toolName: string;
  input: unknown;
  result: unknown;
  createdAt: string;
};

export type AgentCompletedToolCallIndexEntry = {
  key: string;
  toolName: string;
  input: unknown;
  createdAt: string;
  projectUpdatedAt?: string | null;
  resultKeys: string[];
  reusableInCurrentProjectState: boolean;
};

export type AgentToolCallRequest = {
  toolName: string;
  input: unknown;
  reason?: string;
};

export type AgentHarnessSnapshot = {
  mode: "tool-harness";
  currentPageId: string | null;
  projectId: string;
  currentPageMarkedBy: "isCurrent";
  tools: AgentHarnessToolDefinition[];
  initialToolResults: AgentHarnessToolResult[];
  dynamicToolResults?: AgentHarnessToolResult[];
  completedToolCallIndex?: AgentCompletedToolCallIndexEntry[];
  resourcePolicy: {
    allPagesReadable: boolean;
    assetsReadableOnDemand: boolean;
    documentsReadableOnDemand: boolean;
    documentsWritableOnDemand: boolean;
    sysmlReadableOnDemand?: boolean;
    sysmlWritableOnDemand?: boolean;
    sysmlValidationProvider?: "official-pilot" | "unavailable";
    sysmlStandardReference?: "overview-preloaded-topic-tools" | "unavailable";
    inlineDataUrlsRedactedFromPrompt: boolean;
    projectMutationPath: "commandPlanOnly";
    pagePanelBoundary?: string;
  };
};

export type {
  AgentDocument,
  AgentDocumentManifest,
  AgentDocumentMeta,
  AgentRoleDefinition,
  AgentRoleId,
};

export type AgentDebugSnapshot = {
  mounted: boolean;
  busy: boolean;
  updatedAt: string;
  activeRoleId?: AgentRoleId;
  activeDocumentId?: string | null;
  activeRun?: {
    id: string;
    projectId: string;
    roleId: string;
    status: AgentRunStatus;
    modelTurnIndex: number;
    stepCount: number;
    updatedAt: string;
    error?: string;
    latestResponse?: AgentChatResponse;
    recentSteps?: AgentRunStep[];
  } | null;
  activeToolCall: AgentToolLogEntry | null;
  pendingDurationMs: number | null;
  messageCount: number;
  messages: AgentChatMessage[];
  toolLogs: AgentToolLogEntry[];
  requestTraces: AgentRequestTrace[];
  config: AgentConfig | null;
  configError: string | null;
  lastWarning: string | null;
  pendingPlan: {
    summary: string;
    requiresConfirmation: boolean;
    commands: Array<{
      commandId: string;
      dangerLevel?: AgentDangerLevel;
      reason?: string;
    }>;
  } | null;
  context: {
    loaded: boolean;
    projectTitle?: string;
    pageCount?: number;
    selectedPageId?: string | null;
    objectCount?: number;
    totalObjectCount?: number;
    currentPageObjectCount?: number;
    currentPageId?: string | null;
    pages?: Array<{
      id: string;
      name: string;
      isCurrent: boolean;
      objectCount: number;
    }>;
    imageAssetCount?: number;
    selection?: string | null;
    activeTool?: ToolMode;
    canvasSnapshot?: {
      available: boolean;
      width: number;
      height: number;
      source?: AgentCanvasSnapshot["source"];
      byteLength: number;
      reason?: string;
    };
  };
};
