import type {
  AgentContextSnapshot,
  AgentHarnessSnapshot,
  AgentHarnessToolDefinition,
  AgentHarnessToolResult,
} from "./types";

const now = () => new Date().toISOString();

const tool = (
  definition: AgentHarnessToolDefinition,
): AgentHarnessToolDefinition => definition;

export const AGENT_HARNESS_TOOLS: AgentHarnessToolDefinition[] = [
  tool({
    name: "readProjectSummary",
    description: "Read project title, type, page count, current viewing page id, selection, save status, and zoom.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Project/session summary without large binary data.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "listPages",
    description: "List every page in reading order. The page currently visible to the creator is marked with isCurrent=true.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Page ids, names, dimensions, object counts, and current-page marker.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "readPage",
    description: "Read one page's full structured manga-editing context, including panels, image crops, text, bubbles, and layer order.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pageId"],
      properties: { pageId: { type: "string" } },
    },
    outputDescription: "Full page object summaries for the requested page, without raw image bytes.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "inspectSelection",
    description: "Read the current selection and selected object summary, if any.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Current selection, multi-selection, selected object, and selection snapshot metadata.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "listImageAssets",
    description: "List image resources referenced by panels across all pages. Raw image data is not returned by this listing.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Image asset ids/src references, page/panel owners, source dimensions, crop/viewBox, prompt, and description.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "renderCurrentPage",
    description: "Read the current page visual render metadata and attached vision image status.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Canvas snapshot metadata. The prompt may include the current render as a separate image attachment when vision is enabled.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "listCommandManifest",
    description: "Read the command registry manifest and command payload schemas. Project mutations must use these command ids and schemas.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Command manifest entries derived from the local command registry.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "proposeCommandPlan",
    description: "Prepare a command plan for validation and possible execution by MangaMaker. This is the only mutation path available to the Agent.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "commands"],
      properties: {
        summary: { type: "string" },
        commands: { type: "array", minItems: 1, items: { type: "object" } },
      },
    },
    outputDescription: "A pendingCommandPlan in the model response. The app validates it against local Zod schemas before display.",
    mutatesProject: true,
    requiresConfirmation: true,
  }),
];

const result = (toolName: string, input: unknown, resultValue: unknown): AgentHarnessToolResult => ({
  toolName,
  input,
  result: resultValue,
  createdAt: now(),
});

export const buildAgentHarness = (context: AgentContextSnapshot): AgentHarnessSnapshot => ({
  mode: "tool-harness",
  currentPageId: context.currentPage?.id ?? context.selectedPageId,
  currentPageMarkedBy: "isCurrent",
  tools: AGENT_HARNESS_TOOLS,
  initialToolResults: [
    result("readProjectSummary", {}, {
      project: context.project,
      selectedPageId: context.selectedPageId,
      currentPageId: context.currentPage?.id ?? null,
      selection: context.selection,
      multiSelection: context.multiSelection,
      activeTool: context.activeTool,
      zoom: context.zoom,
      saveStatus: context.saveStatus,
    }),
    result(
      "listPages",
      {},
      context.pages.map((page) => ({
        id: page.id,
        name: page.name,
        width: page.width,
        height: page.height,
        background: page.background,
        panelCount: page.panelCount,
        textCount: page.textCount,
        bubbleCount: page.bubbleCount,
        layerCount: page.layerCount,
        objectCount: page.objects.length,
        isCurrent: page.isCurrent,
      })),
    ),
    ...context.pages.map((page) =>
      result("readPage", { pageId: page.id }, {
        ...page,
        viewing: page.isCurrent,
      }),
    ),
    result("inspectSelection", {}, {
      selection: context.selection,
      multiSelection: context.multiSelection,
      selectedObject: context.selectedObject,
      selectionSnapshot: context.selectionSnapshot
        ? {
            ...context.selectionSnapshot,
            dataUrl: context.selectionSnapshot.dataUrl ? "[selection image attachment available]" : null,
          }
        : null,
    }),
    result("listImageAssets", {}, context.imageAssets),
    result("renderCurrentPage", {}, {
      ...context.canvasSnapshot,
      dataUrl: context.canvasSnapshot.dataUrl ? "[current page image attachment available]" : null,
    }),
    result("listCommandManifest", {}, context.commandManifest),
  ],
  resourcePolicy: {
    allPagesReadable: true,
    assetsReadableOnDemand: true,
    inlineDataUrlsRedactedFromPrompt: true,
    projectMutationPath: "commandPlanOnly",
  },
});
