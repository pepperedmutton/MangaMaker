import { z } from "zod";
import {
  AGENT_DEFAULT_ROLE_DEFINITIONS,
  agentRoleDefinitionSchema,
  type AgentRoleDefinition,
} from "./roles";

export const AGENT_DOCUMENT_ROLE_VALUES = [
  "assistant",
  "producer",
  "director",
  "storyboardDesigner",
  "scriptDesigner",
  "artSupervisor",
  "continuitySupervisor",
  "promptEngineer",
] as const;

export const AGENT_DOCUMENT_STATUS_VALUES = [
  "draft",
  "ready",
  "applied",
  "obsolete",
] as const;

export const agentDocumentRoleSchema = z.string().trim().min(1);
export const agentDocumentStatusSchema = z.enum(AGENT_DOCUMENT_STATUS_VALUES);

export type AgentDocumentRole = z.infer<typeof agentDocumentRoleSchema>;
export type AgentDocumentStatus = z.infer<typeof agentDocumentStatusSchema>;

export const agentDocumentMetaSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  role: agentDocumentRoleSchema.optional(),
  status: agentDocumentStatusSchema.default("draft"),
  path: z.string().trim().min(1),
  relatedPageIds: z.array(z.string().trim().min(1)).default([]),
  updatedAt: z.string().trim().min(1),
  lastAgentRunId: z.string().trim().min(1).optional(),
  summary: z.string().optional(),
});

export const agentDocumentSchema = agentDocumentMetaSchema.extend({
  content: z.string(),
});

export const agentDocumentManifestSchema = z.object({
  projectId: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  roleSetupVersion: z.number().int().nonnegative().default(0),
  documents: z.array(agentDocumentMetaSchema),
  roles: z.array(agentRoleDefinitionSchema).default([]),
});

export type AgentDocumentMeta = z.infer<typeof agentDocumentMetaSchema>;
export type AgentDocument = z.infer<typeof agentDocumentSchema>;
export type AgentDocumentManifest = z.infer<typeof agentDocumentManifestSchema>;

export type AgentDefaultDocumentDefinition = {
  id: string;
  title: string;
  role?: AgentDocumentRole;
  path: string;
  summary: string;
  body: string;
};

export const AGENT_PRIME_DIRECTIVE_DOCUMENT_ID = "prime-directive";
export const AGENT_PRIME_DIRECTIVE_DOCUMENT_TITLE = "Prime Directive";
export const AGENT_PRIME_DIRECTIVE_DOCUMENT_PATH = "docs/PrimeDirective.md";

const WINDOWS_RESERVED_FILE_STEMS = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export const normalizeAgentRoleMetadocFileStem = (roleName: string, fallback = "role") => {
  const normalized = roleName
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .replace(/^-+|-+$/g, "");
  const stem = normalized || fallback;
  if (WINDOWS_RESERVED_FILE_STEMS.has(stem.toLowerCase())) {
    return fallback;
  }
  return stem;
};

export const createAgentRoleMetadocDocumentId = (roleName: string, fallback = "role") =>
  normalizeAgentRoleMetadocFileStem(roleName, fallback);

export const createAgentRoleMetadocPath = (roleName: string, fallback = "role") =>
  `docs/roles/${normalizeAgentRoleMetadocFileStem(roleName, fallback)}.md`;

export const createAgentRoleMetadocPathForRole = (
  role: Pick<AgentRoleDefinition, "id" | "name">,
) => createAgentRoleMetadocPath(role.name, role.id);

export const normalizeAgentDocumentFileStem = (title: string, fallback = "document") =>
  normalizeAgentRoleMetadocFileStem(title, fallback);

export const createAgentDocumentFileNameFromTitle = (title: string, fallback = "document") =>
  `${normalizeAgentDocumentFileStem(title, fallback)}.md`;

export const normalizeAgentDocumentDirectoryPath = (directory: string, fallback = "general") => {
  const trimmed = directory.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const underDocs = trimmed.startsWith("docs/") ? trimmed : `docs/${trimmed || fallback}`;
  const parts = underDocs
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");
  if (parts[0] !== "docs" || parts.some((part) => part === "..")) {
    return `docs/${normalizeAgentDocumentFileStem(fallback, "general")}`;
  }
  return parts.join("/");
};

export const createUniqueAgentDocumentPathFromTitle = (
  title: string,
  directory: string,
  documents: Array<Pick<AgentDocumentMeta, "id" | "path">>,
  ignoreDocumentId?: string | null,
  fallback = "document",
) => {
  const normalizedDirectory = normalizeAgentDocumentDirectoryPath(directory);
  const stem = normalizeAgentDocumentFileStem(title, fallback);
  const usedPaths = new Set(
    documents
      .filter((document) => document.id !== ignoreDocumentId)
      .map((document) => document.path.toLowerCase()),
  );
  let candidate = `${normalizedDirectory}/${stem}.md`;
  let index = 2;
  while (usedPaths.has(candidate.toLowerCase())) {
    candidate = `${normalizedDirectory}/${stem} ${index}.md`;
    index += 1;
  }
  return candidate;
};

export const AGENT_DEFAULT_DOCUMENT_DEFINITIONS: AgentDefaultDocumentDefinition[] = [
  {
    id: AGENT_PRIME_DIRECTIVE_DOCUMENT_ID,
    title: AGENT_PRIME_DIRECTIVE_DOCUMENT_TITLE,
    path: AGENT_PRIME_DIRECTIVE_DOCUMENT_PATH,
    summary:
      "Project-level prime directive that defines the work type, target form, operating constraints, and all-Agent priorities.",
    body: [
      "# Prime Directive",
      "",
      "## Project Form",
      "",
      "Define what this project is. Examples: manga, CG set, illustrated light novel, storyboard pack, prompt book, or another concrete form.",
      "",
      "## Creator Intent",
      "",
      "State what the human creator wants this project to become, including audience, tone, format, and delivery target.",
      "",
      "## Agent Operating Directive",
      "",
      "- This document is project-level direction for every Agent role.",
      "- Agents must interpret role metadocs, page evidence, scripts, prompts, and ordinary documents through this directive.",
      "- If a role metadoc or chat instruction conflicts with this document, follow this document and report the conflict.",
      "- Role metadocs are role prompts and role definitions only. Agent work output belongs in that role's working directory.",
      "- Agents cannot rewrite this directive through Agent document tools.",
      "",
      "## Project-Specific Rules",
      "",
      "- Work type:",
      "- Must preserve:",
      "- Must avoid:",
      "- Definition of done:",
      "",
    ].join("\n"),
  },
  {
    id: "assistant-metadoc",
    title: "Assistant Metadoc",
    role: "assistant",
    path: "docs/roles/Assistant.md",
    summary: "General assistant role prompt/definition. Durable assistance output belongs under the assistant working directory.",
    body: [
      "# Assistant Metadoc",
      "",
      "## Role",
      "",
      "Assist the human creator with project inspection, suggestions, manual edit guidance, and durable documentation updates.",
      "",
      "## Operating Rules",
      "",
      "- Read only the documents, pages, assets, and renders needed for the current request.",
      "- Do not treat conversation context as production state.",
      "- Record durable output under `docs/work/assistant/`.",
      "",
      "## Context Priority",
      "",
      "Pinned context is the system prompt, `docs/PrimeDirective.md`, and this role prompt. Working output can be evicted from the model window and reread on demand.",
      "",
    ].join("\n"),
  },
  {
    id: "production-plan",
    title: "Production Plan",
    role: "producer",
    path: "docs/roles/Producer.md",
    summary: "Producer role prompt/definition. Producer output belongs under docs/work/producer/.",
    body: [
      "# Production Plan",
      "",
      "## Role",
      "",
      "Plan production work, scope, acceptance criteria, unresolved decisions, and task order for the human creator.",
      "",
      "## Operating Rules",
      "",
      "- Treat this metadoc as role prompt and role definition only.",
      "- Put producer output under `docs/work/producer/`.",
      "- Do not modify comic pages directly.",
      "",
    ].join("\n"),
  },
  {
    id: "story-architecture",
    title: "Story Architecture",
    role: "director",
    path: "docs/roles/Director.md",
    summary: "Director role prompt/definition. Director output belongs under docs/work/director/.",
    body: [
      "# Story Architecture",
      "",
      "## Role",
      "",
      "The director supervises page intent, rhythm, shot order, reader attention, and whether execution serves the documented story plan.",
      "",
      "## Operating Rules",
      "",
      "- Treat this metadoc as role prompt and role definition only.",
      "- Put story architecture, direction decisions, and supervision notes under `docs/work/director/`.",
      "- Use page/render evidence only when it is needed for the current request.",
      "",
    ].join("\n"),
  },
  {
    id: "storyboard-overview",
    title: "Storyboard Overview",
    role: "storyboardDesigner",
    path: "docs/roles/Storyboard Designer.md",
    summary: "Storyboard designer role prompt/definition. Storyboard output belongs under docs/work/storyboardDesigner/.",
    body: [
      "# Storyboard Overview",
      "",
      "## Role",
      "",
      "Design page beats, panel structure, camera distance, composition, and reading flow.",
      "",
      "## Operating Rules",
      "",
      "- Treat this metadoc as role prompt and role definition only.",
      "- Put storyboard output under `docs/work/storyboardDesigner/`.",
      "- Record proposed page/panel edits in Markdown instead of executing them directly.",
      "",
    ].join("\n"),
  },
  {
    id: "script-dialogue",
    title: "Script and Dialogue",
    role: "scriptDesigner",
    path: "docs/roles/Script Designer.md",
    summary: "Script designer role prompt/definition. Script output belongs under docs/work/scriptDesigner/.",
    body: [
      "# Script and Dialogue",
      "",
      "## Role",
      "",
      "Design dialogue, captions, narration, tone, and text-placement notes.",
      "",
      "## Operating Rules",
      "",
      "- Treat this metadoc as role prompt and role definition only.",
      "- Put script and dialogue output under `docs/work/scriptDesigner/`.",
      "- Keep manga text concise and map wording to page/panel/object ids when available.",
      "",
    ].join("\n"),
  },
  {
    id: "art-supervision",
    title: "Art Supervision",
    role: "artSupervisor",
    path: "docs/roles/Art Supervisor.md",
    summary: "Art supervisor role prompt/definition. Art supervision output belongs under docs/work/artSupervisor/.",
    body: [
      "# Art Supervision",
      "",
      "## Role",
      "",
      "Review visual style, rendering consistency, image assets, crops, composition, and art-direction risks.",
      "",
      "## Operating Rules",
      "",
      "- Treat this metadoc as role prompt and role definition only.",
      "- Put art supervision output under `docs/work/artSupervisor/`.",
      "- Compare resources with rendered pages only when the task needs visual evidence.",
      "",
    ].join("\n"),
  },
  {
    id: "continuity-check",
    title: "Continuity Check",
    role: "continuitySupervisor",
    path: "docs/roles/Continuity Supervisor.md",
    summary: "Continuity supervisor role prompt/definition. Continuity output belongs under docs/work/continuitySupervisor/.",
    body: [
      "# Continuity Check",
      "",
      "## Role",
      "",
      "Check page order, character state, props, dialogue continuity, reading order, and unresolved continuity issues.",
      "",
      "## Operating Rules",
      "",
      "- Treat this metadoc as role prompt and role definition only.",
      "- Put continuity output under `docs/work/continuitySupervisor/`.",
      "- Request bounded page samples unless the creator narrows the scope.",
      "",
    ].join("\n"),
  },
  {
    id: "image-prompts",
    title: "Image Prompts",
    role: "promptEngineer",
    path: "docs/roles/Prompt Engineer.md",
    summary: "Prompt engineer role prompt/definition. Prompt output belongs under docs/work/promptEngineer/.",
    body: [
      "# Image Prompts",
      "",
      "## Role",
      "",
      "Design image prompts, prompt rules, negative constraints, and page/panel prompt records.",
      "",
      "## Operating Rules",
      "",
      "- Treat this metadoc as role prompt and role definition only.",
      "- Put prompt rules and generated prompts under `docs/work/promptEngineer/`.",
      "- Keep prompts mapped to page or panel ids when possible.",
      "",
    ].join("\n"),
  },
];

export const createAgentDocumentMeta = (
  definition: AgentDefaultDocumentDefinition,
  updatedAt: string,
): AgentDocumentMeta => ({
  id: definition.id,
  title: definition.title,
  ...(definition.role ? { role: definition.role } : {}),
  path: definition.path,
  status: "draft",
  relatedPageIds: [],
  updatedAt,
  summary: definition.summary,
});

const frontmatterValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => JSON.stringify(String(entry))).join(", ")}]`;
  }
  return JSON.stringify(value ?? "");
};

export const stringifyAgentDocumentFrontmatter = (meta: AgentDocumentMeta) => {
  const fields: Array<[string, unknown]> = [
    ["id", meta.id],
    ["title", meta.title],
    ["status", meta.status],
    ["path", meta.path],
    ["relatedPageIds", meta.relatedPageIds],
    ["updatedAt", meta.updatedAt],
  ];
  if (meta.role) {
    fields.splice(2, 0, ["role", meta.role]);
  }
  if (meta.lastAgentRunId) {
    fields.push(["lastAgentRunId", meta.lastAgentRunId]);
  }
  if (meta.summary) {
    fields.push(["summary", meta.summary]);
  }
  return ["---", ...fields.map(([key, value]) => `${key}: ${frontmatterValue(value)}`), "---"].join("\n");
};

const parseFrontmatterScalar = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^["']|["']$/g, "");
  }
};

export const parseAgentDocumentMarkdown = (markdown: string) => {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: {} as Record<string, unknown>, body: markdown };
  }
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) {
    return { frontmatter: {} as Record<string, unknown>, body: markdown };
  }
  const rawFrontmatter = markdown.slice(4, end).trim();
  const body = markdown.slice(end + 4).replace(/^\r?\n/, "");
  const frontmatter: Record<string, unknown> = {};
  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (!key) {
      continue;
    }
    frontmatter[key] = parseFrontmatterScalar(line.slice(separator + 1));
  }
  return { frontmatter, body };
};

export const buildAgentDocumentMarkdown = (meta: AgentDocumentMeta, body: string) =>
  `${stringifyAgentDocumentFrontmatter(meta)}\n\n${body.replace(/^\s+/, "")}`;

export const agentDocumentFromMarkdown = (
  fallbackMeta: AgentDocumentMeta,
  markdown: string,
): AgentDocument => {
  const { frontmatter, body } = parseAgentDocumentMarkdown(markdown);
  const meta = agentDocumentMetaSchema.parse({
    ...fallbackMeta,
    ...frontmatter,
    relatedPageIds: Array.isArray(frontmatter.relatedPageIds)
      ? frontmatter.relatedPageIds
      : fallbackMeta.relatedPageIds,
  });
  return {
    ...meta,
    content: body,
  };
};

export const createDefaultAgentRolesForDocuments = (
  documents: AgentDocumentMeta[],
): AgentRoleDefinition[] => {
  const documentIds = new Set(documents.map((document) => document.id));
  return AGENT_DEFAULT_ROLE_DEFINITIONS.filter((role) => documentIds.has(role.metadocId));
};
