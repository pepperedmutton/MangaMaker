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

export const AGENT_DEFAULT_DOCUMENT_DEFINITIONS: AgentDefaultDocumentDefinition[] = [
  {
    id: "assistant-metadoc",
    title: "Assistant Metadoc",
    role: "assistant",
    path: "docs/agent/assistant-metadoc.md",
    summary: "General assistant role definition, operating notes, and durable assistance output.",
    body: [
      "# Assistant Metadoc",
      "",
      "## Role",
      "",
      "Assist the human creator with project inspection, suggestions, bounded command plans, and durable documentation updates.",
      "",
      "## Operating Rules",
      "",
      "- Read only the documents, pages, assets, and renders needed for the current request.",
      "- Do not treat conversation context as production state.",
      "- Record durable output in Markdown documents when it should survive the session.",
      "",
      "## Output Log",
      "",
      "Record durable assistance notes here when no more specific role document owns them.",
      "",
    ].join("\n"),
  },
  {
    id: "production-plan",
    title: "Production Plan",
    role: "producer",
    path: "docs/production/production-plan.md",
    summary: "Producer-owned project goals, deliverables, constraints, and task order.",
    body: [
      "# Production Plan",
      "",
      "## Goal",
      "",
      "Describe the manga project's creative target, audience, format, and delivery scope.",
      "",
      "## Constraints",
      "",
      "- Pages:",
      "- Style:",
      "- Deadline:",
      "- Must not change:",
      "",
      "## Task Board",
      "",
      "- [ ] Story/script pass",
      "- [ ] Storyboard pass",
      "- [ ] Page execution",
      "- [ ] Continuity review",
      "",
      "## Producer Notes",
      "",
      "Record decisions that other roles should treat as project-level direction.",
      "",
    ].join("\n"),
  },
  {
    id: "story-architecture",
    title: "Story Architecture",
    role: "director",
    path: "docs/director/story-architecture.md",
    summary: "Director metadoc for story structure, page flow, supervision decisions, and scene intent.",
    body: [
      "# Story Architecture",
      "",
      "## Role",
      "",
      "The director supervises page intent, rhythm, shot order, reader attention, and whether execution serves the documented story plan.",
      "",
      "## Story Structure",
      "",
      "Record the current story architecture, scene order, dramatic beats, and unresolved direction questions.",
      "",
      "## Direction Notes",
      "",
      "Record durable direction decisions and review output here.",
      "",
    ].join("\n"),
  },
  {
    id: "storyboard-overview",
    title: "Storyboard Overview",
    role: "storyboardDesigner",
    path: "docs/storyboard/storyboard-overview.md",
    summary: "Storyboard structure, page beats, panels, visual flow, and execution notes.",
    body: [
      "# Storyboard Overview",
      "",
      "## Page Beats",
      "",
      "List each page's dramatic purpose and visual reading order.",
      "",
      "## Panel Plan",
      "",
      "Use one section per page. Include panel count, camera distance, composition, and important props.",
      "",
      "## Execution Notes",
      "",
      "When this document drives canvas edits, describe the intended panel/text/bubble changes clearly.",
      "",
    ].join("\n"),
  },
  {
    id: "script-dialogue",
    title: "Script and Dialogue",
    role: "scriptDesigner",
    path: "docs/script/script-dialogue.md",
    summary: "Dialogue, captions, narration, tone, and text placement notes.",
    body: [
      "# Script and Dialogue",
      "",
      "## Voice Rules",
      "",
      "Define tone, speech style, and terminology.",
      "",
      "## Page Text",
      "",
      "Use page and panel headings. Keep text short enough for manga bubbles.",
      "",
      "## Revision Notes",
      "",
      "Track wording decisions that should be reflected in text objects or bubbles.",
      "",
    ].join("\n"),
  },
  {
    id: "art-supervision",
    title: "Art Supervision",
    role: "artSupervisor",
    path: "docs/art/art-supervision.md",
    summary: "Visual style, rendering consistency, assets, and art-direction checks.",
    body: [
      "# Art Supervision",
      "",
      "## Style Guide",
      "",
      "Record line, tone, palette, framing, and visual consistency rules.",
      "",
      "## Asset Notes",
      "",
      "List image assets, prompts, crops, and issues that require replacement or correction.",
      "",
    ].join("\n"),
  },
  {
    id: "continuity-check",
    title: "Continuity Check",
    role: "continuitySupervisor",
    path: "docs/continuity/continuity-check.md",
    summary: "Cross-page continuity, object placement, reading order, and unresolved issues.",
    body: [
      "# Continuity Check",
      "",
      "## Checks",
      "",
      "- Character state:",
      "- Props:",
      "- Page order:",
      "- Dialogue continuity:",
      "",
      "## Issues",
      "",
      "Record issues with page ids and proposed fixes.",
      "",
    ].join("\n"),
  },
  {
    id: "image-prompts",
    title: "Image Prompts",
    role: "promptEngineer",
    path: "docs/prompts/image-prompts.md",
    summary: "Panel and asset prompts derived from production, storyboard, and art direction.",
    body: [
      "# Image Prompts",
      "",
      "## Prompt Rules",
      "",
      "Define style tags, negative constraints, and asset naming conventions.",
      "",
      "## Page Prompts",
      "",
      "Use page/panel ids where possible so prompts can be mapped back to panels.",
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
