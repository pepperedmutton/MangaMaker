import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const PROJECTS_DIR_NAME = process.env.MANGAMAKER_PROJECTS_DIR?.trim() || "projects";
const PROJECT_META_FILE = ".latest_project";
const PROJECT_JSON_FILE = "project.json";
const PROJECT_ASSETS_DIR = "assets";
const AGENT_CHAT_HISTORY_FILE = "agent-chat.json";
const API_BASE = "/__mangamaker__/persistence";
const AGENT_API_BASE = "/__mangamaker__/agent";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const AGENT_TEST_MODE = process.env.MANGAMAKER_AGENT_TEST_MODE === "1";
const AUTH_COOKIE_NAME = "mangamaker_auth";
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_LOGIN_PATH = "/__mangamaker__/auth/login";
const AUTH_PASSWORD_SALT_HEX = "7bb08576611b01bf60a7b5cbf93faff7";
const AUTH_PASSWORD_HASH_HEX = "35763c82cb5698b9f3650d71f55a8bfa29cffc119f1459c1de0b6da216eb8e29";
const AUTH_PASSWORD_KEY_LENGTH = 32;
const AUTH_PASSWORD_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;
const AUTH_COOKIE_TOKEN = createHash("sha256")
  .update(`mangamaker:${AUTH_PASSWORD_HASH_HEX}:${AUTH_PASSWORD_SALT_HEX}`)
  .digest("hex");
const AUTH_DISABLED = process.env.MANGAMAKER_DISABLE_AUTH === "1";
const SHARE_ALLOWED_HOSTS = [
  "gradio.live",
  ".gradio.live",
  "gradio-live.com",
  ".gradio-live.com",
  "ngrok-free.app",
  ".ngrok-free.app",
  "ngrok.app",
  ".ngrok.app",
  "ngrok.dev",
  ".ngrok.dev",
  "ngrok.io",
  ".ngrok.io",
];
const renderExternalHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
const envAllowedHosts = String(process.env.MANGAMAKER_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const ALLOWED_HOSTS = Array.from(
  new Set([
    ...SHARE_ALLOWED_HOSTS,
    ...(renderExternalHostname ? [renderExternalHostname] : []),
    ...envAllowedHosts,
  ]),
);

const sanitizePathComponent = (value: string, fallback: string) => {
  const sanitized = value
    .split("")
    .map((char) => (/^[a-zA-Z0-9_-]$/.test(char) ? char : "_"))
    .join("")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : fallback;
};

const ensureProjectsRoot = async () => {
  const root = path.resolve(process.cwd(), PROJECTS_DIR_NAME);
  await fsp.mkdir(root, { recursive: true });
  return root;
};

const readProjectIdFromDir = async (projectDir: string) => {
  const projectFile = path.join(projectDir, PROJECT_JSON_FILE);
  const raw = await fsp.readFile(projectFile, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { id?: unknown };
    if (typeof parsed.id === "string" && parsed.id.trim().length > 0) {
      return parsed.id;
    }
    return null;
  } catch {
    return null;
  }
};

const findProjectDirById = async (root: string, projectId: string) => {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidateDir = path.join(root, entry.name);
    const candidateProjectId = await readProjectIdFromDir(candidateDir);
    if (candidateProjectId === projectId) {
      return candidateDir;
    }
  }
  return null;
};

const pickProjectFolderName = async (
  root: string,
  projectId: string,
  preferredName: string,
) => {
  const baseName = sanitizePathComponent(preferredName, "project");
  let index = 1;
  while (true) {
    const candidateName = index === 1 ? baseName : `${baseName}-${index}`;
    const candidateDir = path.join(root, candidateName);
    const stats = await fsp.stat(candidateDir).catch(() => null);
    if (!stats) {
      return candidateName;
    }
    if (!stats.isDirectory()) {
      index += 1;
      continue;
    }
    const candidateProjectId = await readProjectIdFromDir(candidateDir);
    if (candidateProjectId === projectId) {
      return candidateName;
    }
    index += 1;
  }
};

const resolveProjectDir = async (
  root: string,
  projectId: string,
  projectTitle: string,
) => {
  const existingDir = await findProjectDirById(root, projectId);
  if (existingDir) {
    return existingDir;
  }

  const targetFolder = await pickProjectFolderName(root, projectId, projectTitle);
  return path.join(root, targetFolder);
};

const normalizeProjectAssetPaths = (projectJson: string, projectFolder: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(projectJson);
  } catch {
    return projectJson;
  }

  if (!parsed || typeof parsed !== "object") {
    return projectJson;
  }

  const draft = parsed as {
    pages?: Array<{ panels?: Array<{ image?: { src?: unknown } }> }>;
  };

  if (!Array.isArray(draft.pages)) {
    return projectJson;
  }

  let changed = false;

  for (const page of draft.pages) {
    if (!page || typeof page !== "object" || !Array.isArray(page.panels)) {
      continue;
    }
    for (const panel of page.panels) {
      if (!panel || typeof panel !== "object" || !panel.image || typeof panel.image !== "object") {
        continue;
      }
      const src = panel.image.src;
      if (typeof src !== "string") {
        continue;
      }
      const prefix = "/projects/";
      const assetsSegment = `/${PROJECT_ASSETS_DIR}/`;
      if (!src.startsWith(prefix)) {
        continue;
      }
      const assetsIndex = src.indexOf(assetsSegment, prefix.length);
      if (assetsIndex <= prefix.length) {
        continue;
      }
      const folderInSrc = src.slice(prefix.length, assetsIndex);
      if (!folderInSrc || folderInSrc === projectFolder) {
        continue;
      }
      const assetSuffix = src.slice(assetsIndex + assetsSegment.length);
      panel.image.src = `${prefix}${projectFolder}${assetsSegment}${assetSuffix}`;
      changed = true;
    }
  }

  return changed ? JSON.stringify(parsed) : projectJson;
};

type ProjectAssetReference = {
  sourceFolder: string;
  assetRelativePath: string;
};

const PROJECT_ASSET_PATH_PATTERN = /^\/projects\/([^/]+)\/assets\/(.+)$/;

const extractProjectAssetReferences = (projectJson: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(projectJson);
  } catch {
    return [] as ProjectAssetReference[];
  }

  const seen = new Set<string>();
  const references: ProjectAssetReference[] = [];

  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const match = value.match(PROJECT_ASSET_PATH_PATTERN);
      if (!match) {
        return;
      }
      const sourceFolder = sanitizePathComponent(match[1] ?? "", "");
      if (!sourceFolder) {
        return;
      }
      let assetRelativePath = (match[2] ?? "").trim();
      if (!assetRelativePath) {
        return;
      }
      try {
        assetRelativePath = decodeURIComponent(assetRelativePath);
      } catch {
        // Keep raw path when decoding fails.
      }
      assetRelativePath = assetRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!assetRelativePath) {
        return;
      }
      const key = `${sourceFolder}/${assetRelativePath}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      references.push({
        sourceFolder,
        assetRelativePath,
      });
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    for (const entry of Object.values(value as Record<string, unknown>)) {
      visit(entry);
    }
  };

  visit(parsed);
  return references;
};

const resolvePathInsideRoot = (root: string, relative: string) => {
  const candidate = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!candidate.startsWith(rootWithSep)) {
    return null;
  }
  return candidate;
};

const copyReferencedProjectAssets = async (
  root: string,
  targetProjectFolder: string,
  targetAssetsDir: string,
  references: ProjectAssetReference[],
) => {
  for (const reference of references) {
    if (reference.sourceFolder === targetProjectFolder) {
      continue;
    }
    const sourceAssetsDir = path.join(root, reference.sourceFolder, PROJECT_ASSETS_DIR);
    const sourcePath = resolvePathInsideRoot(sourceAssetsDir, reference.assetRelativePath);
    const targetPath = resolvePathInsideRoot(targetAssetsDir, reference.assetRelativePath);
    if (!sourcePath || !targetPath) {
      continue;
    }
    const sourceStats = await fsp.stat(sourcePath).catch(() => null);
    if (!sourceStats?.isFile()) {
      continue;
    }
    const targetStats = await fsp.stat(targetPath).catch(() => null);
    if (targetStats?.isFile()) {
      continue;
    }
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(sourcePath, targetPath);
  }
};

const findLatestProjectFolder = async (root: string) => {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  let latestFolder: string | null = null;
  let latestModifiedAt = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectFile = path.join(root, entry.name, PROJECT_JSON_FILE);
    const stats = await fsp.stat(projectFile).catch(() => null);
    if (!stats?.isFile()) {
      continue;
    }
    if (stats.mtimeMs > latestModifiedAt) {
      latestModifiedAt = stats.mtimeMs;
      latestFolder = entry.name;
    }
  }

  return latestFolder;
};

const syncLatestProjectMeta = async (root: string) => {
  const latestFolder = await findLatestProjectFolder(root);
  const metaFile = path.join(root, PROJECT_META_FILE);
  if (latestFolder) {
    await fsp.writeFile(metaFile, latestFolder, "utf8");
    return;
  }
  await fsp.rm(metaFile, { force: true });
};

const json = (res: ServerResponse, status: number, payload: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const text = (res: ServerResponse, status: number, body: string) => {
  res.statusCode = status;
  const trimmed = body.trimStart().toLowerCase();
  const isHtml = trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
  res.setHeader("Content-Type", isHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
  res.end(body);
};

const readRawBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const readJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
  const raw = await readRawBody(req);
  if (!raw) {
    throw new Error("Empty request body");
  }
  return JSON.parse(raw) as T;
};

const validateAgentChatHistory = (value: unknown): AgentChatHistory => {
  if (!value || typeof value !== "object") {
    throw new Error("Agent chat history must be an object.");
  }
  const history = value as {
    projectId?: unknown;
    updatedAt?: unknown;
    messages?: unknown;
  };
  if (typeof history.projectId !== "string" || history.projectId.trim().length === 0) {
    throw new Error("Agent chat history projectId must be a non-empty string.");
  }
  if (typeof history.updatedAt !== "string" || history.updatedAt.trim().length === 0) {
    throw new Error("Agent chat history updatedAt must be a non-empty string.");
  }
  if (!Array.isArray(history.messages)) {
    throw new Error("Agent chat history messages must be an array.");
  }
  const messages = history.messages.slice(-200).map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Agent chat history message must be an object.");
    }
    const message = entry as {
      id?: unknown;
      role?: unknown;
      content?: unknown;
      createdAt?: unknown;
    };
    if (typeof message.id !== "string" || message.id.trim().length === 0) {
      throw new Error("Agent chat history message id must be a non-empty string.");
    }
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error("Agent chat history message role must be user or assistant.");
    }
    if (typeof message.content !== "string") {
      throw new Error("Agent chat history message content must be a string.");
    }
    if (typeof message.createdAt !== "string" || message.createdAt.trim().length === 0) {
      throw new Error("Agent chat history message createdAt must be a non-empty string.");
    }
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    } satisfies AgentChatHistory["messages"][number];
  });
  return {
    projectId: history.projectId,
    updatedAt: history.updatedAt,
    messages,
  };
};

const publicProjectRelativePath = (absolutePath: string) =>
  path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");

const resolveAgentChatHistoryFile = async (projectId: string, createProjectDir: boolean) => {
  const root = await ensureProjectsRoot();
  const existingDir = await findProjectDirById(root, projectId);
  const projectDir = existingDir ?? path.join(root, sanitizePathComponent(projectId, "project"));
  if (createProjectDir) {
    await fsp.mkdir(projectDir, { recursive: true });
  }
  return path.join(projectDir, AGENT_CHAT_HISTORY_FILE);
};

const readAgentChatHistoryFile = async (projectId: string): Promise<AgentChatHistory | null> => {
  const historyFile = await resolveAgentChatHistoryFile(projectId, false);
  const raw = await fsp.readFile(historyFile, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  const history = validateAgentChatHistory(JSON.parse(raw));
  return {
    ...history,
    storagePath: publicProjectRelativePath(historyFile),
  };
};

const writeAgentChatHistoryFile = async (history: AgentChatHistory): Promise<AgentChatHistory> => {
  const normalized = validateAgentChatHistory(history);
  const historyFile = await resolveAgentChatHistoryFile(normalized.projectId, true);
  const payload = {
    ...normalized,
    storagePath: publicProjectRelativePath(historyFile),
  };
  await fsp.writeFile(historyFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
};

const deleteAgentChatHistoryFile = async (projectId: string) => {
  const historyFile = await resolveAgentChatHistoryFile(projectId, false);
  await fsp.rm(historyFile, { force: true });
};

type AgentDangerLevel = "safe" | "normal" | "destructive";

type AgentCommandPlanItem = {
  commandId: string;
  payload: unknown;
  reason?: string;
  dangerLevel?: AgentDangerLevel;
};

type AgentCommandPlan = {
  summary: string;
  commands: AgentCommandPlanItem[];
  requiresConfirmation: boolean;
};

type AgentContextPayload = {
  project?: {
    id?: string;
    title?: string;
    type?: string;
    pageCount?: number;
    createdAt?: string;
    updatedAt?: string;
  };
  selectedPageId?: string | null;
  currentPage?: {
    id: string;
    name?: string;
    width?: number;
    height?: number;
    isCurrent?: boolean;
    viewing?: boolean;
    objects?: Array<{
      id: string;
      objectType: "panel" | "text" | "bubble" | "element";
      content?: string;
      hasImage?: boolean;
    }>;
  } | null;
  pages?: Array<{
    id: string;
    name?: string;
    width?: number;
    height?: number;
    background?: string;
    panelCount?: number;
    textCount?: number;
    bubbleCount?: number;
    layerCount?: number;
    isCurrent?: boolean;
    viewing?: boolean;
    objects?: Array<{
      id: string;
      objectType: "panel" | "text" | "bubble" | "element";
      content?: string;
      hasImage?: boolean;
    }>;
  }>;
  selection?: {
    pageId: string;
    objectType: "panel" | "text" | "bubble";
    objectId: string;
  } | null;
  objects?: Array<{
    id: string;
    objectType: "panel" | "text" | "bubble";
    content?: string;
  }>;
  imageAssets?: Array<{ src: string }>;
  commandManifest?: unknown[];
  multiSelection?: unknown[];
  activeTool?: string;
  zoom?: number;
  saveStatus?: unknown;
  canvasSnapshot?: {
    dataUrl?: string | null;
    width?: number;
    height?: number;
    reason?: string;
  };
};

type AgentChatPayload = {
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  agentContext?: AgentContextPayload;
  harness?: {
    initialToolResults?: Array<{ toolName?: string; result?: unknown }>;
    dynamicToolResults?: Array<{ toolName?: string; result?: unknown }>;
  };
  canvasSnapshot?: AgentContextPayload["canvasSnapshot"];
  approvedCommandPlan?: AgentCommandPlan | null;
};

type AgentChatHistory = {
  projectId: string;
  updatedAt: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>;
  storagePath?: string;
};

type OpenRouterModelMetadata = {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
};

type AgentAvailableModel = {
  id: string;
  name: string;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
};

const isAllowedAgentModelProvider = (modelId: string) =>
  modelId.startsWith("deepseek/") || modelId.startsWith("moonshotai/") || modelId.startsWith("~moonshotai/");

const filterAllowedAgentModels = (models: OpenRouterModelMetadata[]): AgentAvailableModel[] =>
  models
    .filter((model) => {
      const inputModalities = model.architecture?.input_modalities ?? [];
      const outputModalities = model.architecture?.output_modalities ?? [];
      const supportedParameters = model.supported_parameters ?? [];
      return (
        isAllowedAgentModelProvider(model.id) &&
        inputModalities.includes("image") &&
        outputModalities.includes("text") &&
        supportedParameters.includes("response_format")
      );
    })
    .map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      contextLength: typeof model.context_length === "number" ? model.context_length : null,
      inputModalities: model.architecture?.input_modalities ?? [],
      outputModalities: model.architecture?.output_modalities ?? [],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

let agentModelsCache: { fetchedAt: number; models: AgentAvailableModel[] } | null = null;
const AGENT_MODELS_CACHE_MS = 5 * 60 * 1000;
let latestAgentDebugSnapshot: unknown = null;

const fetchAllowedAgentModels = async (): Promise<AgentAvailableModel[]> => {
  const now = Date.now();
  if (agentModelsCache && now - agentModelsCache.fetchedAt < AGENT_MODELS_CACHE_MS) {
    return agentModelsCache.models;
  }
  const response = await fetch(OPENROUTER_MODELS_URL);
  if (!response.ok) {
    throw new Error(`Failed to read OpenRouter model metadata (${response.status}).`);
  }
  const payload = (await response.json()) as { data?: OpenRouterModelMetadata[] };
  const models = filterAllowedAgentModels(payload.data ?? []);
  agentModelsCache = { fetchedAt: now, models };
  return models;
};

const getCurrentAgentConfig = async () => {
  const testMode = process.env.MANGAMAKER_AGENT_TEST_MODE === "1";
  const model = process.env.MANGAMAKER_AGENT_MODEL?.trim() || null;
  const apiKeyConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  if (testMode) {
    return {
      enabled: true,
      provider: "test" as const,
      model: model ?? "mangamaker-test-agent",
      apiKeyConfigured,
      testMode: true,
      visionEnabled: true,
    };
  }
  if (!apiKeyConfigured) {
    return {
      enabled: false,
      provider: "unavailable" as const,
      model,
      apiKeyConfigured: false,
      testMode: false,
      visionEnabled: false,
      reason: "OPENROUTER_API_KEY is not configured.",
    };
  }
  if (!model) {
    return {
      enabled: false,
      provider: "unavailable" as const,
      model: null,
      apiKeyConfigured: true,
      testMode: false,
      visionEnabled: false,
      reason: "MANGAMAKER_AGENT_MODEL must be explicitly configured for the multimodal Agent.",
    };
  }
  let availableModels: AgentAvailableModel[];
  try {
    availableModels = await fetchAllowedAgentModels();
  } catch (error) {
    return {
      enabled: false,
      provider: "unavailable" as const,
      model,
      apiKeyConfigured: true,
      testMode: false,
      visionEnabled: false,
      reason: error instanceof Error ? error.message : "Failed to verify OpenRouter model capabilities.",
    };
  }
  if (!availableModels.some((entry) => entry.id === model)) {
    return {
      enabled: false,
      provider: "unavailable" as const,
      model,
      apiKeyConfigured: true,
      testMode: false,
      visionEnabled: false,
      reason:
        "Configured model is not available for MangaMaker Agent. Choose a DeepSeek or Kimi model with image input, text output, and JSON response_format support.",
    };
  }
  return {
    enabled: true,
    provider: "openrouter" as const,
    model,
    apiKeyConfigured: true,
    testMode: false,
    visionEnabled: true,
  };
};

const AGENT_PREVIEW_RENDER_MAX_EDGE = 768;
const AGENT_DETAIL_RENDER_MAX_EDGE = 1280;
const MAX_AGENT_IMAGE_ATTACHMENTS = 8;

const AGENT_SYSTEM_PROMPT = [
  "You are MangaMaker's built-in creator assistance agent.",
  "Manga creation is the human creator's work; you assist with inspection, suggestions, and bounded editor operations.",
  "You operate through a coding-agent-style harness. The initial context is intentionally lightweight: project summary, page index, current-page marker, current selection summary, and tool catalog.",
  "Do not assume all resources were included up front. Decide which project details you need, then request tools such as searchProject, readPage, readPages, listImageAssets, renderPage, renderPages, or listCommandManifest.",
  "All project pages are readable on demand through the harness. The page the creator is currently viewing is marked isCurrent=true.",
  "Do not pretend to have seen a page, asset, or render unless it is present in tool results or attached as vision input.",
  "For broad questions, search first. For page-specific questions, read that page. For several pages, prefer readPages or renderPages in one request instead of one page per round. For visual judgment, render the relevant page or a bounded sample of pages. For edits, read listCommandManifest before returning a command plan.",
  "Visual budget rule: do not request screenshots unless structured tool results are insufficient for the user's question.",
  "Use the cheapest visual path that can answer the question: readPage/readPages first; renderPages with detail=\"preview\" for small page samples; renderPage with crop for local inspection; detail=\"detail\" only for small text, faces, or fine line art.",
  "Do not request high-detail full-page renders for every page. Prefer one bounded sample or a cropped region, and ask the creator to narrow scope when the project is too large.",
  "Image format alone is not a reliable token reducer. Reduce pixels, crop to the relevant region, and avoid sending images that are not needed.",
  "Do not request the same toolName and input again if that tool result is already present in the harness.",
  "If the harness reports toolBudget.exhausted=true or remainingToolCalls=0, stop requesting tools and answer from the gathered evidence. State the limitation if the evidence is incomplete.",
  "If you need to judge a page's composed visual result, request a tool call first: {\"message\":\"I need to inspect the rendered page.\",\"requestedToolCalls\":[{\"toolName\":\"renderPage\",\"input\":{\"pageId\":\"...\",\"detail\":\"preview\"},\"reason\":\"Inspect the composed page render\"}],\"pendingCommandPlan\":null}.",
  "After renderPage returns, compare the screenshot with that page's structured resources and then answer or propose a command plan.",
  "You can modify the project only by returning command plans that use command ids and payloads from the command manifest.",
  "Never claim an edit is complete unless it has been executed by the app.",
  "Do not present yourself as the author, director, artist, or end-to-end creator of the comic.",
  "Destructive or batch operations must be returned as a pending plan that requires confirmation.",
  "Command payloads must match the manifest schema.",
  "Keep natural-language responses concise.",
  "Return JSON only: {\"message\":\"...\",\"requestedToolCalls\":[{\"toolName\":\"renderPage\",\"input\":{\"pageId\":\"...\",\"detail\":\"preview\"},\"reason\":\"...\"}],\"pendingCommandPlan\":null|{\"summary\":\"...\",\"commands\":[{\"commandId\":\"...\",\"payload\":{},\"reason\":\"...\"}],\"requiresConfirmation\":true|false}}.",
].join("\n");

const TEST_AGENT_MODELS: AgentAvailableModel[] = [
  {
    id: "moonshotai/kimi-k2.6",
    name: "MoonshotAI: Kimi K2.6",
    contextLength: 262142,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
  },
];

const redactPromptValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return "[redacted inline image data; use image/resource tools]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactPromptValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "dataUrl" && typeof entry === "string" && entry
          ? "[attached image]"
          : redactPromptValue(entry),
      ]),
    );
  }
  return value;
};

const compactPageForPrompt = (page: NonNullable<AgentContextPayload["pages"]>[number]) => ({
  id: page.id,
  name: page.name,
  width: page.width,
  height: page.height,
  background: page.background,
  panelCount: page.panelCount,
  textCount: page.textCount,
  bubbleCount: page.bubbleCount,
  layerCount: page.layerCount,
  objectCount: page.objects?.length ?? 0,
  hasImages: page.objects?.some((object) => object.objectType === "panel" && object.hasImage) ?? false,
  isCurrent: Boolean(page.isCurrent || page.viewing),
});

const compactAgentContextForPrompt = (context: AgentContextPayload | undefined) => {
  if (!context) {
    return {};
  }
  const pages = context.pages ?? [];
  const currentPage =
    pages.find((page) => page.isCurrent || page.viewing) ??
    (context.currentPage
      ? {
          ...context.currentPage,
          isCurrent: context.currentPage.isCurrent ?? context.currentPage.viewing,
        }
      : null);
  return redactPromptValue({
    project: context.project,
    selectedPageId: context.selectedPageId ?? null,
    currentPage: currentPage ? compactPageForPrompt(currentPage) : null,
    pageIndex: pages.map(compactPageForPrompt),
    selection: context.selection ?? null,
    multiSelectionCount: Array.isArray(context.multiSelection) ? context.multiSelection.length : 0,
    activeTool: context.activeTool ?? null,
    zoom: context.zoom ?? null,
    saveStatus: context.saveStatus ?? null,
    resourceAccess: {
      fullPagesAvailableVia: "readPage",
      multiplePagesAvailableVia: "readPages",
      searchAvailableVia: "searchProject",
      imageAssetsAvailableVia: "listImageAssets",
      pageRendersAvailableVia: "renderPage",
      multiplePageRendersAvailableVia: "renderPages",
      commandManifestAvailableVia: "listCommandManifest",
      currentCanvasSnapshotAttachedInitially: false,
      visionTokenPolicy: {
        initialImagesAttached: false,
        defaultRenderDetail: "preview",
        previewMaxEdge: AGENT_PREVIEW_RENDER_MAX_EDGE,
        detailMaxEdge: AGENT_DETAIL_RENDER_MAX_EDGE,
        maxImageAttachments: MAX_AGENT_IMAGE_ATTACHMENTS,
        cropSupportedBy: "renderPage",
      },
    },
    counts: {
      pages: pages.length,
      imageAssets: context.imageAssets?.length ?? 0,
      commands: context.commandManifest?.length ?? 0,
    },
  });
};

const getLatestUserText = (messages: AgentChatPayload["messages"]) =>
  [...(messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";

const getHarnessToolResults = (harness: AgentChatPayload["harness"]) => [
  ...(harness?.initialToolResults ?? []),
  ...(harness?.dynamicToolResults ?? []),
];

const collectImageDataUrls = (value: unknown): string[] => {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectImageDataUrls);
  }
  const record = value as Record<string, unknown>;
  const ownDataUrl =
    typeof record.dataUrl === "string" && record.dataUrl.startsWith("data:image/")
      ? [record.dataUrl]
      : [];
  return [
    ...ownDataUrl,
    ...Object.entries(record)
      .filter(([key]) => key === "canvasSnapshot" || key === "results")
      .flatMap(([, entry]) => collectImageDataUrls(entry)),
  ];
};

const getHarnessImageDataUrls = (harness: AgentChatPayload["harness"]) =>
  getHarnessToolResults(harness)
    .flatMap((entry) => collectImageDataUrls(entry.result))
    .slice(-MAX_AGENT_IMAGE_ATTACHMENTS);

const getRenderedPageToolResults = (payload: AgentChatPayload) =>
  getHarnessToolResults(payload.harness).filter(
    (entry) => entry.toolName === "renderPage" || entry.toolName === "renderPages",
  );

const hasExhaustedToolBudget = (payload: AgentChatPayload) =>
  getHarnessToolResults(payload.harness).some((entry) => {
    if (entry.toolName !== "toolBudget" || !entry.result || typeof entry.result !== "object") {
      return false;
    }
    return (entry.result as { exhausted?: unknown }).exhausted === true;
  });

const getCurrentPageId = (context: AgentContextPayload) =>
  context.pages?.find((page) => page.isCurrent || page.viewing)?.id ??
  context.selectedPageId ??
  context.pages?.[0]?.id ??
  null;

const getSelectedTextId = (context: AgentContextPayload) => {
  if (context.selection?.objectType === "text") {
    return context.selection.objectId;
  }
  const currentPage = context.pages?.find((page) => page.isCurrent || page.viewing);
  return (
    currentPage?.objects?.find((object) => object.objectType === "text")?.id ??
    context.objects?.find((object) => object.objectType === "text")?.id ??
    null
  );
};

const createPlan = (
  summary: string,
  commands: AgentCommandPlanItem[],
  requiresConfirmation: boolean,
): AgentCommandPlan => ({
  summary,
  commands,
  requiresConfirmation,
});

const createTestAgentResponse = (payload: AgentChatPayload) => {
  const context = payload.agentContext ?? {};
  const pageId = getCurrentPageId(context);
  const latest = getLatestUserText(payload.messages);
  const normalized = latest.toLowerCase();
  const hasVisionInput = getHarnessImageDataUrls(payload.harness).length > 0;
  const renderedPageResults = getRenderedPageToolResults(payload);

  if (hasExhaustedToolBudget(payload)) {
    return {
      message: "I reached the harness tool budget, so I am answering from the pages and resources already inspected.",
      pendingCommandPlan: null,
      usedVision: hasVisionInput,
      warning: "Tool budget reached; answer is based on gathered context only.",
    };
  }

  if (normalized.includes("tool budget loop")) {
    return {
      message: "I need one more tool call.",
      requestedToolCalls: [
        {
          toolName: "readProjectSummary",
          input: {},
          reason: "Simulate a model that keeps requesting tools.",
        },
      ],
      pendingCommandPlan: null,
      usedVision: hasVisionInput,
    };
  }

  if ((normalized.includes("several pages") || normalized.includes("read a few pages")) && renderedPageResults.length === 0 && pageId) {
    const pageIds =
      context.pages
        ?.filter((page) => (page.objects?.length ?? 0) > 0)
        .slice(0, 3)
        .map((page) => page.id) ?? [pageId];
    return {
      message: "I need to inspect a small rendered page sample before summarizing characters and plot.",
      requestedToolCalls: [
        {
          toolName: "renderPages",
          input: { pageIds, detail: "preview" },
          reason: "Inspect several composed page renders and their resources in one harness call.",
        },
      ],
      pendingCommandPlan: null,
      usedVision: hasVisionInput,
    };
  }

  if ((normalized.includes("screenshot tool") || normalized.includes("render page") || latest.includes("截图工具")) && renderedPageResults.length === 0 && pageId) {
    return {
      message: "I need to inspect the composed page render before answering.",
      requestedToolCalls: [
        {
          toolName: "renderPage",
          input: { pageId, detail: "preview" },
          reason: "Inspect this page's final visual render and compare it with the page resources.",
        },
      ],
      pendingCommandPlan: null,
      usedVision: hasVisionInput,
    };
  }

  if (renderedPageResults.length > 0 && (normalized.includes("screenshot tool") || normalized.includes("render page") || latest.includes("截图工具"))) {
    return {
      message: `I inspected ${renderedPageResults.length} rendered page screenshot(s) and the matching page resources.`,
      pendingCommandPlan: null,
      usedVision: true,
    };
  }

  if (renderedPageResults.length > 0 && (normalized.includes("several pages") || normalized.includes("read a few pages"))) {
    return {
      message: `I inspected a rendered sample of ${renderedPageResults.length} page tool result(s) and their matching page resources.`,
      pendingCommandPlan: null,
      usedVision: true,
    };
  }

  if (normalized.includes("vision warning")) {
    return {
      message: "I answered without visual input.",
      pendingCommandPlan: null,
      usedVision: false,
      warning: "Test mode simulated a vision fallback; the canvas image was not used.",
      visionUnavailableReason: "Simulated vision failure.",
    };
  }

  if (
    normalized.includes("title") ||
    normalized.includes("page count") ||
    latest.includes("标题") ||
    latest.includes("页面数量")
  ) {
    return {
      message: `Project "${context.project?.title ?? "Untitled"}" has ${context.project?.pageCount ?? 0} pages.`,
      pendingCommandPlan: null,
      toolLogs: [
        {
          id: `tool-${Date.now()}`,
          label: "readProject",
          status: "success",
          detail: "Read project title and page count.",
          createdAt: new Date().toISOString(),
        },
      ],
      usedVision: hasVisionInput,
    };
  }

  if (latest.includes("图片") || normalized.includes("image")) {
    return {
      message: `I found ${context.imageAssets?.length ?? 0} image assets.`,
      pendingCommandPlan: null,
      usedVision: hasVisionInput,
    };
  }

  if (latest.includes("删除") || latest.includes("清空") || normalized.includes("delete") || normalized.includes("clear")) {
    const targetsPage = latest.includes("页面") || normalized.includes("page");
    const command =
      targetsPage && pageId
        ? {
            commandId: "removePage",
            payload: { pageId },
            reason: "Remove current page.",
            dangerLevel: "safe" as const,
          }
        : context.selection && pageId
        ? {
            commandId: "deleteObject",
            payload: {
              pageId: context.selection.pageId,
              objectType: context.selection.objectType,
              objectId: context.selection.objectId,
            },
            reason: "Delete selected object.",
            dangerLevel: "destructive" as const,
          }
        : null;
    return {
      message: command ? "This is destructive. Please confirm the command plan." : "No page or selected object is available to delete.",
      pendingCommandPlan: command ? createPlan("Destructive delete plan", [command], true) : null,
      usedVision: hasVisionInput,
    };
  }

  if (latest.includes("保存") || normalized.includes("save")) {
    return {
      message: "I prepared a save command.",
      pendingCommandPlan: createPlan(
        "Save the current project",
        [{ commandId: "saveProject", payload: {}, reason: "Save project.", dangerLevel: "normal" }],
        false,
      ),
      usedVision: hasVisionInput,
    };
  }

  if (latest.includes("描边") || normalized.includes("stroke")) {
    const textId = getSelectedTextId(context);
    const widthMatch = latest.match(/(?:宽度|width)\s*[:：]?\s*(\d+(?:\.\d+)?)/i) ?? latest.match(/\b(\d+(?:\.\d+)?)\b/);
    const strokeWidth = widthMatch ? Number(widthMatch[1]) : 4;
    const strokeColor = latest.includes("红") || normalized.includes("red") ? "#ff0000" : "#111111";
    return {
      message: textId && pageId ? "I prepared a text stroke update." : "No text object is available for stroke editing.",
      pendingCommandPlan:
        textId && pageId
          ? createPlan(
              "Update text stroke",
              [
                {
                  commandId: "updateText",
                  payload: { pageId, textId, strokeColor, strokeWidth },
                  reason: "Apply requested text stroke.",
                  dangerLevel: "normal",
                },
              ],
              false,
            )
          : null,
      usedVision: hasVisionInput,
    };
  }

  if (normalized.includes("two panels") || latest.includes("两个分镜") || latest.includes("涓や釜鍒嗛暅")) {
    return {
      message: pageId ? "I prepared two panel creation commands." : "No page is available for panel creation.",
      pendingCommandPlan:
        pageId
          ? createPlan(
              "Create two panels",
              [
                {
                  commandId: "createPanel",
                  payload: { pageId, x: 80, y: 100, width: 280, height: 220 },
                  reason: "Create first requested panel.",
                  dangerLevel: "safe" as const,
                },
                {
                  commandId: "createPanel",
                  payload: { pageId, x: 400, y: 100, width: 280, height: 220 },
                  reason: "Create second requested panel.",
                  dangerLevel: "safe" as const,
                },
              ],
              false,
            )
          : null,
      usedVision: hasVisionInput,
    };
  }

  if (latest.includes("文字") || latest.includes("文本") || normalized.includes("text")) {
    const contentMatch = latest.match(/(?:文字|文本|text)\s*[:：]\s*(.+)$/i);
    const content = contentMatch?.[1]?.trim() || "你好";
    return {
      message: pageId ? "I prepared a text creation command." : "No page is available for text creation.",
      pendingCommandPlan:
        pageId
          ? createPlan(
              "Create one text object",
              [
                {
                  commandId: "createText",
                  payload: { pageId, x: 200, y: 200, content },
                  reason: "Create requested text.",
                  dangerLevel: "normal",
                },
              ],
              false,
            )
          : null,
      usedVision: hasVisionInput,
    };
  }

  if (latest.includes("分镜") || latest.includes("面板") || normalized.includes("panel")) {
    return {
      message: pageId ? "I prepared a panel creation command." : "No page is available for panel creation.",
      pendingCommandPlan:
        pageId
          ? createPlan(
              "Create one panel",
              [
                {
                  commandId: "createPanel",
                  payload: { pageId, x: 120, y: 120, width: 320, height: 260 },
                  reason: "Create requested panel.",
                  dangerLevel: "normal",
                },
              ],
              false,
            )
          : null,
      usedVision: hasVisionInput,
    };
  }

  return {
    message: "I can search the project, read pages on demand, render pages when visual inspection is needed, and prepare command-based edits.",
    pendingCommandPlan: null,
    usedVision: hasVisionInput,
  };
};

const parseModelJson = (content: string) => {
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      return JSON.parse(fenced);
    }
    const objectStart = content.indexOf("{");
    const objectEnd = content.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(content.slice(objectStart, objectEnd + 1));
    }
    throw new Error("The model did not return valid JSON.");
  }
};

const buildOpenRouterMessages = (payload: AgentChatPayload, includeImage: boolean) => {
  const harnessText = payload.harness
    ? `\n\nAgent harness JSON:\n${JSON.stringify(redactPromptValue(payload.harness), null, 2)}`
    : "";
  const contextText = `Agent lightweight context JSON:\n${JSON.stringify(compactAgentContextForPrompt(payload.agentContext), null, 2)}${harnessText}`;
  const imageUrls = getHarnessImageDataUrls(payload.harness);
  const contextContent =
    includeImage && imageUrls.length > 0
      ? [
          { type: "text", text: contextText },
          ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : contextText;
  return [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: contextContent },
    ...(payload.messages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
};

const callOpenRouter = async (payload: AgentChatPayload, includeImage: boolean) => {
  const config = await getCurrentAgentConfig();
  if (!config.enabled || config.provider !== "openrouter" || !config.model) {
    throw new Error(config.reason ?? "Agent is not configured.");
  }
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ""}`,
      "HTTP-Referer": "http://localhost",
      "X-Title": "MangaMaker Agent",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: buildOpenRouterMessages(payload, includeImage),
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter request failed (${response.status}): ${raw.slice(0, 500)}`);
  }
  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("OpenRouter returned invalid JSON.");
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter response did not include assistant content.");
  }
  return {
    ...(parseModelJson(content) as Record<string, unknown>),
    usedVision: includeImage,
  } as {
    message?: unknown;
    pendingCommandPlan?: unknown;
    usedVision?: boolean;
  };
};

type AgentSchemaLoader = () => Promise<{
  validateAgentChatResponse: (value: unknown) => unknown;
}>;

const createDynamicAgentSchemaLoader = (): AgentSchemaLoader => async () => {
  const moduleName = pathToFileURL(path.resolve(process.cwd(), "src/agent/agentResponseSchema.ts")).href;
  return (await import(moduleName)) as {
    validateAgentChatResponse: (value: unknown) => unknown;
  };
};

const normalizeAgentModelResponse = async (value: unknown, loadAgentSchema: AgentSchemaLoader) => {
  const module = await loadAgentSchema();
  return module.validateAgentChatResponse(value);
};

const attachWebAgentMiddleware = (
  middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void },
  loadAgentSchema: AgentSchemaLoader = createDynamicAgentSchemaLoader(),
) => {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const method = req.method?.toUpperCase() ?? "GET";
    const host = req.headers.host;
    const url = new URL(req.url ?? "/", host ? `http://${host}` : "http://localhost");
    const pathname = url.pathname;

    if (!pathname.startsWith(AGENT_API_BASE)) {
      next();
      return;
    }

    try {
      if (method === "GET" && pathname === `${AGENT_API_BASE}/config`) {
        json(res, 200, await getCurrentAgentConfig());
        return;
      }
      if (method === "GET" && pathname === `${AGENT_API_BASE}/models`) {
        json(res, 200, AGENT_TEST_MODE ? TEST_AGENT_MODELS : await fetchAllowedAgentModels());
        return;
      }
      if (method === "GET" && pathname === `${AGENT_API_BASE}/debug`) {
        json(res, 200, latestAgentDebugSnapshot ?? { mounted: false, updatedAt: null });
        return;
      }
      if (method === "POST" && pathname === `${AGENT_API_BASE}/debug`) {
        latestAgentDebugSnapshot = await readJsonBody<unknown>(req);
        json(res, 200, { ok: true });
        return;
      }
      if (pathname === `${AGENT_API_BASE}/history`) {
        const projectId = url.searchParams.get("projectId")?.trim();
        if (method === "GET") {
          if (!projectId) {
            json(res, 400, { error: "projectId query parameter is required." });
            return;
          }
          json(res, 200, await readAgentChatHistoryFile(projectId));
          return;
        }
        if (method === "POST") {
          json(res, 200, await writeAgentChatHistoryFile(await readJsonBody<AgentChatHistory>(req)));
          return;
        }
        if (method === "DELETE") {
          if (!projectId) {
            json(res, 400, { error: "projectId query parameter is required." });
            return;
          }
          await deleteAgentChatHistoryFile(projectId);
          json(res, 200, { ok: true });
          return;
        }
      }
      if (method !== "POST" || pathname !== `${AGENT_API_BASE}/chat`) {
        text(res, 404, "Not Found");
        return;
      }
      const payload = await readJsonBody<AgentChatPayload>(req);
      if (AGENT_TEST_MODE) {
        json(res, 200, await normalizeAgentModelResponse(createTestAgentResponse(payload), loadAgentSchema));
        return;
      }
      const config = await getCurrentAgentConfig();
      if (!config.enabled) {
        json(res, 503, { message: "Agent unavailable.", error: config.reason ?? "Agent is not configured.", pendingCommandPlan: null });
        return;
      }
      const hasHarnessImage = getHarnessImageDataUrls(payload.harness).length > 0;
      json(res, 200, await normalizeAgentModelResponse(await callOpenRouter(payload, hasHarnessImage && config.visionEnabled), loadAgentSchema));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { message: "Agent request failed.", error: message, pendingCommandPlan: null });
    }
  };

  middlewares.use(handler);
};

const requestExpectsJson = (req: IncomingMessage, pathname: string) => {
  const accept = String(req.headers.accept ?? "").toLowerCase();
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  return pathname.startsWith(API_BASE) || pathname.startsWith(AGENT_API_BASE) || accept.includes("application/json") || contentType.includes("application/json");
};

const parseCookies = (req: IncomingMessage) => {
  const raw = String(req.headers.cookie ?? "");
  if (!raw) {
    return new Map<string, string>();
  }
  const cookies = new Map<string, string>();
  const entries = raw.split(";");
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (!name) {
      continue;
    }
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
};

const isSecureRequest = (req: IncomingMessage) => {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === "https") {
    return true;
  }
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted;
  return encrypted === true;
};

const buildAuthCookie = (req: IncomingMessage) => {
  const attributes = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(AUTH_COOKIE_TOKEN)}`,
    "Path=/",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecureRequest(req)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
};

const hasValidAuthCookie = (req: IncomingMessage) => {
  const cookies = parseCookies(req);
  const token = cookies.get(AUTH_COOKIE_NAME);
  if (!token) {
    return false;
  }
  const expected = Buffer.from(AUTH_COOKIE_TOKEN, "utf8");
  const received = Buffer.from(token, "utf8");
  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(received, expected);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeNextPath = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return "/";
  }
  if (normalized.startsWith(AUTH_LOGIN_PATH)) {
    return "/";
  }
  return normalized;
};

const renderPasswordLoginPage = (nextPath: string, errorMessage?: string | null) => {
  const errorBlock = errorMessage
    ? `<p class="auth-error">${escapeHtml(errorMessage)}</p>`
    : "";
  const escapedNext = escapeHtml(nextPath);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MangaMaker 登录</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: "Source Han Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
        background: radial-gradient(circle at 20% 20%, #efe9dc 0%, #e1d3bd 48%, #cfb18c 100%);
        color: #2d241b;
      }
      .auth-card {
        width: min(420px, calc(100vw - 32px));
        padding: 28px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 18px 42px rgba(45, 36, 27, 0.22);
      }
      h1 {
        margin: 0 0 6px;
        font-size: 26px;
      }
      p {
        margin: 0 0 18px;
        color: #5c4a3a;
      }
      label {
        display: block;
        margin: 0 0 10px;
        font-weight: 600;
      }
      input[type="password"] {
        width: 100%;
        border: 1px solid #b89a7b;
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 16px;
        outline: none;
      }
      input[type="password"]:focus {
        border-color: #8f5b2f;
        box-shadow: 0 0 0 2px rgba(143, 91, 47, 0.15);
      }
      button {
        margin-top: 14px;
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 16px;
        font-weight: 700;
        color: #fff;
        background: linear-gradient(135deg, #8f5b2f, #6f4a2c);
        cursor: pointer;
      }
      .auth-error {
        margin: 0 0 12px;
        color: #b42318;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main class="auth-card">
      <h1>MangaMaker</h1>
      <p>请输入访问密码</p>
      ${errorBlock}
      <form method="post" action="${AUTH_LOGIN_PATH}">
        <input type="hidden" name="next" value="${escapedNext}" />
        <label for="password">密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">登录</button>
      </form>
    </main>
  </body>
</html>`;
};

const readLoginPayload = async (req: IncomingMessage) => {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  const raw = await readRawBody(req);
  if (!raw) {
    return { password: "", next: "/" };
  }
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(raw) as { password?: unknown; next?: unknown };
    return {
      password: typeof parsed.password === "string" ? parsed.password : "",
      next: normalizeNextPath(typeof parsed.next === "string" ? parsed.next : "/"),
    };
  }
  const params = new URLSearchParams(raw);
  return {
    password: String(params.get("password") ?? ""),
    next: normalizeNextPath(params.get("next")),
  };
};

const appendCookieHeader = (res: ServerResponse, cookie: string) => {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current.map(String), cookie]);
    return;
  }
  res.setHeader("Set-Cookie", [String(current), cookie]);
};

const clearAuthCookie = (req: IncomingMessage) => {
  const attributes = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecureRequest(req)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
};

const redirect = (res: ServerResponse, location: string) => {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
};

const isValidAuthPassword = (password: string) => {
  const expected = Buffer.from(AUTH_PASSWORD_HASH_HEX, "hex");
  if (expected.length !== AUTH_PASSWORD_KEY_LENGTH) {
    return false;
  }
  let received: Buffer;
  try {
    received = scryptSync(
      password,
      Buffer.from(AUTH_PASSWORD_SALT_HEX, "hex"),
      AUTH_PASSWORD_KEY_LENGTH,
      AUTH_PASSWORD_SCRYPT_OPTIONS,
    );
  } catch {
    return false;
  }
  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(received, expected);
};

const attachWebAuthMiddleware = (
  middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void },
) => {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const method = req.method?.toUpperCase() ?? "GET";
    const host = req.headers.host;
    const url = new URL(req.url ?? "/", host ? `http://${host}` : "http://localhost");
    const pathname = url.pathname;

    if (pathname === `${API_BASE}/health`) {
      next();
      return;
    }

    if (AUTH_DISABLED) {
      next();
      return;
    }

    if (pathname === AUTH_LOGIN_PATH && method === "GET") {
      if (hasValidAuthCookie(req)) {
        redirect(res, normalizeNextPath(url.searchParams.get("next")));
        return;
      }
      text(res, 200, renderPasswordLoginPage(normalizeNextPath(url.searchParams.get("next"))));
      return;
    }

    if (pathname === AUTH_LOGIN_PATH && method === "POST") {
      const payload = await readLoginPayload(req);
      const nextPath = normalizeNextPath(payload.next);
      if (isValidAuthPassword(payload.password)) {
        appendCookieHeader(res, buildAuthCookie(req));
        if (requestExpectsJson(req, pathname)) {
          json(res, 200, { ok: true, next: nextPath });
          return;
        }
        redirect(res, nextPath);
        return;
      }
      appendCookieHeader(res, clearAuthCookie(req));
      if (requestExpectsJson(req, pathname)) {
        json(res, 401, { error: "Invalid password" });
        return;
      }
      text(res, 401, renderPasswordLoginPage(nextPath, "密码错误，请重试。"));
      return;
    }

    if (hasValidAuthCookie(req)) {
      next();
      return;
    }

    const nextPath = normalizeNextPath(`${pathname}${url.search}`);
    const loginUrl = `${AUTH_LOGIN_PATH}?next=${encodeURIComponent(nextPath)}`;

    if (requestExpectsJson(req, pathname) || method !== "GET") {
      json(res, 401, {
        error: "Authentication required",
        login: loginUrl,
      });
      return;
    }

    redirect(res, loginUrl);
  };

  middlewares.use(handler);
};

const inferContentType = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
};

const attachWebPersistenceMiddleware = (
  middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void },
  closeHandlers: Array<() => void>,
) => {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const method = req.method?.toUpperCase() ?? "GET";
    const host = req.headers.host;
    const url = new URL(req.url ?? "/", host ? `http://${host}` : "http://localhost");
    const pathname = url.pathname;

    try {
      if (method === "GET" && pathname.startsWith("/projects/")) {
        const root = await ensureProjectsRoot();
        const relative = decodeURIComponent(pathname.slice("/projects/".length));
        const candidate = path.resolve(root, relative);
        const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
        if (!candidate.startsWith(rootWithSep)) {
          text(res, 403, "Forbidden");
          return;
        }
        const stats = await fsp.stat(candidate).catch(() => null);
        if (!stats || !stats.isFile()) {
          next();
          return;
        }
        const stream = fs.createReadStream(candidate);
        res.statusCode = 200;
        res.setHeader("Content-Type", inferContentType(candidate));
        stream.pipe(res);
        return;
      }

      if (!pathname.startsWith(API_BASE)) {
        next();
        return;
      }

      const root = await ensureProjectsRoot();

      if (method === "GET" && pathname === `${API_BASE}/health`) {
        json(res, 200, { ok: true });
        return;
      }

      if (method === "POST" && pathname === `${API_BASE}/write_project_draft`) {
        const payload = await readJsonBody<{
          project_id: string;
          project_title?: string;
          project_json: string;
        }>(req);
        let titleFromJson = "";
        try {
          const parsed = JSON.parse(payload.project_json) as { title?: unknown };
          if (typeof parsed.title === "string") {
            titleFromJson = parsed.title.trim();
          }
        } catch {
          titleFromJson = "";
        }
        const projectTitle =
          titleFromJson ||
          (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
          payload.project_id;
        const projectDir = await resolveProjectDir(root, payload.project_id, projectTitle);
        const projectFolder = path.basename(projectDir);
        const assetsDir = path.join(projectDir, PROJECT_ASSETS_DIR);
        await fsp.mkdir(assetsDir, { recursive: true });
        const assetReferences = extractProjectAssetReferences(payload.project_json);
        await copyReferencedProjectAssets(root, projectFolder, assetsDir, assetReferences);
        const normalizedProjectJson = normalizeProjectAssetPaths(payload.project_json, projectFolder);
        await fsp.writeFile(path.join(projectDir, PROJECT_JSON_FILE), normalizedProjectJson, "utf8");
        await fsp.writeFile(path.join(root, PROJECT_META_FILE), projectFolder, "utf8");
        json(res, 200, { path: `/projects/${projectFolder}/${PROJECT_JSON_FILE}` });
        return;
      }

      if (method === "GET" && pathname === `${API_BASE}/read_project_draft`) {
        const metaFile = path.join(root, PROJECT_META_FILE);
        const metaExists = await fsp.stat(metaFile).catch(() => null);
        if (!metaExists?.isFile()) {
          json(res, 200, { project_json: null });
          return;
        }
        const latestProject = (await fsp.readFile(metaFile, "utf8")).trim();
        const folder = sanitizePathComponent(latestProject, "project");
        const projectFile = path.join(root, folder, PROJECT_JSON_FILE);
        const projectExists = await fsp.stat(projectFile).catch(() => null);
        if (!projectExists?.isFile()) {
          json(res, 200, { project_json: null });
          return;
        }
        const projectJson = await fsp.readFile(projectFile, "utf8");
        const normalizedProjectJson = normalizeProjectAssetPaths(projectJson, folder);
        if (normalizedProjectJson !== projectJson) {
          await fsp.writeFile(projectFile, normalizedProjectJson, "utf8");
        }
        json(res, 200, { project_json: normalizedProjectJson });
        return;
      }

      if (method === "GET" && pathname === `${API_BASE}/list_project_drafts`) {
        const entries = await fsp.readdir(root, { withFileTypes: true });
        const drafts: Array<{ modifiedAt: number; projectJson: string }> = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }
          const projectFile = path.join(root, entry.name, PROJECT_JSON_FILE);
          const stats = await fsp.stat(projectFile).catch(() => null);
          if (!stats?.isFile()) {
            continue;
          }
          const projectJson = await fsp.readFile(projectFile, "utf8");
          const normalizedProjectJson = normalizeProjectAssetPaths(projectJson, entry.name);
          if (normalizedProjectJson !== projectJson) {
            await fsp.writeFile(projectFile, normalizedProjectJson, "utf8");
          }
          drafts.push({ modifiedAt: stats.mtimeMs, projectJson: normalizedProjectJson });
        }
        drafts.sort((a, b) => b.modifiedAt - a.modifiedAt);
        json(res, 200, { projects: drafts.map((entry) => entry.projectJson) });
        return;
      }

      if (method === "POST" && pathname === `${API_BASE}/save_imported_image`) {
        const payload = await readJsonBody<{
          project_id: string;
          project_title?: string;
          original_file_name: string;
          bytes: number[];
        }>(req);
        const projectTitle =
          (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
          payload.project_id;
        const projectDir = await resolveProjectDir(root, payload.project_id, projectTitle);
        const projectFolder = path.basename(projectDir);
        const assetsDir = path.join(projectDir, PROJECT_ASSETS_DIR);
        await fsp.mkdir(assetsDir, { recursive: true });

        const originalPath = path.parse(payload.original_file_name);
        const stem = sanitizePathComponent(originalPath.name, "image");
        const ext = sanitizePathComponent((originalPath.ext || ".bin").replace(/^\./, ""), "bin").toLowerCase();
        const timestamp = Date.now();
        let index = 0;
        let fileName = `${stem}-${timestamp}.${ext}`;
        let assetPath = path.join(assetsDir, fileName);
        while (await fsp.stat(assetPath).then(() => true).catch(() => false)) {
          index += 1;
          fileName = `${stem}-${timestamp}-${index}.${ext}`;
          assetPath = path.join(assetsDir, fileName);
        }

        await fsp.writeFile(assetPath, Buffer.from(payload.bytes));
        json(res, 200, { path: `/projects/${projectFolder}/${PROJECT_ASSETS_DIR}/${fileName}` });
        return;
      }

      if (method === "POST" && pathname === `${API_BASE}/delete_project_draft`) {
        const payload = await readJsonBody<{ project_id: string }>(req);
        const projectDir = await findProjectDirById(root, payload.project_id);
        if (projectDir) {
          await fsp.rm(projectDir, { recursive: true, force: true });
        }
        await syncLatestProjectMeta(root);
        json(res, 200, { ok: true });
        return;
      }

      text(res, 404, "Not Found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { error: message });
    }
  };

  middlewares.use(handler);
  closeHandlers.push(() => {
    // connect does not expose remove; process lifetime cleanup is sufficient.
  });
};

const webPersistencePlugin = () => ({
  name: "mangamaker-web-persistence",
  configureServer(server: ViteDevServer) {
    const closeHandlers: Array<() => void> = [];
    attachWebPersistenceMiddleware(server.middlewares, closeHandlers);
    server.httpServer?.once("close", () => closeHandlers.forEach((close) => close()));
  },
  configurePreviewServer(server: PreviewServer) {
    const closeHandlers: Array<() => void> = [];
    attachWebPersistenceMiddleware(server.middlewares, closeHandlers);
    server.httpServer?.once("close", () => closeHandlers.forEach((close) => close()));
  },
});

const webAuthPlugin = () => ({
  name: "mangamaker-web-auth",
  configureServer(server: ViteDevServer) {
    attachWebAuthMiddleware(server.middlewares);
  },
  configurePreviewServer(server: PreviewServer) {
    attachWebAuthMiddleware(server.middlewares);
  },
});

const webAgentPlugin = () => ({
  name: "mangamaker-agent-proxy",
  configureServer(server: ViteDevServer) {
    attachWebAgentMiddleware(server.middlewares, async () =>
      server.ssrLoadModule("/src/agent/agentResponseSchema.ts") as Promise<{
        validateAgentChatResponse: (value: unknown) => unknown;
      }>,
    );
  },
  configurePreviewServer(server: PreviewServer) {
    attachWebAgentMiddleware(server.middlewares);
  },
});

export default defineConfig({
  plugins: [react(), webAuthPlugin(), webAgentPlugin(), webPersistencePlugin()],
  server: {
    allowedHosts: ALLOWED_HOSTS,
  },
  preview: {
    allowedHosts: ALLOWED_HOSTS,
  },
});
