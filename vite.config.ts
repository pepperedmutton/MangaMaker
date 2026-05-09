import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import {
  AGENT_DEFAULT_DOCUMENT_DEFINITIONS,
  agentDocumentManifestSchema,
  agentDocumentMetaSchema,
  agentDocumentSchema,
  agentDocumentFromMarkdown,
  buildAgentDocumentMarkdown,
  createDefaultAgentRolesForDocuments,
  createAgentDocumentMeta,
  type AgentDocument,
  type AgentDocumentManifest,
  type AgentDocumentMeta,
} from "./src/agent/documentSchema";
import {
  agentRoleDefinitionSchema,
  createAgentRoleId,
  getAgentRole,
  type AgentRoleDefinition,
} from "./src/agent/roles";
import {
  AGENT_PROTOCOL_SYSTEM_PROMPT,
  DEFAULT_AGENT_SYSTEM_PROMPT,
  normalizeAgentSystemPrompt,
} from "./src/agent/systemPrompt";
import {
  OpenRouterNonJsonResponseError,
  extractOpenRouterAssistantContent,
  parseOpenRouterResponseJson,
} from "./src/agent/openRouterResponse";
import {
  getOpenRouterFallbackProviderRouting,
  getOpenRouterProviderRouting,
  type OpenRouterProviderRouting,
} from "./src/agent/openRouterProviderRouting";

const PROJECTS_DIR_NAME = process.env.MANGAMAKER_PROJECTS_DIR?.trim() || "projects";
const PROJECT_META_FILE = ".latest_project";
const PROJECT_JSON_FILE = "project.json";
const PROJECT_ASSETS_DIR = "assets";
const AGENT_CONVERSATION_CONTEXT_FILE = "agent-conversation-context.json";
const LEGACY_AGENT_CHAT_HISTORY_FILE = "agent-chat.json";
const DEFAULT_AGENT_CONVERSATION_ROLE_ID = "assistant";
const AGENT_DOCS_DIR = "docs";
const AGENT_DOCS_MANIFEST_FILE = "manifest.json";
const AGENT_DOCS_OPERATIONS_FILE = ".agent-document-operations.json";
const AGENT_RUNS_DIR = "agent-runs";
const AGENT_RUN_FILE = "run.json";
const API_BASE = "/__mangamaker__/persistence";
const AGENT_API_BASE = "/__mangamaker__/agent";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const AGENT_TEST_MODE = process.env.MANGAMAKER_AGENT_TEST_MODE === "1";
const parsePositiveIntegerEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};
const OPENROUTER_REQUEST_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.MANGAMAKER_OPENROUTER_TIMEOUT_MS, 120000);
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

const writeFileAtomically = async (filePath: string, contents: string) => {
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true });
  const tempFile = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await fsp.writeFile(tempFile, contents, "utf8");
    await fsp.rename(tempFile, filePath);
  } catch (error) {
    await fsp.rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
};

const validateAgentConversationContext = (
  value: unknown,
  fallback: { projectId?: string; roleId?: string } = {},
): AgentConversationContext => {
  if (!value || typeof value !== "object") {
    throw new Error("Agent conversation context must be an object.");
  }
  const context = value as {
    projectId?: unknown;
    roleId?: unknown;
    updatedAt?: unknown;
    messages?: unknown;
  };
  const projectId = typeof context.projectId === "string" ? context.projectId.trim() : fallback.projectId ?? "";
  const roleId = typeof context.roleId === "string" ? context.roleId.trim() : fallback.roleId ?? "";
  if (projectId.length === 0) {
    throw new Error("Agent conversation context projectId must be a non-empty string.");
  }
  if (roleId.length === 0) {
    throw new Error("Agent conversation context roleId must be a non-empty string.");
  }
  if (typeof context.updatedAt !== "string" || context.updatedAt.trim().length === 0) {
    throw new Error("Agent conversation context updatedAt must be a non-empty string.");
  }
  if (!Array.isArray(context.messages)) {
    throw new Error("Agent conversation context messages must be an array.");
  }
  const messages = context.messages.slice(-200).map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Agent conversation context message must be an object.");
    }
    const message = entry as {
      id?: unknown;
      role?: unknown;
      content?: unknown;
      createdAt?: unknown;
    };
    if (typeof message.id !== "string" || message.id.trim().length === 0) {
      throw new Error("Agent conversation context message id must be a non-empty string.");
    }
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error("Agent conversation context message role must be user or assistant.");
    }
    if (typeof message.content !== "string") {
      throw new Error("Agent conversation context message content must be a string.");
    }
    if (typeof message.createdAt !== "string" || message.createdAt.trim().length === 0) {
      throw new Error("Agent conversation context message createdAt must be a non-empty string.");
    }
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    } satisfies AgentConversationContext["messages"][number];
  });
  return {
    projectId,
    roleId,
    updatedAt: context.updatedAt,
    messages,
  };
};

const normalizeAgentConversationContextStore = (
  value: unknown,
  projectId: string,
): AgentConversationContextStore => {
  const now = new Date().toISOString();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { projectId, updatedAt: now, contexts: [] };
  }
  const record = value as { projectId?: unknown; updatedAt?: unknown; contexts?: unknown };
  const contexts = Array.isArray(record.contexts)
    ? record.contexts
    : [record];
  const deduped = new Map<string, AgentConversationContext>();
  for (const entry of contexts) {
    const entryRecord = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as { roleId?: unknown }
      : {};
    const roleId =
      typeof entryRecord.roleId === "string" && entryRecord.roleId.trim().length > 0
        ? entryRecord.roleId.trim()
        : DEFAULT_AGENT_CONVERSATION_ROLE_ID;
    const context = validateAgentConversationContext(entry, { projectId, roleId });
    if (context.projectId === projectId) {
      deduped.set(context.roleId, context);
    }
  }
  return {
    projectId,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
      ? record.updatedAt
      : now,
    contexts: Array.from(deduped.values()).sort((left, right) => left.roleId.localeCompare(right.roleId)),
  };
};

const publicProjectRelativePath = (absolutePath: string) =>
  path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");

const resolveAgentConversationContextFile = async (
  projectId: string,
  createProjectDir: boolean,
  fileName = AGENT_CONVERSATION_CONTEXT_FILE,
) => {
  const root = await ensureProjectsRoot();
  const existingDir = await findProjectDirById(root, projectId);
  const projectDir = existingDir ?? path.join(root, sanitizePathComponent(projectId, "project"));
  if (createProjectDir) {
    await fsp.mkdir(projectDir, { recursive: true });
  }
  return path.join(projectDir, fileName);
};

const readAgentConversationContextStoreFile = async (
  projectId: string,
): Promise<{ contextFile: string; store: AgentConversationContextStore; legacy: boolean }> => {
  const contextFile = await resolveAgentConversationContextFile(projectId, false);
  const raw = await fsp.readFile(contextFile, "utf8").catch(() => null);
  if (raw) {
    return {
      contextFile,
      store: normalizeAgentConversationContextStore(JSON.parse(raw), projectId),
      legacy: false,
    };
  }
  const legacyFile = await resolveAgentConversationContextFile(projectId, false, LEGACY_AGENT_CHAT_HISTORY_FILE);
  const legacyRaw = await fsp.readFile(legacyFile, "utf8").catch(() => null);
  if (legacyRaw) {
    return {
      contextFile: legacyFile,
      store: normalizeAgentConversationContextStore(JSON.parse(legacyRaw), projectId),
      legacy: true,
    };
  }
  return {
    contextFile,
    store: { projectId, updatedAt: new Date().toISOString(), contexts: [] },
    legacy: false,
  };
};

const readAgentConversationContextFile = async (
  projectId: string,
  roleId: string,
): Promise<AgentConversationContext | null> => {
  const { contextFile, store } = await readAgentConversationContextStoreFile(projectId);
  const context = store.contexts.find((entry) => entry.roleId === roleId) ?? null;
  if (!context) {
    return null;
  }
  return {
    ...context,
    storagePath: publicProjectRelativePath(contextFile),
  };
};

const writeAgentConversationContextStoreFile = async (
  projectId: string,
  store: AgentConversationContextStore,
) => {
  const contextFile = await resolveAgentConversationContextFile(projectId, true);
  const payload = {
    projectId,
    updatedAt: new Date().toISOString(),
    contexts: store.contexts
      .map((context) => validateAgentConversationContext(context, { projectId, roleId: context.roleId }))
      .sort((left, right) => left.roleId.localeCompare(right.roleId)),
  };
  await fsp.writeFile(contextFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const legacyFile = await resolveAgentConversationContextFile(
    projectId,
    false,
    LEGACY_AGENT_CHAT_HISTORY_FILE,
  );
  await fsp.rm(legacyFile, { force: true }).catch(() => undefined);
  return {
    contextFile,
    store: payload,
  };
};

const writeAgentConversationContextFile = async (
  context: AgentConversationContext,
): Promise<AgentConversationContext> => {
  const normalized = validateAgentConversationContext(context, {
    roleId: DEFAULT_AGENT_CONVERSATION_ROLE_ID,
  });
  const { store } = await readAgentConversationContextStoreFile(normalized.projectId);
  const contexts = store.contexts.filter((entry) => entry.roleId !== normalized.roleId).concat(normalized);
  const written = await writeAgentConversationContextStoreFile(normalized.projectId, {
    projectId: normalized.projectId,
    updatedAt: new Date().toISOString(),
    contexts,
  });
  return {
    ...normalized,
    storagePath: publicProjectRelativePath(written.contextFile),
  };
};

const deleteAgentConversationContextFile = async (projectId: string, roleId: string) => {
  const { store } = await readAgentConversationContextStoreFile(projectId);
  const contexts = store.contexts.filter((entry) => entry.roleId !== roleId);
  if (contexts.length === 0) {
    const contextFile = await resolveAgentConversationContextFile(projectId, false);
    const legacyFile = await resolveAgentConversationContextFile(projectId, false, LEGACY_AGENT_CHAT_HISTORY_FILE);
    await Promise.all([
      fsp.rm(contextFile, { force: true }),
      fsp.rm(legacyFile, { force: true }),
    ]);
    return;
  }
  await writeAgentConversationContextStoreFile(projectId, {
    projectId,
    updatedAt: new Date().toISOString(),
    contexts,
  });
};

const resolveProjectDirById = async (projectId: string, createProjectDir: boolean) => {
  const root = await ensureProjectsRoot();
  const existingDir = await findProjectDirById(root, projectId);
  const projectDir = existingDir ?? path.join(root, sanitizePathComponent(projectId, "project"));
  if (createProjectDir) {
    await fsp.mkdir(projectDir, { recursive: true });
  }
  return projectDir;
};

const normalizeAgentDocumentPath = (value: string, fallbackId: string) => {
  const raw = value.trim() || `${AGENT_DOCS_DIR}/${sanitizePathComponent(fallbackId, "document")}.md`;
  const withForwardSlashes = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = path.posix.normalize(withForwardSlashes);
  if (
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.posix.isAbsolute(normalized) ||
    !normalized.startsWith(`${AGENT_DOCS_DIR}/`) ||
    !normalized.toLowerCase().endsWith(".md")
  ) {
    throw new Error("Agent document path must stay under docs/ and end with .md.");
  }
  return normalized;
};

const resolvePathInsideProjectDir = (projectDir: string, relativePath: string) => {
  const candidate = path.resolve(projectDir, relativePath);
  const rootWithSep = projectDir.endsWith(path.sep) ? projectDir : `${projectDir}${path.sep}`;
  if (!candidate.startsWith(rootWithSep)) {
    throw new Error("Resolved Agent document path escaped the project directory.");
  }
  return candidate;
};

const resolveAgentDocsManifestFile = async (projectId: string, createProjectDir: boolean) => {
  const projectDir = await resolveProjectDirById(projectId, createProjectDir);
  if (createProjectDir) {
    await fsp.mkdir(path.join(projectDir, AGENT_DOCS_DIR), { recursive: true });
  }
  return path.join(projectDir, AGENT_DOCS_DIR, AGENT_DOCS_MANIFEST_FILE);
};

const readRawAgentDocumentManifestFile = async (projectId: string): Promise<AgentDocumentManifest | null> => {
  const manifestFile = await resolveAgentDocsManifestFile(projectId, false);
  const raw = await fsp.readFile(manifestFile, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  return agentDocumentManifestSchema.parse(JSON.parse(raw));
};

const writeAgentDocumentManifestFile = async (manifest: AgentDocumentManifest) => {
  const normalized = agentDocumentManifestSchema.parse(manifest);
  const manifestFile = await resolveAgentDocsManifestFile(normalized.projectId, true);
  await writeFileAtomically(manifestFile, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
};

const normalizeAgentRolesForDocuments = (
  roles: AgentRoleDefinition[],
  documents: AgentDocumentMeta[],
) => {
  const documentIds = new Set(documents.map((document) => document.id));
  const usedRoleIds = new Set<string>();
  const usedMetadocIds = new Set<string>();
  const normalizedRoles: AgentRoleDefinition[] = [];
  for (const role of roles) {
    if (
      usedRoleIds.has(role.id) ||
      !documentIds.has(role.metadocId) ||
      usedMetadocIds.has(role.metadocId)
    ) {
      continue;
    }
    normalizedRoles.push(agentRoleDefinitionSchema.parse(role));
    usedRoleIds.add(role.id);
    usedMetadocIds.add(role.metadocId);
  }
  return normalizedRoles.sort((left, right) => left.name.localeCompare(right.name));
};

const createDefaultAgentRoleList = (documents: AgentDocumentMeta[]) =>
  normalizeAgentRolesForDocuments(createDefaultAgentRolesForDocuments(documents), documents);

const ensureProjectDocuments = async (projectId: string): Promise<AgentDocumentManifest> => {
  const now = new Date().toISOString();
  const projectDir = await resolveProjectDirById(projectId, true);
  await fsp.mkdir(path.join(projectDir, AGENT_DOCS_DIR), { recursive: true });
  const existingManifest = await readRawAgentDocumentManifestFile(projectId).catch(() => null);
  const documentMap = new Map<string, AgentDocumentMeta>();
  for (const document of existingManifest?.documents ?? []) {
    const meta = agentDocumentMetaSchema.parse({
      ...document,
      path: normalizeAgentDocumentPath(document.path, document.id),
    });
    documentMap.set(meta.id, meta);
  }

  let changed = !existingManifest;
  if (!existingManifest) {
    for (const definition of AGENT_DEFAULT_DOCUMENT_DEFINITIONS) {
      const meta = createAgentDocumentMeta(definition, now);
      documentMap.set(meta.id, meta);
      const documentPath = resolvePathInsideProjectDir(
        projectDir,
        normalizeAgentDocumentPath(meta.path, meta.id),
      );
      const stats = await fsp.stat(documentPath).catch(() => null);
      if (!stats?.isFile()) {
        await fsp.mkdir(path.dirname(documentPath), { recursive: true });
        await fsp.writeFile(documentPath, `${buildAgentDocumentMarkdown(meta, definition.body)}\n`, "utf8");
      }
    }
  }

  const documents = Array.from(documentMap.values()).sort((left, right) => left.path.localeCompare(right.path));
  const existingRoles = existingManifest?.roles ?? [];
  const roles =
    existingManifest && existingManifest.roleSetupVersion > 0
      ? normalizeAgentRolesForDocuments(existingRoles, documents)
      : createDefaultAgentRoleList(documents);
  if (
    existingManifest &&
    (existingManifest.roleSetupVersion === 0 ||
      existingRoles.length !== roles.length ||
      JSON.stringify(existingRoles) !== JSON.stringify(roles))
  ) {
    changed = true;
  }

  const manifest = agentDocumentManifestSchema.parse({
    projectId,
    updatedAt: existingManifest?.updatedAt ?? now,
    roleSetupVersion: 1,
    documents,
    roles,
  });
  if (changed) {
    return writeAgentDocumentManifestFile({ ...manifest, updatedAt: now });
  }
  return manifest;
};

const normalizeAgentDocumentLookup = (value: string) =>
  value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");

const stripMarkdownExtension = (value: string) =>
  value.toLowerCase().endsWith(".md") ? value.slice(0, -3) : value;

const describeAgentDocumentLookupOptions = (manifest: AgentDocumentManifest) => {
  const options = manifest.documents
    .slice(0, 12)
    .map((document) => `${document.id} (${document.path})`)
    .join(", ");
  return options.length > 0
    ? ` Available documents: ${options}${manifest.documents.length > 12 ? ", ..." : ""}`
    : "";
};

const resolveAgentDocumentMeta = (
  manifest: AgentDocumentManifest,
  documentLookup: string,
): AgentDocumentMeta => {
  const trimmed = documentLookup.trim();
  if (!trimmed) {
    throw new Error(`Agent document id/path/title is required.${describeAgentDocumentLookupOptions(manifest)}`);
  }
  const normalized = normalizeAgentDocumentLookup(trimmed);
  const normalizedLower = normalized.toLowerCase();
  const normalizedWithoutDocsPrefix = normalizedLower.startsWith(`${AGENT_DOCS_DIR}/`)
    ? normalizedLower.slice(AGENT_DOCS_DIR.length + 1)
    : normalizedLower;
  const normalizedWithoutExtension = stripMarkdownExtension(normalizedLower);
  const basename = path.posix.basename(normalizedLower);
  const basenameWithoutExtension = stripMarkdownExtension(basename);

  const scoreDocument = (document: AgentDocumentMeta) => {
    const idLower = document.id.toLowerCase();
    const pathLower = normalizeAgentDocumentLookup(document.path).toLowerCase();
    const pathWithoutDocsPrefix = pathLower.startsWith(`${AGENT_DOCS_DIR}/`)
      ? pathLower.slice(AGENT_DOCS_DIR.length + 1)
      : pathLower;
    const pathWithoutExtension = stripMarkdownExtension(pathLower);
    const pathBasename = path.posix.basename(pathLower);
    const pathBasenameWithoutExtension = stripMarkdownExtension(pathBasename);
    const titleLower = document.title.trim().toLowerCase();
    const titleWithoutExtension = stripMarkdownExtension(titleLower);

    if (document.id === trimmed) return 100;
    if (idLower === normalizedLower) return 95;
    if (pathLower === normalizedLower) return 90;
    if (pathWithoutDocsPrefix === normalizedWithoutDocsPrefix) return 85;
    if (pathBasename === basename && basename.includes(".")) return 80;
    if (pathWithoutExtension === normalizedWithoutExtension) return 75;
    if (pathBasenameWithoutExtension === basenameWithoutExtension) return 70;
    if (titleLower === normalizedLower) return 65;
    if (titleWithoutExtension === normalizedWithoutExtension || titleWithoutExtension === basenameWithoutExtension) return 60;
    return 0;
  };

  const matches = manifest.documents
    .map((document) => ({ document, score: scoreDocument(document) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (matches.length === 0) {
    throw new Error(`Agent document not found: ${documentLookup}.${describeAgentDocumentLookupOptions(manifest)}`);
  }
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    const ambiguous = matches
      .filter((entry) => entry.score === matches[0].score)
      .map((entry) => `${entry.document.id} (${entry.document.path})`)
      .join(", ");
    throw new Error(`Agent document lookup is ambiguous: ${documentLookup}. Use the document id. Matches: ${ambiguous}`);
  }
  return matches[0].document;
};

const readAgentDocumentFile = async (projectId: string, documentId: string): Promise<AgentDocument> => {
  const manifest = await ensureProjectDocuments(projectId);
  const meta = resolveAgentDocumentMeta(manifest, documentId);
  const projectDir = await resolveProjectDirById(projectId, false);
  const documentPath = resolvePathInsideProjectDir(projectDir, normalizeAgentDocumentPath(meta.path, meta.id));
  const raw = await fsp.readFile(documentPath, "utf8").catch(() => null);
  if (raw === null) {
    return agentDocumentSchema.parse({ ...meta, content: "" });
  }
  return agentDocumentFromMarkdown(meta, raw);
};

const getAgentDocumentOperationsFilePath = async (projectId: string) => {
  const projectDir = await resolveProjectDirById(projectId, true);
  const docsDir = resolvePathInsideProjectDir(projectDir, AGENT_DOCS_DIR);
  await fsp.mkdir(docsDir, { recursive: true });
  return path.join(docsDir, AGENT_DOCS_OPERATIONS_FILE);
};

const readAgentDocumentOperationLog = async (projectId: string): Promise<AgentDocumentOperationLog> => {
  const operationsFile = await getAgentDocumentOperationsFilePath(projectId);
  const raw = await fsp.readFile(operationsFile, "utf8").catch(() => null);
  if (!raw) {
    return {
      projectId,
      updatedAt: new Date().toISOString(),
      operations: [],
    };
  }
  const parsed = JSON.parse(raw) as Partial<AgentDocumentOperationLog>;
  return {
    projectId,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    operations: Array.isArray(parsed.operations)
      ? parsed.operations
          .filter((entry): entry is AgentDocumentOperationRecord =>
            Boolean(
              entry &&
                typeof entry.operationId === "string" &&
                typeof entry.documentId === "string" &&
                typeof entry.contentHash === "string" &&
                typeof entry.path === "string" &&
                typeof entry.appliedAt === "string",
            ),
          )
          .slice(-500)
      : [],
  };
};

const writeAgentDocumentOperationLog = async (log: AgentDocumentOperationLog) => {
  const operationsFile = await getAgentDocumentOperationsFilePath(log.projectId);
  await writeFileAtomically(operationsFile, `${JSON.stringify(log, null, 2)}\n`);
};

const writeAgentDocumentFile = async (
  projectId: string,
  documentInput: Partial<AgentDocumentMeta> & { content: string; operationId?: string },
): Promise<AgentDocument> => {
  const manifest = await ensureProjectDocuments(projectId);
  const existing = documentInput.id
    ? manifest.documents.find((document) => document.id === documentInput.id)
    : null;
  const now = new Date().toISOString();
  const id = String(documentInput.id ?? existing?.id ?? "").trim();
  if (!id) {
    throw new Error("Agent document id is required.");
  }
  const role = documentInput.role ?? existing?.role;
  const meta = agentDocumentSchema.omit({ content: true }).parse({
    id,
    title: documentInput.title ?? existing?.title ?? id,
    ...(role ? { role } : {}),
    status: documentInput.status ?? existing?.status ?? "draft",
    path: normalizeAgentDocumentPath(
      documentInput.path ?? existing?.path ?? `${AGENT_DOCS_DIR}/${sanitizePathComponent(String(role ?? "general"), "role")}/${sanitizePathComponent(id, "document")}.md`,
      id,
    ),
    relatedPageIds: documentInput.relatedPageIds ?? existing?.relatedPageIds ?? [],
    updatedAt: now,
    lastAgentRunId: documentInput.lastAgentRunId ?? existing?.lastAgentRunId,
    summary: documentInput.summary ?? existing?.summary,
  });
  const document = agentDocumentSchema.parse({ ...meta, content: documentInput.content });
  const projectDir = await resolveProjectDirById(projectId, true);
  const documentPath = resolvePathInsideProjectDir(projectDir, meta.path);
  const operationId =
    typeof documentInput.operationId === "string" && documentInput.operationId.trim().length > 0
      ? documentInput.operationId.trim()
      : null;
  const markdown = `${buildAgentDocumentMarkdown(meta, document.content)}\n`;
  const contentHash = createHash("sha256").update(markdown).digest("hex");
  if (operationId) {
    const operationLog = await readAgentDocumentOperationLog(projectId);
    const existingOperation = operationLog.operations.find((entry) => entry.operationId === operationId);
    if (existingOperation) {
      if (existingOperation.documentId !== document.id || existingOperation.contentHash !== contentHash) {
        throw new Error(
          `Document write operationId ${operationId} was already applied with different document content.`,
        );
      }
      return readAgentDocumentFile(projectId, document.id);
    }
  }
  const previousDocumentPath = existing
    ? resolvePathInsideProjectDir(
        projectDir,
        normalizeAgentDocumentPath(existing.path, existing.id),
      )
    : null;
  await fsp.mkdir(path.dirname(documentPath), { recursive: true });
  await writeFileAtomically(documentPath, markdown);
  if (previousDocumentPath) {
    const samePath =
      process.platform === "win32"
        ? path.resolve(previousDocumentPath).toLowerCase() === path.resolve(documentPath).toLowerCase()
        : path.resolve(previousDocumentPath) === path.resolve(documentPath);
    if (!samePath) {
      await fsp.rm(previousDocumentPath, { force: true });
    }
  }

  const nextDocuments = manifest.documents
    .filter((entry) => entry.id !== document.id)
    .concat(meta)
    .sort((left, right) => left.path.localeCompare(right.path));
  await writeAgentDocumentManifestFile({
    projectId,
    updatedAt: now,
    roleSetupVersion: 1,
    documents: nextDocuments,
    roles: normalizeAgentRolesForDocuments(manifest.roles, nextDocuments),
  });
  if (operationId) {
    const operationLog = await readAgentDocumentOperationLog(projectId);
    const operations = [
      ...operationLog.operations.filter((entry) => entry.operationId !== operationId),
      {
        operationId,
        documentId: document.id,
        contentHash,
        path: meta.path,
        appliedAt: now,
      },
    ].slice(-500);
    await writeAgentDocumentOperationLog({
      projectId,
      updatedAt: now,
      operations,
    });
  }
  return document;
};

const deleteAgentDocumentFile = async (
  projectId: string,
  documentId: string,
): Promise<AgentDocumentManifest> => {
  const manifest = await ensureProjectDocuments(projectId);
  const meta = resolveAgentDocumentMeta(manifest, documentId);
  const projectDir = await resolveProjectDirById(projectId, false);
  const documentPath = resolvePathInsideProjectDir(
    projectDir,
    normalizeAgentDocumentPath(meta.path, meta.id),
  );
  await fsp.rm(documentPath, { force: true });
  const now = new Date().toISOString();
  const nextDocuments = manifest.documents
    .filter((entry) => entry.id !== meta.id)
    .sort((left, right) => left.path.localeCompare(right.path));
  return writeAgentDocumentManifestFile({
    projectId,
    updatedAt: now,
    roleSetupVersion: 1,
    documents: nextDocuments,
    roles: normalizeAgentRolesForDocuments(manifest.roles, nextDocuments),
  });
};

type AgentRoleInput = Partial<Omit<AgentRoleDefinition, "metadocId">> & {
  name?: string;
  metadocId?: string;
  metadocTitle?: string;
  metadocPath?: string;
};

const createAgentRoleWithMetadocFile = async (
  projectId: string,
  roleInput: AgentRoleInput,
): Promise<AgentDocumentManifest> => {
  const manifest = await ensureProjectDocuments(projectId);
  const now = new Date().toISOString();
  const name = String(roleInput.name ?? "").trim();
  if (!name) {
    throw new Error("Agent role name is required.");
  }
  const id = String(roleInput.id ?? createAgentRoleId(name, manifest.roles)).trim();
  if (!id) {
    throw new Error("Agent role id is required.");
  }
  if (manifest.roles.some((role) => role.id === id)) {
    throw new Error(`Agent role already exists: ${id}`);
  }

  let documents = [...manifest.documents];
  let metadocId = roleInput.metadocId?.trim() ?? "";
  if (metadocId) {
    if (!documents.some((document) => document.id === metadocId)) {
      throw new Error(`Metadoc document not found: ${metadocId}`);
    }
  } else {
    metadocId = createAgentRoleId(`${id}-metadoc`, manifest.roles);
    const meta = agentDocumentMetaSchema.parse({
      id: metadocId,
      title: roleInput.metadocTitle?.trim() || `${name} Metadoc`,
      role: id,
      status: "draft",
      path: normalizeAgentDocumentPath(
        roleInput.metadocPath?.trim() || `${AGENT_DOCS_DIR}/roles/${sanitizePathComponent(id, "role")}.md`,
        metadocId,
      ),
      relatedPageIds: [],
      updatedAt: now,
      summary: `Metadoc for ${name}.`,
    });
    if (documents.some((document) => document.id === meta.id)) {
      throw new Error(`Agent document already exists: ${meta.id}`);
    }
    if (documents.some((document) => document.path.toLowerCase() === meta.path.toLowerCase())) {
      throw new Error(`Agent document path already exists: ${meta.path}`);
    }
    const projectDir = await resolveProjectDirById(projectId, true);
    const documentPath = resolvePathInsideProjectDir(projectDir, meta.path);
    await fsp.mkdir(path.dirname(documentPath), { recursive: true });
    const body = [
      `# ${meta.title}`,
      "",
      "## Role",
      "",
      roleInput.title?.trim() || name,
      "",
      "## Responsibilities",
      "",
      "- Define this role's working rules.",
      "- Record this role's durable output here.",
      "",
      "## Output Log",
      "",
    ].join("\n");
    await fsp.writeFile(documentPath, `${buildAgentDocumentMarkdown(meta, body)}\n`, "utf8");
    documents = documents.concat(meta).sort((left, right) => left.path.localeCompare(right.path));
  }

  if (manifest.roles.some((role) => role.metadocId === metadocId)) {
    throw new Error(`Metadoc is already bound to a role: ${metadocId}`);
  }

  const role = agentRoleDefinitionSchema.parse({
    id,
    name,
    title: roleInput.title?.trim() || name,
    metadocId,
    defaultAutonomy: roleInput.defaultAutonomy,
    allowedCommandGroups: roleInput.allowedCommandGroups,
    preferredTools: roleInput.preferredTools,
    prompt: roleInput.prompt?.trim() || `Operate as ${name}. Read your metadoc first and record durable output there.`,
    builtIn: false,
  });
  return writeAgentDocumentManifestFile({
    projectId,
    updatedAt: now,
    roleSetupVersion: 1,
    documents,
    roles: normalizeAgentRolesForDocuments(manifest.roles.concat(role), documents),
  });
};

const deleteAgentRoleBinding = async (
  projectId: string,
  roleId: string,
): Promise<AgentDocumentManifest> => {
  const manifest = await ensureProjectDocuments(projectId);
  if (!manifest.roles.some((role) => role.id === roleId)) {
    throw new Error(`Agent role not found: ${roleId}`);
  }
  return writeAgentDocumentManifestFile({
    projectId,
    updatedAt: new Date().toISOString(),
    roleSetupVersion: 1,
    documents: manifest.documents,
    roles: manifest.roles.filter((role) => role.id !== roleId),
  });
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
  systemPrompt?: string;
  agentContext?: AgentContextPayload;
  activeRoleId?: string;
  activeRole?: AgentRoleDefinition;
  activeDocumentId?: string | null;
  harness?: {
    initialToolResults?: Array<{ toolName?: string; input?: unknown; result?: unknown; createdAt?: string }>;
    dynamicToolResults?: Array<{ toolName?: string; input?: unknown; result?: unknown; createdAt?: string }>;
  };
  canvasSnapshot?: AgentContextPayload["canvasSnapshot"];
  approvedCommandPlan?: AgentCommandPlan | null;
  requestTrace?: AgentRequestTraceMetadata;
};

type AgentRequestTraceStatus = "pending" | "success" | "error" | "timeout";

type AgentRequestTraceDetailValue = string | number | boolean | null;

type AgentRequestTraceMetadata = {
  requestId: string;
  parentRequestId?: string;
  stage: string;
  createdAt: string;
};

type AgentRequestTraceEvent = {
  phase: string;
  at: string;
  elapsedMs: number;
  message?: string;
  detail?: Record<string, AgentRequestTraceDetailValue>;
};

type AgentRequestTrace = {
  requestId: string;
  parentRequestId?: string;
  stage: string;
  status: AgentRequestTraceStatus;
  provider: "openrouter" | "test" | "unavailable" | null;
  model: string | null;
  usedVision: boolean | null;
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  events: AgentRequestTraceEvent[];
  error?: string;
};

type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_tool"
  | "waiting_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

type AgentRunStepKind =
  | "model_request"
  | "model_resume"
  | "tool_call"
  | "tool_result"
  | "command_plan"
  | "command_result"
  | "retry"
  | "error";

type AgentRunStepStatus = "pending" | "running" | "success" | "error" | "waiting";

type AgentRunStep = {
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

type AgentRunPublic = {
  id: string;
  projectId: string;
  roleId: string;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  modelTurnIndex: number;
  steps: AgentRunStep[];
  trace: AgentRequestTrace[];
  pendingToolCalls: Array<{ toolName: string; input: unknown; reason?: string }>;
  latestResponse?: unknown;
  error?: string;
};

type AgentRunState = AgentRunPublic & {
  payload: AgentChatPayload;
  dynamicToolResults: Array<{ toolName: string; input: unknown; result: unknown; createdAt: string }>;
};

type AgentRunEvent =
  | { type: "run_snapshot" | "run_updated"; run: AgentRunPublic }
  | { type: "run_error"; run?: AgentRunPublic; error: string };

type AgentConversationContext = {
  projectId: string;
  roleId: string;
  updatedAt: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>;
  storagePath?: string;
};

type AgentConversationContextStore = {
  projectId: string;
  updatedAt: string;
  contexts: AgentConversationContext[];
};

type AgentDocumentOperationRecord = {
  operationId: string;
  documentId: string;
  contentHash: string;
  path: string;
  appliedAt: string;
};

type AgentDocumentOperationLog = {
  projectId: string;
  updatedAt: string;
  operations: AgentDocumentOperationRecord[];
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
let agentRequestTraces: AgentRequestTrace[] = [];
const MAX_AGENT_REQUEST_TRACES = 80;

const createAgentRequestId = () =>
  `agent-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const readTraceMetadata = (value: unknown): AgentRequestTraceMetadata => {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const requestId =
    typeof record.requestId === "string" && record.requestId.trim().length > 0
      ? record.requestId.trim()
      : createAgentRequestId();
  const stage =
    typeof record.stage === "string" && record.stage.trim().length > 0
      ? record.stage.trim()
      : "agentChat";
  const createdAt =
    typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt))
      ? record.createdAt
      : new Date().toISOString();
  const parentRequestId =
    typeof record.parentRequestId === "string" && record.parentRequestId.trim().length > 0
      ? record.parentRequestId.trim()
      : undefined;
  return {
    requestId,
    ...(parentRequestId ? { parentRequestId } : {}),
    stage,
    createdAt,
  };
};

const traceElapsedMs = (startedAt: string, at = new Date().toISOString()) => {
  const start = Date.parse(startedAt);
  const current = Date.parse(at);
  if (!Number.isFinite(start) || !Number.isFinite(current)) {
    return 0;
  }
  return Math.max(0, current - start);
};

const normalizeTraceDetailValue = (value: unknown): AgentRequestTraceDetailValue => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return null;
  }
  return (JSON.stringify(value) ?? String(value)).slice(0, 600);
};

const normalizeTraceDetail = (detail?: Record<string, unknown>) =>
  detail
    ? Object.fromEntries(
        Object.entries(detail).map(([key, value]) => [key, normalizeTraceDetailValue(value)]),
      )
    : undefined;

const upsertAgentRequestTrace = (trace: AgentRequestTrace) => {
  agentRequestTraces = [
    trace,
    ...agentRequestTraces.filter((entry) => entry.requestId !== trace.requestId),
  ].slice(0, MAX_AGENT_REQUEST_TRACES);
};

const createAgentRequestTrace = (metadata: AgentRequestTraceMetadata): AgentRequestTrace => {
  const now = new Date().toISOString();
  return {
    requestId: metadata.requestId,
    ...(metadata.parentRequestId ? { parentRequestId: metadata.parentRequestId } : {}),
    stage: metadata.stage,
    status: "pending",
    provider: null,
    model: null,
    usedVision: null,
    startedAt: metadata.createdAt,
    updatedAt: now,
    durationMs: traceElapsedMs(metadata.createdAt, now),
    events: [],
  };
};

const recordAgentTraceEvent = (
  trace: AgentRequestTrace,
  phase: string,
  options: {
    status?: AgentRequestTraceStatus;
    message?: string;
    detail?: Record<string, unknown>;
    provider?: AgentRequestTrace["provider"];
    model?: string | null;
    usedVision?: boolean | null;
    error?: string;
  } = {},
): AgentRequestTrace => {
  const at = new Date().toISOString();
  const event: AgentRequestTraceEvent = {
    phase,
    at,
    elapsedMs: traceElapsedMs(trace.startedAt, at),
    ...(options.message ? { message: options.message } : {}),
    ...(options.detail ? { detail: normalizeTraceDetail(options.detail) } : {}),
  };
  const nextTrace: AgentRequestTrace = {
    ...trace,
    status: options.status ?? trace.status,
    provider: options.provider !== undefined ? options.provider : trace.provider,
    model: options.model !== undefined ? options.model : trace.model,
    usedVision: options.usedVision !== undefined ? options.usedVision : trace.usedVision,
    updatedAt: at,
    durationMs: traceElapsedMs(trace.startedAt, at),
    events: [...trace.events, event],
    ...(options.error ? { error: options.error } : {}),
  };
  upsertAgentRequestTrace(nextTrace);
  return nextTrace;
};

const attachTraceToResponse = (value: unknown, trace: AgentRequestTrace) => ({
  ...(value && typeof value === "object" ? value as Record<string, unknown> : {
    message: "Agent request completed.",
    pendingCommandPlan: null,
  }),
  requestTrace: trace,
});

const agentRunStates = new Map<string, AgentRunState>();
const agentRunSubscribers = new Map<string, Set<ServerResponse>>();
const agentRunPersistQueues = new Map<string, Promise<void>>();

const createAgentRunId = () => `agent-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createAgentRunStepId = () => `agent-step-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const toPublicAgentRun = (run: AgentRunState): AgentRunPublic => ({
  id: run.id,
  projectId: run.projectId,
  roleId: run.roleId,
  status: run.status,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
  modelTurnIndex: run.modelTurnIndex,
  steps: run.steps,
  trace: run.trace,
  pendingToolCalls: run.pendingToolCalls,
  latestResponse: run.latestResponse,
  ...(run.error ? { error: run.error } : {}),
});

const getAgentRunProjectDir = async (projectId: string) => {
  const projectDir = await resolveProjectDirById(projectId, true);
  const runsDir = resolvePathInsideProjectDir(projectDir, AGENT_RUNS_DIR);
  await fsp.mkdir(runsDir, { recursive: true });
  return runsDir;
};

const getAgentRunFilePath = async (projectId: string, runId: string) => {
  const runsDir = await getAgentRunProjectDir(projectId);
  const runDir = resolvePathInsideProjectDir(runsDir, sanitizePathComponent(runId, "run"));
  await fsp.mkdir(runDir, { recursive: true });
  return path.join(runDir, AGENT_RUN_FILE);
};

const persistAgentRunNow = async (run: AgentRunState) => {
  const runFile = await getAgentRunFilePath(run.projectId, run.id);
  await writeFileAtomically(runFile, `${JSON.stringify(run, null, 2)}\n`);
};

const persistAgentRun = async (run: AgentRunState) => {
  const queueKey = `${run.projectId}:${run.id}`;
  const previous = agentRunPersistQueues.get(queueKey)?.catch(() => undefined) ?? Promise.resolve();
  const next = previous.then(() => persistAgentRunNow(run));
  agentRunPersistQueues.set(queueKey, next);
  try {
    await next;
  } finally {
    if (agentRunPersistQueues.get(queueKey) === next) {
      agentRunPersistQueues.delete(queueKey);
    }
  }
};

const readPersistedAgentRun = async (projectId: string, runId: string) => {
  const runFile = await getAgentRunFilePath(projectId, runId);
  const raw = await fsp.readFile(runFile, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as AgentRunState;
};

const writeSseEvent = (res: ServerResponse, event: AgentRunEvent) => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

const broadcastAgentRun = (run: AgentRunState, type: AgentRunEvent["type"] = "run_updated") => {
  const subscribers = agentRunSubscribers.get(run.id);
  if (!subscribers) {
    return;
  }
  const event = { type, run: toPublicAgentRun(run) } as AgentRunEvent;
  for (const res of subscribers) {
    writeSseEvent(res, event);
  }
};

const saveAndBroadcastAgentRun = async (run: AgentRunState, type: AgentRunEvent["type"] = "run_updated") => {
  run.updatedAt = new Date().toISOString();
  agentRunStates.set(run.id, run);
  await persistAgentRun(run);
  broadcastAgentRun(run, type);
};

const getAgentRunState = async (runId: string, projectId?: string | null) => {
  const memoryRun = agentRunStates.get(runId);
  if (memoryRun) {
    return memoryRun;
  }
  if (!projectId) {
    return null;
  }
  const persistedRun = await readPersistedAgentRun(projectId, runId);
  if (persistedRun) {
    agentRunStates.set(runId, persistedRun);
  }
  return persistedRun;
};

const createAgentRunStep = (
  runId: string,
  kind: AgentRunStepKind,
  summary: string,
  status: AgentRunStepStatus = "running",
  input?: unknown,
): AgentRunStep => {
  const now = new Date().toISOString();
  return {
    id: createAgentRunStepId(),
    runId,
    kind,
    status,
    operationId: `${kind}:${createAgentRunStepId()}`,
    summary,
    createdAt: now,
    startedAt: now,
    ...(input !== undefined ? { input } : {}),
  };
};

const summarizeModelResponseForRun = (response: unknown) => {
  const record = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const requestedToolCalls = Array.isArray(record.requestedToolCalls)
    ? record.requestedToolCalls as Array<{ toolName?: unknown }>
    : [];
  const plan = record.pendingCommandPlan && typeof record.pendingCommandPlan === "object"
    ? record.pendingCommandPlan as { commands?: unknown[]; requiresConfirmation?: unknown; summary?: unknown }
    : null;
  return {
    messageLength: typeof record.message === "string" ? record.message.length : 0,
    requestedToolCalls: requestedToolCalls.map((call) => String(call.toolName ?? "unknown")),
    commandPlan: plan
      ? {
          summary: typeof plan.summary === "string" ? plan.summary : "",
          commandCount: Array.isArray(plan.commands) ? plan.commands.length : 0,
          requiresConfirmation: plan.requiresConfirmation === true,
        }
      : null,
    warning: typeof record.warning === "string" ? record.warning : null,
    usedVision: typeof record.usedVision === "boolean" ? record.usedVision : null,
  };
};

const summarizeToolResultsForRun = (
  toolResults: Array<{ toolName?: string; input?: unknown; result?: unknown; createdAt?: string }>,
) =>
  toolResults.map((result) => {
    const resultRecord =
      result.result && typeof result.result === "object" && !Array.isArray(result.result)
        ? result.result as Record<string, unknown>
        : {};
    return {
      toolName: result.toolName ?? "unknown",
      createdAt: result.createdAt ?? null,
      resultKeys: Object.keys(resultRecord).slice(0, 20),
      contentLength:
        typeof resultRecord.content === "string"
          ? resultRecord.content.length
          : typeof (resultRecord.document as { contentLength?: unknown } | undefined)?.contentLength === "number"
            ? (resultRecord.document as { contentLength: number }).contentLength
      : null,
    };
  });

const createRetryStepsFromTrace = (runId: string, trace: AgentRequestTrace): AgentRunStep[] =>
  trace.events
    .filter((event) => event.phase === "openrouter_retry_started")
    .map((event) => ({
      ...createAgentRunStep(
        runId,
        "retry",
        event.message ?? "Retrying model request",
        "success",
        event.detail ?? {},
      ),
      createdAt: event.at,
      startedAt: event.at,
      finishedAt: event.at,
    }));

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

const truncatePromptString = (value: string, maxLength: number) =>
  value.length > maxLength
    ? `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} characters]`
    : value;

const compactPromptValue = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return "[redacted inline image data; attached separately only when vision is enabled]";
    }
    return truncatePromptString(value, depth <= 2 ? 8000 : 3000);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => compactPromptValue(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (key === "dataUrl" && typeof entry === "string" && entry) {
          return [key, "[attached image redacted from prompt text]"];
        }
        if (key === "content" && typeof entry === "string") {
          return [key, truncatePromptString(entry, 6000)];
        }
        return [key, compactPromptValue(entry, depth + 1)];
      }),
    );
  }
  return value;
};

const compactHarnessForPrompt = (harness: AgentChatPayload["harness"] | undefined) => {
  if (!harness) {
    return null;
  }
  const initialToolResults = harness.initialToolResults ?? [];
  const dynamicToolResults = harness.dynamicToolResults ?? [];
  return compactPromptValue({
    ...harness,
    initialToolResults: initialToolResults.map((entry) => compactPromptValue(entry)),
    dynamicToolResults: dynamicToolResults.slice(-12).map((entry) => compactPromptValue(entry)),
    compactedForPrompt: {
      dynamicToolResultsIncluded: Math.min(dynamicToolResults.length, 12),
      dynamicToolResultsTotal: dynamicToolResults.length,
      policy: "Full data stays in the persisted run and browser harness. Prompt text includes only compacted recent tool results; request tools again only when needed.",
    },
  });
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
      rolesAvailableVia: "listRoles",
      documentsAvailableVia: "listDocuments/readDocument/searchDocuments",
      documentsWritableVia: "writeDocument",
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
  const harnessResults = getHarnessToolResults(payload.harness);
  const hasDocumentList = harnessResults.some((entry) => entry.toolName === "listDocuments");
  const hasDocumentRead = harnessResults.some((entry) => entry.toolName === "readDocument");
  const hasDocumentWrite = harnessResults.some((entry) => entry.toolName === "writeDocument");

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

  if ((normalized.includes("document") || normalized.includes("docs") || normalized.includes("production plan")) && !hasDocumentList) {
    return {
      message: "I need to list the durable project documents before answering.",
      requestedToolCalls: [
        {
          toolName: "listDocuments",
          input: {},
          reason: "Inspect available Markdown production documents.",
        },
      ],
      pendingCommandPlan: null,
      usedVision: hasVisionInput,
    };
  }

  if (normalized.includes("production plan") && hasDocumentList && !hasDocumentRead) {
    return {
      message: "I need to read the production plan document.",
      requestedToolCalls: [
        {
          toolName: "readDocument",
          input: { documentId: "production-plan" },
          reason: "Read durable producer-owned project direction.",
        },
      ],
      pendingCommandPlan: null,
      usedVision: hasVisionInput,
    };
  }

  if (normalized.includes("write document") && !hasDocumentWrite) {
    return {
      message: "I will update the production plan document.",
      requestedToolCalls: [
        {
          toolName: "writeDocument",
          input: {
            operationId: "test-agent-write-production-plan",
            id: "production-plan",
            title: "Production Plan",
            role: "producer",
            status: "draft",
            path: "docs/production/production-plan.md",
            summary: "Updated by the test Agent.",
            content: "# Production Plan\n\n## Test Update\n\nThe test Agent can write durable Markdown documents.\n",
          },
          reason: "Persist role output into a project Markdown document.",
        },
      ],
      pendingCommandPlan: null,
      usedVision: hasVisionInput,
    };
  }

  if (hasDocumentRead || hasDocumentWrite) {
    return {
      message: hasDocumentWrite
        ? "I updated the durable Markdown document."
        : "I read the durable Markdown document and can use it as production context.",
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
  const systemPrompt = [
    normalizeAgentSystemPrompt(payload.systemPrompt ?? DEFAULT_AGENT_SYSTEM_PROMPT),
    AGENT_PROTOCOL_SYSTEM_PROMPT,
  ].join("\n\n");
  const harnessText = payload.harness
    ? `\n\nAgent harness JSON:\n${JSON.stringify(compactHarnessForPrompt(payload.harness), null, 2)}`
    : "";
  const activeRole = payload.activeRole
    ? agentRoleDefinitionSchema.parse(payload.activeRole)
    : getAgentRole(payload.activeRoleId);
  const contextText = [
    `Active Agent role: ${activeRole.name} (${activeRole.title})`,
    `Active role metadoc id: ${activeRole.metadocId}`,
    `Role default autonomy: ${activeRole.defaultAutonomy}`,
    `Role instruction: ${activeRole.prompt}`,
    `Active document id: ${payload.activeDocumentId ?? "none"}`,
    `Agent lightweight context JSON:\n${JSON.stringify(compactAgentContextForPrompt(payload.agentContext), null, 2)}${harnessText}`,
  ].join("\n\n");
  const imageUrls = getHarnessImageDataUrls(payload.harness);
  const contextContent =
    includeImage && imageUrls.length > 0
      ? [
          { type: "text", text: contextText },
          ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ]
      : contextText;
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: contextContent },
    ...(payload.messages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
};

class OpenRouterRetryableError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "OpenRouterRetryableError";
    this.statusCode = statusCode;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableOpenRouterError = (error: unknown) => {
  if (error instanceof OpenRouterRetryableError || error instanceof OpenRouterNonJsonResponseError) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("terminated") ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("socket") ||
    message.includes("network")
  );
};

const callOpenRouter = async (
  payload: AgentChatPayload,
  includeImage: boolean,
  requestTrace: AgentRequestTrace,
): Promise<{ response: unknown; requestTrace: AgentRequestTrace }> => {
  let trace = requestTrace;
  const config = await getCurrentAgentConfig();
  if (!config.enabled || config.provider !== "openrouter" || !config.model) {
    throw new Error(config.reason ?? "Agent is not configured.");
  }
  trace = recordAgentTraceEvent(trace, "agent_config_checked", {
    provider: "openrouter",
    model: config.model,
    usedVision: includeImage,
    detail: {
      visionEnabled: config.visionEnabled,
      includeImage,
      timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
    },
  });
  const sendRequest = async (provider: OpenRouterProviderRouting, retryWarning?: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, OPENROUTER_REQUEST_TIMEOUT_MS);
    let response: Awaited<ReturnType<typeof fetch>>;
    let raw = "";
    try {
      trace = recordAgentTraceEvent(trace, "openrouter_request_started", {
        detail: {
          model: config.model,
          providerRouting: provider,
          includeImage,
          imageAttachmentCount: getHarnessImageDataUrls(payload.harness).length,
          messageCount: payload.messages?.length ?? 0,
          initialToolResults: payload.harness?.initialToolResults?.length ?? 0,
          dynamicToolResults: payload.harness?.dynamicToolResults?.length ?? 0,
        },
      });
      response = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ""}`,
          "HTTP-Referer": "http://localhost",
          "X-Title": "MangaMaker Agent",
        },
        body: JSON.stringify({
          model: config.model,
          provider,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: buildOpenRouterMessages(payload, includeImage),
        }),
        signal: controller.signal,
      });
      trace = recordAgentTraceEvent(trace, "openrouter_headers_received", {
        detail: {
          status: response.status,
          ok: response.ok,
          contentType: response.headers.get("content-type"),
          requestId:
            response.headers.get("x-request-id") ??
            response.headers.get("x-openrouter-request-id") ??
            response.headers.get("cf-ray"),
        },
      });
      raw = await response.text();
      trace = recordAgentTraceEvent(trace, "openrouter_body_received", {
        detail: {
          status: response.status,
          ok: response.ok,
          bodyLength: raw.length,
        },
      });
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        trace = recordAgentTraceEvent(trace, "openrouter_timeout", {
          status: "timeout",
          message: `OpenRouter request timed out after ${Math.round(OPENROUTER_REQUEST_TIMEOUT_MS / 1000)} seconds.`,
          error: `OpenRouter request timed out after ${Math.round(OPENROUTER_REQUEST_TIMEOUT_MS / 1000)} seconds.`,
        });
        throw new OpenRouterRetryableError(`OpenRouter request timed out after ${Math.round(OPENROUTER_REQUEST_TIMEOUT_MS / 1000)} seconds.`);
      }
      const message = error instanceof Error ? error.message : String(error);
      trace = recordAgentTraceEvent(trace, "openrouter_request_failed", {
        status: "error",
        message,
        error: message,
      });
      if (isRetryableOpenRouterError(error)) {
        throw new OpenRouterRetryableError(message);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      const errorMessage = `OpenRouter request failed (${response.status}): ${raw.slice(0, 500)}`;
      trace = recordAgentTraceEvent(trace, "openrouter_http_error", {
        status: "error",
        message: `OpenRouter request failed (${response.status}).`,
        error: errorMessage,
      });
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new OpenRouterRetryableError(errorMessage, response.status);
      }
      throw new Error(errorMessage);
    }
    let parsed: unknown;
    try {
      parsed = parseOpenRouterResponseJson(raw, {
        status: response.status,
        contentType: response.headers.get("content-type"),
      });
      trace = recordAgentTraceEvent(trace, "openrouter_json_parsed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace = recordAgentTraceEvent(trace, "openrouter_json_parse_failed", {
        status: "error",
        message,
        error: message,
      });
      throw error;
    }
    const content = extractOpenRouterAssistantContent(parsed);
    trace = recordAgentTraceEvent(trace, "openrouter_assistant_content_extracted", {
      detail: {
        contentLength: content.length,
      },
    });
    let parsedModelJson: Record<string, unknown>;
    try {
      parsedModelJson = parseModelJson(content) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace = recordAgentTraceEvent(trace, "model_json_parse_failed", {
        status: "error",
        message,
        error: message,
        detail: {
          contentPreview: content.slice(0, 400),
        },
      });
      throw new OpenRouterRetryableError(`OpenRouter returned invalid Agent JSON: ${message}`);
    }
    const modelResponse = {
      ...parsedModelJson,
      usedVision: includeImage,
      ...(retryWarning ? { warning: retryWarning } : {}),
    } as {
      message?: unknown;
      pendingCommandPlan?: unknown;
      usedVision?: boolean;
      warning?: unknown;
    };
    trace = recordAgentTraceEvent(trace, "model_json_parsed", {
      detail: {
        hasRequestedToolCalls: Array.isArray((modelResponse as { requestedToolCalls?: unknown }).requestedToolCalls),
        hasPendingCommandPlan: Boolean((modelResponse as { pendingCommandPlan?: unknown }).pendingCommandPlan),
      },
    });
    return modelResponse;
  };

  const preferredProvider = getOpenRouterProviderRouting(config.model);
  const fallbackProvider = getOpenRouterFallbackProviderRouting(config.model);
  const attempts: Array<{ provider: OpenRouterProviderRouting; warning?: string }> = [
    { provider: preferredProvider },
    {
      provider: fallbackProvider,
      warning: "MangaMaker retried the request with fallback OpenRouter provider routing after a transient provider failure.",
    },
    {
      provider: fallbackProvider,
      warning: "MangaMaker retried the request with fallback OpenRouter provider routing after repeated transient provider failures.",
    },
  ];
  let lastError: unknown = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (index > 0) {
      trace = recordAgentTraceEvent(trace, "openrouter_retry_started", {
        status: "pending",
        message: attempt.warning,
        detail: {
          attempt: index + 1,
          maxAttempts: attempts.length,
          providerRouting: attempt.provider,
        },
      });
    }
    try {
      return {
        response: await sendRequest(attempt.provider, attempt.warning),
        requestTrace: trace,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableOpenRouterError(error) || index === attempts.length - 1) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      trace = recordAgentTraceEvent(trace, "openrouter_retry_scheduled", {
        status: "pending",
        message,
        detail: {
          attempt: index + 1,
          nextAttempt: index + 2,
        },
      });
      await sleep(1000 * (index + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "OpenRouter request failed."));
};

type AgentSchemaLoader = () => Promise<{
  validateAgentChatResponse: (value: unknown) => unknown;
}>;

const createDynamicAgentSchemaLoader = (): AgentSchemaLoader => async () => {
  const runtimeModulePath = path.resolve(process.cwd(), "dist/agent-runtime/agentResponseSchema.mjs");
  const runtimeModule = await fsp.stat(runtimeModulePath).catch(() => null);
  if (!runtimeModule?.isFile()) {
    throw new Error("Agent runtime validator is missing. Run pnpm build before starting preview.");
  }
  const moduleName = pathToFileURL(runtimeModulePath).href;
  return (await import(moduleName)) as {
    validateAgentChatResponse: (value: unknown) => unknown;
  };
};

const normalizeAgentModelResponse = async (value: unknown, loadAgentSchema: AgentSchemaLoader) => {
  const module = await loadAgentSchema();
  return module.validateAgentChatResponse(value);
};

const executeAgentModelRequest = async (
  payload: AgentChatPayload,
  requestTrace: AgentRequestTrace,
  loadAgentSchema: AgentSchemaLoader,
): Promise<{ response: unknown; requestTrace: AgentRequestTrace }> => {
  let trace = requestTrace;
  if (AGENT_TEST_MODE) {
    trace = recordAgentTraceEvent(trace, "test_agent_response_started", {
      provider: "test",
      model: "mangamaker-test-agent",
      usedVision: getHarnessImageDataUrls(payload.harness).length > 0,
    });
    const normalized = await normalizeAgentModelResponse(createTestAgentResponse(payload), loadAgentSchema);
    trace = recordAgentTraceEvent(trace, "server_response_ready", {
      status: "success",
    });
    return {
      response: attachTraceToResponse(normalized, trace),
      requestTrace: trace,
    };
  }

  const config = await getCurrentAgentConfig();
  if (!config.enabled) {
    const message = config.reason ?? "Agent is not configured.";
    trace = recordAgentTraceEvent(trace, "agent_config_unavailable", {
      status: "error",
      provider: "unavailable",
      model: config.model,
      message,
      error: message,
    });
    return {
      response: attachTraceToResponse(
        { message: "Agent unavailable.", error: message, pendingCommandPlan: null },
        trace,
      ),
      requestTrace: trace,
    };
  }

  const hasHarnessImage = getHarnessImageDataUrls(payload.harness).length > 0;
  const openRouterResult = await callOpenRouter(
    payload,
    hasHarnessImage && config.visionEnabled,
    trace,
  );
  trace = openRouterResult.requestTrace;
  const normalized = await normalizeAgentModelResponse(openRouterResult.response, loadAgentSchema);
  trace = recordAgentTraceEvent(trace, "response_schema_validated");
  trace = recordAgentTraceEvent(trace, "server_response_ready", {
    status: "success",
  });
  return {
    response: attachTraceToResponse(normalized, trace),
    requestTrace: trace,
  };
};

const startAgentRunModelStep = (
  runId: string,
  kind: "model_request" | "model_resume",
  loadAgentSchema: AgentSchemaLoader,
) => {
  void (async () => {
    const run = await getAgentRunState(runId);
    if (!run || run.status === "cancelled") {
      return;
    }
    const step = createAgentRunStep(
      run.id,
      kind,
      kind === "model_request" ? "Sending model request" : "Resuming model after tool result",
      "running",
      {
        messageCount: run.payload.messages?.length ?? 0,
        initialToolResults: run.payload.harness?.initialToolResults?.length ?? 0,
        dynamicToolResults: run.payload.harness?.dynamicToolResults?.length ?? 0,
      },
    );
    run.steps.push(step);
    run.status = "running";
    run.pendingToolCalls = [];
    await saveAndBroadcastAgentRun(run);

    let trace = recordAgentTraceEvent(
      createAgentRequestTrace({
        requestId: `${run.id}:${step.id}`,
        stage: kind,
        createdAt: step.startedAt ?? new Date().toISOString(),
      }),
      "server_received",
      {
        detail: {
          route: `${AGENT_API_BASE}/runs`,
          runId: run.id,
          stepId: step.id,
          kind,
          messageCount: run.payload.messages?.length ?? 0,
          hasHarness: Boolean(run.payload.harness),
        },
      },
    );
    trace = recordAgentTraceEvent(
      trace,
      "server_run_model_step_started",
      {
        detail: {
          runId: run.id,
          stepId: step.id,
          kind,
        },
      },
    );

    try {
      const result = await executeAgentModelRequest(run.payload, trace, loadAgentSchema);
      trace = result.requestTrace;
      const response = result.response as {
        requestedToolCalls?: Array<{ toolName: string; input: unknown; reason?: string }>;
        pendingCommandPlan?: { summary?: string; commands?: unknown[]; requiresConfirmation?: boolean } | null;
        requestTrace?: AgentRequestTrace;
      };
      step.status = "success";
      step.finishedAt = new Date().toISOString();
      step.output = summarizeModelResponseForRun(response);
      step.trace = trace;
      run.steps.push(...createRetryStepsFromTrace(run.id, trace));
      run.trace = [trace, ...run.trace.filter((entry) => entry.requestId !== trace.requestId)].slice(0, 80);
      run.latestResponse = response;
      run.modelTurnIndex += 1;

      const requestedToolCalls = Array.isArray(response.requestedToolCalls)
        ? response.requestedToolCalls
        : [];
      if (requestedToolCalls.length > 0) {
        run.pendingToolCalls = requestedToolCalls;
        run.status = "waiting_for_tool";
        run.steps.push({
          ...createAgentRunStep(
            run.id,
            "tool_call",
            `Waiting for ${requestedToolCalls.length} tool call(s)`,
            "waiting",
            {
              toolCalls: requestedToolCalls.map(({ toolName, input, reason }) => ({ toolName, input, reason })),
            },
          ),
          finishedAt: new Date().toISOString(),
        });
      } else if (response.pendingCommandPlan) {
        const requiresConfirmation = response.pendingCommandPlan.requiresConfirmation === true;
        run.pendingToolCalls = [];
        run.status = requiresConfirmation ? "waiting_for_confirmation" : "completed";
        run.steps.push({
          ...createAgentRunStep(
            run.id,
            "command_plan",
            response.pendingCommandPlan.summary || "Command plan ready",
            requiresConfirmation ? "waiting" : "success",
            {
              commandCount: Array.isArray(response.pendingCommandPlan.commands)
                ? response.pendingCommandPlan.commands.length
                : 0,
              requiresConfirmation,
            },
          ),
          finishedAt: new Date().toISOString(),
        });
      } else {
        run.pendingToolCalls = [];
        run.status = "completed";
      }
      await saveAndBroadcastAgentRun(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      step.status = "error";
      step.error = message;
      step.finishedAt = new Date().toISOString();
      step.trace = trace;
      run.steps.push(...createRetryStepsFromTrace(run.id, trace));
      run.trace = [trace, ...run.trace.filter((entry) => entry.requestId !== trace.requestId)].slice(0, 80);
      run.status = "failed";
      run.error = message;
      run.steps.push({
        ...createAgentRunStep(run.id, "error", message, "error"),
        finishedAt: new Date().toISOString(),
        error: message,
      });
      await saveAndBroadcastAgentRun(run);
    }
  })();
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
      if (method === "GET" && pathname === `${AGENT_API_BASE}/traces`) {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "40") || 40));
        json(res, 200, {
          updatedAt: new Date().toISOString(),
          traces: agentRequestTraces.slice(0, limit),
        });
        return;
      }
      if (method === "GET" && pathname === `${AGENT_API_BASE}/trace`) {
        const requestId = url.searchParams.get("requestId")?.trim();
        const trace = requestId
          ? agentRequestTraces.find((entry) => entry.requestId === requestId) ?? null
          : agentRequestTraces[0] ?? null;
        json(res, trace ? 200 : 404, trace ?? { error: "Agent request trace not found." });
        return;
      }
      if (method === "POST" && pathname === `${AGENT_API_BASE}/debug`) {
        latestAgentDebugSnapshot = await readJsonBody<unknown>(req);
        json(res, 200, { ok: true });
        return;
      }
      if (method === "GET" && pathname === `${AGENT_API_BASE}/documents`) {
        const projectId = url.searchParams.get("projectId")?.trim();
        if (!projectId) {
          json(res, 400, { error: "projectId query parameter is required." });
          return;
        }
        json(res, 200, await ensureProjectDocuments(projectId));
        return;
      }
      if (method === "GET" && pathname === `${AGENT_API_BASE}/document`) {
        const projectId = url.searchParams.get("projectId")?.trim();
        const documentId = url.searchParams.get("documentId")?.trim();
        if (!projectId || !documentId) {
          json(res, 400, { error: "projectId and documentId query parameters are required." });
          return;
        }
        json(res, 200, await readAgentDocumentFile(projectId, documentId));
        return;
      }
      if (method === "POST" && pathname === `${AGENT_API_BASE}/document`) {
        const body = await readJsonBody<{ projectId?: unknown; document?: unknown }>(req);
        if (typeof body.projectId !== "string" || body.projectId.trim().length === 0) {
          json(res, 400, { error: "projectId is required." });
          return;
        }
        if (!body.document || typeof body.document !== "object") {
          json(res, 400, { error: "document object is required." });
          return;
        }
        json(
          res,
          200,
          await writeAgentDocumentFile(
            body.projectId.trim(),
            body.document as Partial<AgentDocumentMeta> & { content: string; operationId?: string },
          ),
        );
        return;
      }
      if (method === "DELETE" && pathname === `${AGENT_API_BASE}/document`) {
        const projectId = url.searchParams.get("projectId")?.trim();
        const documentId = url.searchParams.get("documentId")?.trim();
        if (!projectId || !documentId) {
          json(res, 400, { error: "projectId and documentId query parameters are required." });
          return;
        }
        json(res, 200, await deleteAgentDocumentFile(projectId, documentId));
        return;
      }
      if (method === "POST" && pathname === `${AGENT_API_BASE}/role`) {
        const body = await readJsonBody<{ projectId?: unknown; role?: unknown }>(req);
        if (typeof body.projectId !== "string" || body.projectId.trim().length === 0) {
          json(res, 400, { error: "projectId is required." });
          return;
        }
        if (!body.role || typeof body.role !== "object") {
          json(res, 400, { error: "role object is required." });
          return;
        }
        json(res, 200, await createAgentRoleWithMetadocFile(body.projectId.trim(), body.role as AgentRoleInput));
        return;
      }
      if (method === "DELETE" && pathname === `${AGENT_API_BASE}/role`) {
        const projectId = url.searchParams.get("projectId")?.trim();
        const roleId = url.searchParams.get("roleId")?.trim();
        if (!projectId || !roleId) {
          json(res, 400, { error: "projectId and roleId query parameters are required." });
          return;
        }
        json(res, 200, await deleteAgentRoleBinding(projectId, roleId));
        return;
      }
      if (
        pathname === `${AGENT_API_BASE}/conversation-context` ||
        pathname === `${AGENT_API_BASE}/history`
      ) {
        const projectId = url.searchParams.get("projectId")?.trim();
        const roleId = url.searchParams.get("roleId")?.trim() || DEFAULT_AGENT_CONVERSATION_ROLE_ID;
        if (method === "GET") {
          if (!projectId) {
            json(res, 400, { error: "projectId query parameter is required." });
            return;
          }
          json(res, 200, await readAgentConversationContextFile(projectId, roleId));
          return;
        }
        if (method === "POST") {
          json(res, 200, await writeAgentConversationContextFile(await readJsonBody<AgentConversationContext>(req)));
          return;
        }
        if (method === "DELETE") {
          if (!projectId) {
            json(res, 400, { error: "projectId query parameter is required." });
            return;
          }
          await deleteAgentConversationContextFile(projectId, roleId);
          json(res, 200, { ok: true });
          return;
        }
      }
      if (method === "POST" && pathname === `${AGENT_API_BASE}/runs`) {
        const payload = await readJsonBody<AgentChatPayload>(req);
        const now = new Date().toISOString();
        const projectId =
          typeof payload.agentContext?.project?.id === "string" && payload.agentContext.project.id.trim().length > 0
            ? payload.agentContext.project.id.trim()
            : "unknown-project";
        const roleId =
          typeof payload.activeRoleId === "string" && payload.activeRoleId.trim().length > 0
            ? payload.activeRoleId.trim()
            : DEFAULT_AGENT_CONVERSATION_ROLE_ID;
        const run: AgentRunState = {
          id: createAgentRunId(),
          projectId,
          roleId,
          status: "queued",
          createdAt: now,
          updatedAt: now,
          modelTurnIndex: 0,
          steps: [],
          trace: [],
          pendingToolCalls: [],
          payload,
          dynamicToolResults: (payload.harness?.dynamicToolResults ?? []).map((entry) => ({
            toolName: String(entry.toolName ?? "unknown"),
            input: entry.input,
            result: entry.result,
            createdAt: entry.createdAt ?? now,
          })),
        };
        await saveAndBroadcastAgentRun(run, "run_snapshot");
        startAgentRunModelStep(run.id, "model_request", loadAgentSchema);
        json(res, 202, toPublicAgentRun(run));
        return;
      }
      const runMatch = pathname.match(new RegExp(`^${AGENT_API_BASE.replace(/\//g, "\\/")}\\/runs\\/([^/]+)(?:\\/([^/]+))?$`));
      if (runMatch) {
        const runId = decodeURIComponent(runMatch[1] ?? "");
        const runAction = runMatch[2] ? decodeURIComponent(runMatch[2]) : "";
        const projectId = url.searchParams.get("projectId")?.trim() || null;
        if (method === "GET" && !runAction) {
          const run = await getAgentRunState(runId, projectId);
          json(res, run ? 200 : 404, run ? toPublicAgentRun(run) : { error: "Agent run not found." });
          return;
        }
        if (method === "GET" && runAction === "events") {
          const run = await getAgentRunState(runId, projectId);
          if (!run) {
            json(res, 404, { error: "Agent run not found." });
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.write(": connected\n\n");
          writeSseEvent(res, { type: "run_snapshot", run: toPublicAgentRun(run) });
          const subscribers = agentRunSubscribers.get(run.id) ?? new Set<ServerResponse>();
          subscribers.add(res);
          agentRunSubscribers.set(run.id, subscribers);
          const keepAlive = setInterval(() => {
            res.write(": keepalive\n\n");
          }, 25000);
          const cleanup = () => {
            clearInterval(keepAlive);
            const current = agentRunSubscribers.get(run.id);
            current?.delete(res);
            if (current && current.size === 0) {
              agentRunSubscribers.delete(run.id);
            }
          };
          req.on("close", cleanup);
          res.on("close", cleanup);
          return;
        }
        if (method === "POST" && runAction === "tool-results") {
          const run = await getAgentRunState(runId, projectId);
          if (!run) {
            json(res, 404, { error: "Agent run not found." });
            return;
          }
          if (run.status === "cancelled") {
            json(res, 409, { error: "Agent run has been cancelled." });
            return;
          }
          const body = await readJsonBody<{
            harness?: AgentChatPayload["harness"];
            toolResults?: Array<{ toolName?: string; input?: unknown; result?: unknown; createdAt?: string }>;
            dynamicToolResults?: Array<{ toolName?: string; input?: unknown; result?: unknown; createdAt?: string }>;
          }>(req);
          const now = new Date().toISOString();
          const toolResults = (body.toolResults ?? []).map((entry) => ({
            toolName: String(entry.toolName ?? "unknown"),
            input: entry.input,
            result: entry.result,
            createdAt: entry.createdAt ?? now,
          }));
          run.steps.push({
            ...createAgentRunStep(
              run.id,
              "tool_result",
              `${toolResults.length} tool result(s) received`,
              "success",
              summarizeToolResultsForRun(toolResults),
            ),
            finishedAt: now,
          });
          run.payload = {
            ...run.payload,
            harness: body.harness ?? run.payload.harness,
          };
          run.dynamicToolResults = (body.dynamicToolResults ?? toolResults).map((entry) => ({
            toolName: String(entry.toolName ?? "unknown"),
            input: entry.input,
            result: entry.result,
            createdAt: entry.createdAt ?? now,
          }));
          run.pendingToolCalls = [];
          await saveAndBroadcastAgentRun(run);
          startAgentRunModelStep(run.id, "model_resume", loadAgentSchema);
          json(res, 202, toPublicAgentRun(run));
          return;
        }
        if (method === "POST" && runAction === "cancel") {
          const run = await getAgentRunState(runId, projectId);
          if (!run) {
            json(res, 404, { error: "Agent run not found." });
            return;
          }
          run.status = "cancelled";
          run.error = "Cancelled by user.";
          await saveAndBroadcastAgentRun(run);
          json(res, 200, toPublicAgentRun(run));
          return;
        }
      }
      if (method !== "POST" || pathname !== `${AGENT_API_BASE}/chat`) {
        text(res, 404, "Not Found");
        return;
      }
      const payload = await readJsonBody<AgentChatPayload>(req);
      let requestTrace = recordAgentTraceEvent(
        createAgentRequestTrace(readTraceMetadata(payload.requestTrace)),
        "server_received",
        {
          detail: {
            route: `${AGENT_API_BASE}/chat`,
            messageCount: payload.messages?.length ?? 0,
            hasHarness: Boolean(payload.harness),
          },
        },
      );
      const result = await executeAgentModelRequest(payload, requestTrace, loadAgentSchema);
      const response = result.response as { error?: unknown };
      json(res, response.error ? 503 : 200, result.response);
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
