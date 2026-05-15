import { z } from "zod";

export const AGENT_AUTONOMY_MODE_VALUES = [
  "adviseOnly",
  "confirmEveryMutation",
  "autoSafeCurrentPage",
  "autoScopedPages",
] as const;

export type AgentRoleId = string;
export type AgentAutonomyMode = (typeof AGENT_AUTONOMY_MODE_VALUES)[number];

export const agentAutonomyModeSchema = z.enum(AGENT_AUTONOMY_MODE_VALUES);

export const AGENT_ROLE_METADOC_PROMPT =
  "Use the active role metadoc as this role's prompt. Read project documents as needed, but mutate durable role output only when it is an existing ordinary document in the role working directory. Do not create documents.";

const normalizeAgentRoleDirectoryStem = (value: string, fallback = "role") => {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[. -]+$/g, "")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

export const createAgentRoleWorkingDirectory = (roleId: string, fallback = "role") =>
  `docs/work/${normalizeAgentRoleDirectoryStem(roleId, fallback)}`;

export const agentRoleDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  metadocId: z.string().trim().min(1),
  workingDirectory: z.string().trim().min(1).optional(),
  defaultAutonomy: agentAutonomyModeSchema.default("adviseOnly"),
  allowedCommandGroups: z.array(z.string().trim().min(1)).default(["read", "document"]),
  preferredTools: z.array(z.string().trim().min(1)).default([
    "listDocuments",
    "readDocument",
    "searchDocuments",
    "replaceDocumentSection",
    "replaceDocumentText",
    "editDocumentLines",
    "writeDocument",
    "deleteDocument",
  ]),
  prompt: z.string().trim().min(1).default(
    AGENT_ROLE_METADOC_PROMPT,
  ),
  builtIn: z.boolean().default(false),
});

export type AgentRoleDefinition = z.infer<typeof agentRoleDefinitionSchema>;

export const getAgentRoleWorkingDirectory = (role: Pick<AgentRoleDefinition, "id" | "workingDirectory">) =>
  role.workingDirectory?.trim() || createAgentRoleWorkingDirectory(role.id, role.id);

const withDocumentPreferredTools = (tools: string[]) =>
  Array.from(new Set([
    ...tools,
    "replaceDocumentSection",
    "replaceDocumentText",
    "editDocumentLines",
    "writeDocument",
    "deleteDocument",
  ]));

export const AGENT_DEFAULT_ROLE_DEFINITIONS: AgentRoleDefinition[] = [
  {
    id: "assistant",
    name: "Assistant",
    title: "Assistant",
    metadocId: "assistant-metadoc",
    workingDirectory: createAgentRoleWorkingDirectory("assistant"),
    defaultAutonomy: "confirmEveryMutation",
    allowedCommandGroups: ["read", "document"],
    preferredTools: withDocumentPreferredTools(["readDocument", "searchProject", "readPage", "listDocuments"]),
    prompt: AGENT_ROLE_METADOC_PROMPT,
    builtIn: true,
  },
  {
    id: "producer",
    name: "Producer",
    title: "Producer",
    metadocId: "production-plan",
    workingDirectory: createAgentRoleWorkingDirectory("producer"),
    defaultAutonomy: "adviseOnly",
    allowedCommandGroups: ["read", "document"],
    preferredTools: withDocumentPreferredTools(["listDocuments", "readDocument", "writeDocument", "searchDocuments"]),
    prompt: AGENT_ROLE_METADOC_PROMPT,
    builtIn: true,
  },
  {
    id: "director",
    name: "Director",
    title: "Director",
    metadocId: "story-architecture",
    workingDirectory: createAgentRoleWorkingDirectory("director"),
    defaultAutonomy: "confirmEveryMutation",
    allowedCommandGroups: ["read", "document", "visualReview"],
    preferredTools: withDocumentPreferredTools(["readDocument", "readPage", "renderPage", "writeDocument"]),
    prompt: AGENT_ROLE_METADOC_PROMPT,
    builtIn: true,
  },
  {
    id: "storyboardDesigner",
    name: "Storyboard Designer",
    title: "Storyboard Designer",
    metadocId: "storyboard-overview",
    workingDirectory: createAgentRoleWorkingDirectory("storyboardDesigner"),
    defaultAutonomy: "autoSafeCurrentPage",
    allowedCommandGroups: ["read", "document", "layout"],
    preferredTools: withDocumentPreferredTools(["readDocument", "readPage", "renderPage", "writeDocument"]),
    prompt: AGENT_ROLE_METADOC_PROMPT,
    builtIn: true,
  },
  {
    id: "scriptDesigner",
    name: "Script Designer",
    title: "Script Designer",
    metadocId: "script-dialogue",
    workingDirectory: createAgentRoleWorkingDirectory("scriptDesigner"),
    defaultAutonomy: "autoSafeCurrentPage",
    allowedCommandGroups: ["read", "document", "text"],
    preferredTools: withDocumentPreferredTools(["readDocument", "readPage", "searchProject", "writeDocument"]),
    prompt: AGENT_ROLE_METADOC_PROMPT,
    builtIn: true,
  },
  {
    id: "artSupervisor",
    name: "Art Supervisor",
    title: "Art Supervisor",
    metadocId: "art-supervision",
    workingDirectory: createAgentRoleWorkingDirectory("artSupervisor"),
    defaultAutonomy: "confirmEveryMutation",
    allowedCommandGroups: ["read", "document", "visualReview"],
    preferredTools: withDocumentPreferredTools(["listImageAssets", "readPage", "renderPage", "writeDocument"]),
    prompt: AGENT_ROLE_METADOC_PROMPT,
    builtIn: true,
  },
  {
    id: "continuitySupervisor",
    name: "Continuity Supervisor",
    title: "Continuity Supervisor",
    metadocId: "continuity-check",
    workingDirectory: createAgentRoleWorkingDirectory("continuitySupervisor"),
    defaultAutonomy: "confirmEveryMutation",
    allowedCommandGroups: ["read", "document", "visualReview"],
    preferredTools: withDocumentPreferredTools(["listPages", "readPages", "renderPages", "writeDocument", "searchDocuments"]),
    prompt: AGENT_ROLE_METADOC_PROMPT,
    builtIn: true,
  },
  {
    id: "promptEngineer",
    name: "Prompt Engineer",
    title: "Prompt Engineer",
    metadocId: "image-prompts",
    workingDirectory: createAgentRoleWorkingDirectory("promptEngineer"),
    defaultAutonomy: "adviseOnly",
    allowedCommandGroups: ["read", "document"],
    preferredTools: withDocumentPreferredTools(["readDocument", "listImageAssets", "readPage", "writeDocument"]),
    prompt: AGENT_ROLE_METADOC_PROMPT,
    builtIn: true,
  },
];

export const AGENT_ROLES = AGENT_DEFAULT_ROLE_DEFINITIONS;
export const DEFAULT_AGENT_ROLE_ID: AgentRoleId = "assistant";

export const getAgentRole = (
  roleId: string | null | undefined,
  roles: AgentRoleDefinition[] = AGENT_DEFAULT_ROLE_DEFINITIONS,
) =>
  roles.find((role) => role.id === roleId) ??
  roles[0] ??
  AGENT_DEFAULT_ROLE_DEFINITIONS[0];

export const getAgentRoleLabel = (
  roleId: string | null | undefined,
  roles: AgentRoleDefinition[] = AGENT_DEFAULT_ROLE_DEFINITIONS,
) => {
  if (!roleId) {
    return "Ordinary document";
  }
  return roles.find((role) => role.id === roleId)?.name ?? roleId;
};

export const createAgentRoleId = (name: string, existingRoles: AgentRoleDefinition[]) => {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "role";
  const existingIds = new Set(existingRoles.map((role) => role.id));
  let candidate = base;
  let index = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
};
