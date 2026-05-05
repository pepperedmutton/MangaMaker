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
  currentPage: AgentPageSummary | null;
  pages: AgentPageSummary[];
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
  canvasSnapshot?: AgentCanvasSnapshot | null;
  approvedCommandPlan?: AgentCommandPlan | null;
};

export type AgentChatResponse = {
  message: string;
  pendingCommandPlan?: AgentCommandPlan | null;
  toolLogs?: AgentToolLogEntry[];
  error?: string;
  usedVision?: boolean;
  warning?: string;
  visionUnavailableReason?: string;
};
