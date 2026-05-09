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

export const agentRoleDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  metadocId: z.string().trim().min(1),
  defaultAutonomy: agentAutonomyModeSchema.default("adviseOnly"),
  allowedCommandGroups: z.array(z.string().trim().min(1)).default(["read", "document"]),
  preferredTools: z.array(z.string().trim().min(1)).default([
    "listDocuments",
    "readDocument",
    "searchDocuments",
    "writeDocument",
  ]),
  prompt: z.string().trim().min(1).default(
    "Operate as this MangaMaker project role. Read your metadoc first, record durable output there, and use other documents only as needed.",
  ),
  builtIn: z.boolean().default(false),
});

export type AgentRoleDefinition = z.infer<typeof agentRoleDefinitionSchema>;

export const AGENT_DEFAULT_ROLE_DEFINITIONS: AgentRoleDefinition[] = [
  {
    id: "assistant",
    name: "Assistant",
    title: "General manga production assistant",
    metadocId: "assistant-metadoc",
    defaultAutonomy: "confirmEveryMutation",
    allowedCommandGroups: ["read", "document", "safeCurrentPageEdit"],
    preferredTools: ["readDocument", "searchProject", "readPage", "listDocuments"],
    prompt:
      "Operate as the general MangaMaker assistant. Prefer durable project documents over chat memory. Read your metadoc first, then inspect only the pages, documents, and renders needed for the creator's request.",
    builtIn: true,
  },
  {
    id: "producer",
    name: "Producer",
    title: "Production planner",
    metadocId: "production-plan",
    defaultAutonomy: "adviseOnly",
    allowedCommandGroups: ["read", "document"],
    preferredTools: ["listDocuments", "readDocument", "writeDocument", "searchDocuments"],
    prompt:
      "Operate as the producer. Maintain the production metadoc with goals, constraints, task order, acceptance criteria, and unresolved decisions. Do not make canvas edits unless explicitly asked.",
    builtIn: true,
  },
  {
    id: "director",
    name: "Director",
    title: "Performance and page-flow director",
    metadocId: "story-architecture",
    defaultAutonomy: "confirmEveryMutation",
    allowedCommandGroups: ["read", "document", "safeCurrentPageEdit", "visualReview"],
    preferredTools: ["readDocument", "readPage", "renderPage", "writeDocument", "listCommandManifest"],
    prompt:
      "Operate as the director. Maintain the story architecture metadoc. Focus on page intent, visual rhythm, shot order, reader attention, and whether rendered pages serve the documented plan.",
    builtIn: true,
  },
  {
    id: "storyboardDesigner",
    name: "Storyboard Designer",
    title: "Panel and page structure designer",
    metadocId: "storyboard-overview",
    defaultAutonomy: "autoSafeCurrentPage",
    allowedCommandGroups: ["read", "document", "safeCurrentPageEdit", "layout"],
    preferredTools: ["readDocument", "readPage", "renderPage", "writeDocument", "listCommandManifest"],
    prompt:
      "Operate as the storyboard designer. Maintain storyboard Markdown with page beats, panel count, shot size, composition, and execution notes. Prepare bounded page/panel command plans grounded in the metadoc.",
    builtIn: true,
  },
  {
    id: "scriptDesigner",
    name: "Script Designer",
    title: "Dialogue and captions designer",
    metadocId: "script-dialogue",
    defaultAutonomy: "autoSafeCurrentPage",
    allowedCommandGroups: ["read", "document", "safeCurrentPageEdit", "text"],
    preferredTools: ["readDocument", "readPage", "searchProject", "writeDocument", "listCommandManifest"],
    prompt:
      "Operate as the script designer. Maintain dialogue and caption Markdown. Keep manga text concise, map wording to page/panel/object ids when possible, and prepare text/bubble command plans only through the command manifest.",
    builtIn: true,
  },
  {
    id: "artSupervisor",
    name: "Art Supervisor",
    title: "Style and asset supervisor",
    metadocId: "art-supervision",
    defaultAutonomy: "confirmEveryMutation",
    allowedCommandGroups: ["read", "document", "visualReview"],
    preferredTools: ["listImageAssets", "readPage", "renderPage", "writeDocument"],
    prompt:
      "Operate as the art supervisor. Maintain art-direction Markdown, compare resources with rendered pages, and identify style, crop, composition, and asset issues. Prefer review notes unless the user asks for concrete editor changes.",
    builtIn: true,
  },
  {
    id: "continuitySupervisor",
    name: "Continuity Supervisor",
    title: "Cross-page consistency supervisor",
    metadocId: "continuity-check",
    defaultAutonomy: "confirmEveryMutation",
    allowedCommandGroups: ["read", "document", "visualReview"],
    preferredTools: ["listPages", "readPages", "renderPages", "writeDocument", "searchDocuments"],
    prompt:
      "Operate as the continuity supervisor. Maintain continuity Markdown. Check page order, object state, dialogue continuity, and unresolved issues across pages. Request only bounded page samples unless the creator narrows the scope.",
    builtIn: true,
  },
  {
    id: "promptEngineer",
    name: "Prompt Engineer",
    title: "Image prompt and asset prompt designer",
    metadocId: "image-prompts",
    defaultAutonomy: "adviseOnly",
    allowedCommandGroups: ["read", "document"],
    preferredTools: ["readDocument", "listImageAssets", "readPage", "writeDocument"],
    prompt:
      "Operate as the prompt engineer. Maintain the prompt metadoc with prompt rules and every generated page/panel prompt. Derive prompts from production, storyboard, and art supervision docs, and keep them mapped to page or panel ids.",
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
