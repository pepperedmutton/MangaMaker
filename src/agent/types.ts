import type { EditorMultiSelection, EditorSelection, SaveStatus, ToolMode } from "../state/types";

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

export type AgentChatHistory = {
  projectId: string;
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
  agentContext: AgentContextSnapshot;
  harness?: AgentHarnessSnapshot;
  canvasSnapshot?: AgentCanvasSnapshot | null;
  approvedCommandPlan?: AgentCommandPlan | null;
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

export type AgentToolCallRequest = {
  toolName: string;
  input: unknown;
  reason?: string;
};

export type AgentHarnessSnapshot = {
  mode: "tool-harness";
  currentPageId: string | null;
  currentPageMarkedBy: "isCurrent";
  tools: AgentHarnessToolDefinition[];
  initialToolResults: AgentHarnessToolResult[];
  dynamicToolResults?: AgentHarnessToolResult[];
  resourcePolicy: {
    allPagesReadable: boolean;
    assetsReadableOnDemand: boolean;
    inlineDataUrlsRedactedFromPrompt: boolean;
    projectMutationPath: "commandPlanOnly";
  };
};

export type AgentDebugSnapshot = {
  mounted: boolean;
  busy: boolean;
  updatedAt: string;
  activeToolCall: AgentToolLogEntry | null;
  pendingDurationMs: number | null;
  messageCount: number;
  messages: AgentChatMessage[];
  toolLogs: AgentToolLogEntry[];
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
