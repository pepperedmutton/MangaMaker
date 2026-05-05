import type {
  AgentContextSnapshot,
  AgentHarnessSnapshot,
  AgentHarnessToolDefinition,
  AgentHarnessToolResult,
  AgentToolCallRequest,
} from "./types";
import { renderPageSnapshot } from "./context";

const now = () => new Date().toISOString();
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_ASSET_LIMIT = 40;

const tool = (
  definition: AgentHarnessToolDefinition,
): AgentHarnessToolDefinition => definition;

const clampLimit = (value: unknown, fallback: number, max: number) => {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(max, parsed));
};

const normalized = (value: unknown) => String(value ?? "").toLowerCase();

const pageIndexEntry = (page: AgentContextSnapshot["pages"][number]) => ({
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
  hasImages: page.objects.some((object) => object.objectType === "panel" && object.hasImage),
  hasText: page.textCount > 0,
  isCurrent: page.isCurrent,
});

const searchProject = (
  context: AgentContextSnapshot,
  input: { query?: string; pageId?: string; objectTypes?: string[]; limit?: number },
) => {
  const query = normalized(input.query).trim();
  const objectTypeFilter = new Set(input.objectTypes ?? []);
  const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT, 100);
  const matches: Array<{
    pageId: string;
    pageName: string;
    objectId?: string;
    objectType?: string;
    assetSrc?: string;
    field: string;
    snippet: string;
    isCurrent: boolean;
  }> = [];
  let totalMatches = 0;
  const addMatch = (entry: (typeof matches)[number]) => {
    totalMatches += 1;
    if (matches.length < limit) {
      matches.push(entry);
    }
  };
  const matchesQuery = (value: unknown) => {
    const text = normalized(value);
    return !query || text.includes(query);
  };

  for (const page of context.pages) {
    if (input.pageId && page.id !== input.pageId) {
      continue;
    }
    if (matchesQuery(page.name)) {
      addMatch({
        pageId: page.id,
        pageName: page.name,
        field: "page.name",
        snippet: page.name,
        isCurrent: page.isCurrent,
      });
    }
    for (const object of page.objects) {
      if (objectTypeFilter.size > 0 && !objectTypeFilter.has(object.objectType)) {
        continue;
      }
      const candidateFields = [
        ["id", object.id],
        ["content", object.content],
        ["description", object.description],
        ["image.prompt", object.image?.prompt],
        ["image.description", object.image?.description],
        ["image.src", object.image?.src],
      ] as const;
      for (const [field, value] of candidateFields) {
        if (!value || !matchesQuery(value)) {
          continue;
        }
        addMatch({
          pageId: page.id,
          pageName: page.name,
          objectId: object.id,
          objectType: object.objectType,
          field,
          snippet: String(value).slice(0, 240),
          isCurrent: page.isCurrent,
        });
      }
    }
  }

  for (const asset of context.imageAssets) {
    if (input.pageId && asset.pageId !== input.pageId) {
      continue;
    }
    const fields = [
      ["src", asset.src],
      ["prompt", asset.prompt],
      ["description", asset.description],
      ["panelId", asset.panelId],
    ] as const;
    for (const [field, value] of fields) {
      if (!value || !matchesQuery(value)) {
        continue;
      }
      addMatch({
        pageId: asset.pageId,
        pageName: asset.pageName,
        objectId: asset.panelId,
        objectType: "panel",
        assetSrc: asset.src,
        field: `asset.${field}`,
        snippet: String(value).slice(0, 240),
        isCurrent: context.currentPage?.id === asset.pageId,
      });
    }
  }

  return {
    query: input.query ?? "",
    limit,
    totalMatches,
    returned: matches.length,
    truncated: totalMatches > matches.length,
    matches,
  };
};

const listFilteredImageAssets = (
  context: AgentContextSnapshot,
  input: { pageId?: string; query?: string; limit?: number },
) => {
  const query = normalized(input.query).trim();
  const limit = clampLimit(input.limit, DEFAULT_ASSET_LIMIT, 100);
  const filtered = context.imageAssets.filter((asset) => {
    if (input.pageId && asset.pageId !== input.pageId) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [asset.src, asset.prompt, asset.description, asset.panelId, asset.pageName].some((value) =>
      normalized(value).includes(query),
    );
  });
  return {
    totalMatches: filtered.length,
    returned: Math.min(filtered.length, limit),
    truncated: filtered.length > limit,
    assets: filtered.slice(0, limit),
  };
};

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
    name: "searchProject",
    description: "Search page names, object text, descriptions, image prompts, panel ids, and image resource references before deciding what to read in detail.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        pageId: { type: "string" },
        objectTypes: {
          type: "array",
          items: { type: "string", enum: ["panel", "text", "bubble", "element"] },
        },
        limit: { type: "number", minimum: 1, maximum: 100 },
      },
    },
    outputDescription: "Bounded match list with page ids, object ids, field names, and short snippets.",
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
    description: "List image resources referenced by panels, optionally filtered by pageId or query. Raw image data is not returned by this listing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pageId: { type: "string" },
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
      },
    },
    outputDescription: "Bounded image asset references, page/panel owners, source dimensions, crop/viewBox, prompt, and description.",
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
    name: "renderPage",
    description: "Render a specific page to a bounded visual screenshot so the multimodal model can inspect the final composed page result.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pageId"],
      properties: { pageId: { type: "string" } },
    },
    outputDescription: "Screenshot metadata plus the page's structured resources. The screenshot is attached as a vision image when the provider supports vision.",
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

export const createAgentHarnessToolResult = (toolName: string, input: unknown, resultValue: unknown): AgentHarnessToolResult => ({
  toolName,
  input,
  result: resultValue,
  createdAt: now(),
});

const result = createAgentHarnessToolResult;

export const buildAgentHarness = (
  context: AgentContextSnapshot,
  dynamicToolResults: AgentHarnessToolResult[] = [],
): AgentHarnessSnapshot => ({
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
    result("listPages", {}, context.pages.map(pageIndexEntry)),
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
  ],
  dynamicToolResults,
  resourcePolicy: {
    allPagesReadable: true,
    assetsReadableOnDemand: true,
    inlineDataUrlsRedactedFromPrompt: true,
    projectMutationPath: "commandPlanOnly",
  },
});

const getPageById = (context: AgentContextSnapshot, pageId: string) =>
  context.pages.find((page) => page.id === pageId) ?? null;

export const executeAgentHarnessToolCall = async (
  context: AgentContextSnapshot,
  call: AgentToolCallRequest,
): Promise<AgentHarnessToolResult> => {
  if (call.toolName === "readProjectSummary") {
    return result(call.toolName, call.input, {
      project: context.project,
      selectedPageId: context.selectedPageId,
      currentPageId: context.currentPage?.id ?? null,
      selection: context.selection,
      multiSelection: context.multiSelection,
      activeTool: context.activeTool,
      zoom: context.zoom,
      saveStatus: context.saveStatus,
    });
  }
  if (call.toolName === "listPages") {
    return result(
      call.toolName,
      call.input,
      context.pages.map(pageIndexEntry),
    );
  }
  if (call.toolName === "searchProject") {
    return result(call.toolName, call.input, searchProject(context, call.input as {
      query?: string;
      pageId?: string;
      objectTypes?: string[];
      limit?: number;
    }));
  }
  if (call.toolName === "readPage") {
    const pageId = (call.input as { pageId?: string }).pageId ?? "";
    return result(call.toolName, call.input, getPageById(context, pageId));
  }
  if (call.toolName === "inspectSelection") {
    return result(call.toolName, call.input, {
      selection: context.selection,
      multiSelection: context.multiSelection,
      selectedObject: context.selectedObject,
      selectionSnapshot: context.selectionSnapshot
        ? {
            ...context.selectionSnapshot,
            dataUrl: context.selectionSnapshot.dataUrl ? "[selection image attachment available]" : null,
          }
        : null,
    });
  }
  if (call.toolName === "listImageAssets") {
    return result(call.toolName, call.input, listFilteredImageAssets(context, call.input as {
      pageId?: string;
      query?: string;
      limit?: number;
    }));
  }
  if (call.toolName === "renderCurrentPage" || call.toolName === "renderPage") {
    const pageId =
      call.toolName === "renderPage"
        ? (call.input as { pageId?: string }).pageId ?? ""
        : context.currentPage?.id ?? context.selectedPageId ?? "";
    const page = getPageById(context, pageId);
    const canvasSnapshot = await renderPageSnapshot(pageId);
    return result(call.toolName, call.input, {
      pageId,
      pageName: page?.name ?? null,
      isCurrent: Boolean(page?.isCurrent),
      resources: {
        page,
        imageAssets: context.imageAssets.filter((asset) => asset.pageId === pageId),
      },
      canvasSnapshot,
    });
  }
  if (call.toolName === "listCommandManifest") {
    return result(call.toolName, call.input, context.commandManifest);
  }
  throw new Error(`Unsupported Agent harness tool: ${call.toolName}`);
};
