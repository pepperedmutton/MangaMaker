import type {
  AgentDocument,
  AgentDocumentMeta,
  AgentContextSnapshot,
  AgentHarnessSnapshot,
  AgentHarnessToolDefinition,
  AgentHarnessToolResult,
  AgentRenderDetail,
  AgentSnapshotCrop,
  AgentToolCallRequest,
} from "./types";
import { renderPageSnapshot } from "./context";
import {
  listProjectDocuments,
  readProjectDocument,
  writeProjectDocument,
} from "./documents";
import {
  getSysmlConfig,
  listSysmlProjectFiles,
  readSysmlProjectFile,
  validateSysmlProject,
  writeSysmlProjectFile,
} from "../sysml/client";
import {
  SYSML_STANDARD_REFERENCE_TOPIC_IDS,
  getSysmlStandardOverview,
  readSysmlStandardReferenceTopic,
} from "../sysml/standardReference";
import {
  AGENT_MAX_BATCH_READ_PAGES,
  AGENT_MAX_BATCH_RENDER_PAGES,
} from "./toolLimits";
import { createCompletedAgentToolCallIndex } from "./toolCallPolicy";

const now = () => new Date().toISOString();
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_ASSET_LIMIT = 40;
const DEFAULT_DOCUMENT_SEARCH_LIMIT = 20;

const renderDetailSchema = { type: "string", enum: ["preview", "detail"] };
const renderCropSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "width", "height"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number", exclusiveMinimum: 0 },
    height: { type: "number", exclusiveMinimum: 0 },
  },
};

const tool = (
  definition: AgentHarnessToolDefinition,
): AgentHarnessToolDefinition => definition;

const clampLimit = (value: unknown, fallback: number, max: number) => {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(max, parsed));
};

const normalized = (value: unknown) => String(value ?? "").toLowerCase();

const pageIndexEntry = (page: AgentContextSnapshot["pages"][number], index: number) => ({
  id: page.id,
  pageNumber: page.pageNumber ?? index + 1,
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

const documentIndexEntry = (document: AgentDocumentMeta) => ({
  id: document.id,
  title: document.title,
  role: document.role ?? null,
  status: document.status,
  path: document.path,
  relatedPageIds: document.relatedPageIds,
  updatedAt: document.updatedAt,
  summary: document.summary ?? "",
});

const documentResultSummary = (document: AgentDocument) => ({
  id: document.id,
  title: document.title,
  role: document.role ?? null,
  status: document.status,
  path: document.path,
  relatedPageIds: document.relatedPageIds,
  updatedAt: document.updatedAt,
  summary: document.summary ?? "",
  contentLength: document.content.length,
});

const documentLookupFailureResult = (
  requestedDocumentId: string,
  error: unknown,
  availableDocuments: AgentDocumentMeta[],
) => ({
  found: false as const,
  requestedDocumentId,
  error: error instanceof Error ? error.message : String(error),
  availableDocuments: availableDocuments.map(documentIndexEntry),
  guidance:
    "Use one of the available document ids or paths. For role output, prefer the active role metadoc instead of inventing a new document id.",
});

type AgentDocumentLookupFailure = ReturnType<typeof documentLookupFailureResult>;

const isDocumentLookupFailure = (
  value: AgentDocument | AgentDocumentLookupFailure,
): value is AgentDocumentLookupFailure => "found" in value && value.found === false;

const readProjectDocumentForTool = async (
  projectId: string,
  requestedDocumentId: string,
) => {
  try {
    return await readProjectDocument(projectId, requestedDocumentId);
  } catch (error) {
    const manifest = await listProjectDocuments(projectId).catch(() => null);
    return documentLookupFailureResult(requestedDocumentId, error, manifest?.documents ?? []);
  }
};

const searchProject = (
  context: AgentContextSnapshot,
  input: { query?: string; pageId?: string; objectTypes?: string[]; limit?: number },
) => {
  const query = normalized(input.query).trim();
  const objectTypeFilter = new Set(input.objectTypes ?? []);
  const limit = clampLimit(input.limit, DEFAULT_SEARCH_LIMIT, 100);
  const matches: Array<{
    pageId: string;
    pageNumber: number;
    pageName: string;
    objectId?: string;
    objectRef?: string;
    panelRef?: string;
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

  for (const [pageIndex, page] of context.pages.entries()) {
    const pageNumber = page.pageNumber ?? pageIndex + 1;
    if (input.pageId && page.id !== input.pageId) {
      continue;
    }
    if (matchesQuery(page.name)) {
      addMatch({
        pageId: page.id,
        pageNumber,
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
          pageNumber,
          pageName: page.name,
          objectId: object.id,
          objectRef: object.objectRef,
          panelRef: object.objectType === "panel" ? object.panelRef ?? `${page.id}:${object.id}` : undefined,
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
      ["panelRef", asset.panelRef],
    ] as const;
    for (const [field, value] of fields) {
      if (!value || !matchesQuery(value)) {
        continue;
      }
      addMatch({
        pageId: asset.pageId,
        pageName: asset.pageName,
        pageNumber: context.pages.findIndex((page) => page.id === asset.pageId) + 1 || 0,
        objectId: asset.panelId,
        objectRef: `${asset.pageId}:panel:${asset.panelId}`,
        panelRef: asset.panelRef,
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

const searchDocuments = async (
  context: AgentContextSnapshot,
  input: { query?: string; role?: string; limit?: number },
) => {
  const query = normalized(input.query).trim();
  const limit = clampLimit(input.limit, DEFAULT_DOCUMENT_SEARCH_LIMIT, 100);
  const manifest = await listProjectDocuments(context.project.id);
  const candidateDocs = manifest.documents.filter((document) => {
    if (input.role && document.role !== input.role) {
      return false;
    }
    return true;
  });
  const matches: Array<{
    documentId: string;
    title: string;
    role: string | null;
    path: string;
    field: string;
    snippet: string;
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

  for (const meta of candidateDocs) {
    const fields = [
      ["title", meta.title],
      ["summary", meta.summary],
      ["path", meta.path],
      ["role", meta.role],
    ] as const;
    for (const [field, value] of fields) {
      if (!value || !matchesQuery(value)) {
        continue;
      }
      addMatch({
        documentId: meta.id,
        title: meta.title,
        role: meta.role ?? null,
        path: meta.path,
        field,
        snippet: String(value).slice(0, 240),
      });
    }
    if (query) {
      const document = await readProjectDocument(context.project.id, meta.id);
      const lowerContent = normalized(document.content);
      const matchIndex = lowerContent.indexOf(query);
      if (matchIndex >= 0) {
        const start = Math.max(0, matchIndex - 120);
        const end = Math.min(document.content.length, matchIndex + query.length + 120);
        addMatch({
          documentId: meta.id,
          title: meta.title,
          role: meta.role ?? null,
          path: meta.path,
          field: "content",
          snippet: document.content.slice(start, end),
        });
      }
    }
  }

  return {
    query: input.query ?? "",
    role: input.role ?? null,
    limit,
    totalMatches,
    returned: matches.length,
    truncated: totalMatches > matches.length,
    matches,
  };
};

const validateDocumentAgainstProject = async (
  context: AgentContextSnapshot,
  input: { documentId?: string },
) => {
  const documentId = input.documentId ?? "";
  const document = await readProjectDocumentForTool(context.project.id, documentId);
  if (isDocumentLookupFailure(document)) {
    return {
      ...document,
      ok: false,
      referencedPageIds: [],
      missingPageIds: [],
    };
  }
  const existingPageIds = new Set(context.pages.map((page) => page.id));
  const referencedPageIds = new Set<string>();
  const pageIdPattern = /\bpage[-_A-Za-z0-9]+\b/g;
  for (const match of document.content.matchAll(pageIdPattern)) {
    referencedPageIds.add(match[0]);
  }
  for (const pageId of document.relatedPageIds) {
    referencedPageIds.add(pageId);
  }
  const missingPageIds = Array.from(referencedPageIds).filter((pageId) => !existingPageIds.has(pageId));
  return {
    document: documentResultSummary(document),
    referencedPageIds: Array.from(referencedPageIds),
    missingPageIds,
    ok: missingPageIds.length === 0,
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
    return [asset.src, asset.prompt, asset.description, asset.panelId, asset.panelRef, asset.pageName].some((value) =>
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
    description: "Search page names, object text, descriptions, image prompts, panel ids, and image resource references when the supplied harness results do not already identify the needed page or object.",
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
    description: "Read one page's full structured manga-editing context, including panels, image crops, text, bubbles, and layer order. Do not repeat the same pageId if readPage/readPages or a cacheHit result already supplied that page.",
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
    name: "readPages",
    description: "Read several pages' full structured context in one call when those pages are not already present in tool results. Do not repeat the same pageIds after readPages or cacheHit supplied them.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pageIds"],
      properties: {
        pageIds: {
          type: "array",
          minItems: 1,
          maxItems: AGENT_MAX_BATCH_READ_PAGES,
          items: { type: "string" },
        },
      },
    },
    outputDescription: "Requested page object summaries in pageIds order, without raw image bytes.",
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
    description: "List image resources referenced by panels only when existing page/render results do not already include the needed asset references. Optionally filter by pageId or query. Raw image data is not returned by this listing.",
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
    description: "Read the current page visual render metadata and attached vision image status only when no suitable current-page render is already present. Defaults to detail=\"preview\"; use detail=\"detail\" only when small text, faces, or fine line art must be inspected.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        detail: renderDetailSchema,
        crop: renderCropSchema,
      },
    },
    outputDescription: "Canvas snapshot metadata. The prompt may include the current render as a separate image attachment when vision is enabled.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "renderPage",
    description: "Render a specific page to a bounded visual screenshot only when the final composed page result is needed and no suitable render/cacheHit is already present. Defaults to detail=\"preview\"; pass crop for a panel/region, and use detail=\"detail\" only for small text, faces, or fine line art.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pageId"],
      properties: {
        pageId: { type: "string" },
        detail: renderDetailSchema,
        crop: renderCropSchema,
      },
    },
    outputDescription: "Screenshot metadata plus the page's structured resources. The screenshot is attached as a vision image when the provider supports vision.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "renderPanel",
    description: "Render one panel's bounded visual crop by pageId and panelId only when no suitable panel/page render is already present. A panel always belongs to exactly one page; use panelRef/pageId+panelId from readPage/readPages/listImageAssets.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pageId", "panelId"],
      properties: {
        pageId: { type: "string" },
        panelId: { type: "string" },
        detail: renderDetailSchema,
      },
    },
    outputDescription: "Panel crop screenshot metadata, page owner, panel object summary, and related image resource if present.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "renderPages",
    description: "Render several pages to bounded visual screenshots in one call only when those rendered page results are missing. Defaults to detail=\"preview\" and should be used for a small visual sample, not whole-project high-detail review. Do not repeat the same pageIds/detail after renderPages or cacheHit supplied them.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pageIds"],
      properties: {
        pageIds: {
          type: "array",
          minItems: 1,
          maxItems: AGENT_MAX_BATCH_RENDER_PAGES,
          items: { type: "string" },
        },
        detail: renderDetailSchema,
      },
    },
    outputDescription: "Requested screenshots plus each page's structured resources. Screenshots are attached as vision images when supported.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "listCommandManifest",
    description: "Read the command registry manifest and command payload schemas only before preparing an editor command plan when the schema is not already present. Project mutations must use these command ids and schemas.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Command manifest entries derived from the local command registry.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "listDocuments",
    description: "List durable Markdown production documents in this project when the needed document id is not already known. The active role metadoc is already supplied as readActiveRoleMetadoc.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Document ids, titles, optional role tags, status, paths, related pages, update times, summaries, and role metadoc bindings.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "listRoles",
    description: "List project Agent roles and their required metadoc document ids. Every active role has one metadoc; documents without a matching role are ordinary docs.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Role ids, names, titles, metadoc ids, autonomy defaults, preferred tools, and role prompts.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "readDocument",
    description: "Read one project Markdown document by manifest id only when its content is not already present in readActiveRoleMetadoc, readDocument, or cacheHit results. The backend also accepts path, filename, or exact title as a fallback. If the document is not found, the result returns found=false with available documents instead of failing the run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["documentId"],
      properties: {
        documentId: {
          type: "string",
          description: "Prefer the stable manifest document id from listDocuments/searchDocuments; path, filename, or exact title are accepted only as fallback.",
        },
      },
    },
    outputDescription: "Full document metadata and Markdown content.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "searchDocuments",
    description: "Search durable Markdown production documents by title, summary, path, role, and content only when the preloaded metadoc and known document ids are insufficient.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        role: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
      },
    },
    outputDescription: "Bounded document match list with document ids, roles, fields, and snippets.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "writeDocument",
    description: "Create or update one durable Markdown production document. This is the only successful completion path for document/metadoc edit requests. For role output, update the active role metadoc unless the creator explicitly asks for a new ordinary document.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "id", "title", "content"],
      properties: {
        operationId: {
          type: "string",
          description: "Stable idempotency key for this exact write operation. Reuse only when retrying the same content.",
        },
        id: { type: "string" },
        title: { type: "string" },
        role: { type: "string" },
        status: { type: "string", enum: ["draft", "ready", "applied", "obsolete"] },
        path: { type: "string" },
        relatedPageIds: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        content: { type: "string" },
      },
    },
    outputDescription: "Saved document metadata, verification status, changed/already-applied flags, and content length.",
    mutatesProject: true,
    requiresConfirmation: false,
  }),
  tool({
    name: "validateDocumentAgainstProject",
    description: "Check whether page ids referenced by one Markdown document exist in the current project context only when validation is necessary. Prefer manifest id; path, filename, or exact title are accepted as fallback. Missing lookups return found=false.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["documentId"],
      properties: {
        documentId: {
          type: "string",
          description: "Prefer the stable manifest document id from listDocuments/searchDocuments; path, filename, or exact title are accepted only as fallback.",
        },
      },
    },
    outputDescription: "Referenced page ids, missing ids, and validation status.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "readSysmlStandardOverview",
    description: "Read the built-in SysML v2/KerML/Pilot reference overview and topic index. This short overview is already supplied in the initial harness.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Mandatory SysML harness rules and available reference topics.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "readSysmlStandardReference",
    description: "Read one built-in SysML v2 reference topic before writing or repairing unfamiliar MBSE model semantics.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["topic"],
      properties: {
        topic: { type: "string", enum: [...SYSML_STANDARD_REFERENCE_TOPIC_IDS] },
      },
    },
    outputDescription: "Focused SysML v2/KerML/Pilot guidance for the requested topic.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "getSysmlStatus",
    description: "Read whether the official SysML v2 Pilot validator is configured. Use this before SysML/MBSE work if no SysML status is already present.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "SysML backend status, official Pilot availability, and configuration reason if unavailable.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "listSysmlFiles",
    description: "List project SysML/KerML model files. This does not read full file contents.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "SysML file paths, sizes, hashes, and update times.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "readSysmlFile",
    description: "Read one SysML/KerML model file by path when the model content is needed for MBSE reasoning or editing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: { path: { type: "string" } },
    },
    outputDescription: "One SysML file with content and hash.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "writeSysmlFile",
    description: "Create or update one SysML/KerML model file. Use this for durable MBSE model changes, then validateSysmlModel.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "path", "content"],
      properties: {
        operationId: { type: "string" },
        path: { type: "string" },
        content: { type: "string" },
      },
    },
    outputDescription: "Saved SysML file metadata, idempotency status, changed flag, and content hash.",
    mutatesProject: true,
    requiresConfirmation: false,
  }),
  tool({
    name: "validateSysmlModel",
    description: "Validate the project's SysML model with the official SysML v2 Pilot implementation. Optionally validate only named paths; omit paths for the full model.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
    },
    outputDescription: "Official Pilot validation result, diagnostics, source hash, and validated files.",
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

const projectStateResult = (
  context: AgentContextSnapshot,
  toolName: string,
  input: unknown,
  resultValue: Record<string, unknown>,
) =>
  result(toolName, input, {
    projectUpdatedAt: context.project.updatedAt,
    ...resultValue,
  });

export const buildAgentHarness = (
  context: AgentContextSnapshot,
  dynamicToolResults: AgentHarnessToolResult[] = [],
): AgentHarnessSnapshot => {
  const initialToolResults = [
    result("readProjectSummary", {}, {
      projectUpdatedAt: context.project.updatedAt,
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
      projectUpdatedAt: context.project.updatedAt,
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
    result("readSysmlStandardOverview", {}, getSysmlStandardOverview()),
  ];
  return {
    mode: "tool-harness",
    currentPageId: context.currentPage?.id ?? context.selectedPageId,
    projectId: context.project.id,
    currentPageMarkedBy: "isCurrent",
    tools: AGENT_HARNESS_TOOLS,
    initialToolResults,
    dynamicToolResults,
    completedToolCallIndex: createCompletedAgentToolCallIndex(
      [...initialToolResults, ...dynamicToolResults],
      {
        projectUpdatedAt: context.project.updatedAt,
        currentPageId: context.currentPage?.id ?? context.selectedPageId,
      },
    ),
    resourcePolicy: {
      allPagesReadable: true,
      assetsReadableOnDemand: true,
      documentsReadableOnDemand: true,
      documentsWritableOnDemand: true,
      sysmlReadableOnDemand: true,
      sysmlWritableOnDemand: true,
      sysmlValidationProvider: "official-pilot",
      sysmlStandardReference: "overview-preloaded-topic-tools",
      inlineDataUrlsRedactedFromPrompt: true,
      projectMutationPath: "commandPlanOnly",
      pagePanelBoundary:
        "A page is a top-level comic page. A panel is an object inside exactly one page. Refer to panels by pageId+panelId or panelRef.",
    },
  };
};

const getPageById = (context: AgentContextSnapshot, pageId: string) =>
  context.pages.find((page) => page.id === pageId) ?? null;

const getPanelById = (
  context: AgentContextSnapshot,
  pageId: string,
  panelId: string,
) => {
  const page = getPageById(context, pageId);
  const panel = page?.objects.find((object) => object.objectType === "panel" && object.id === panelId) ?? null;
  return { page, panel };
};

const getPageIdsInput = (input: unknown, maxItems: number) => {
  const requestedPageIds = Array.isArray((input as { pageIds?: unknown }).pageIds)
    ? (input as { pageIds: unknown[] }).pageIds
    : [];
  const validPageIds = requestedPageIds
    .filter((pageId): pageId is string => typeof pageId === "string" && pageId.trim().length > 0)
    .map((pageId) => pageId.trim());
  const pageIds = validPageIds.slice(0, maxItems);
  return {
    pageIds,
    requestedPageIdCount: validPageIds.length,
    maxPageIds: maxItems,
    truncated: validPageIds.length > pageIds.length,
    skippedPageIds: validPageIds.slice(maxItems),
  };
};

const getRenderDetailInput = (input: unknown): AgentRenderDetail => {
  if (!input || typeof input !== "object") {
    return "preview";
  }
  return (input as { detail?: unknown }).detail === "detail" ? "detail" : "preview";
};

const getRenderCropInput = (input: unknown): AgentSnapshotCrop | undefined => {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const crop = (input as { crop?: unknown }).crop;
  if (!crop || typeof crop !== "object") {
    return undefined;
  }
  const { x, y, width, height } = crop as Partial<Record<keyof AgentSnapshotCrop, unknown>>;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { x, y, width, height };
};

export const executeAgentHarnessToolCall = async (
  context: AgentContextSnapshot,
  call: AgentToolCallRequest,
): Promise<AgentHarnessToolResult> => {
  if (call.toolName === "readProjectSummary") {
    return result(call.toolName, call.input, {
      projectUpdatedAt: context.project.updatedAt,
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
    return projectStateResult(context, call.toolName, call.input, searchProject(context, call.input as {
      query?: string;
      pageId?: string;
      objectTypes?: string[];
      limit?: number;
    }));
  }
  if (call.toolName === "readPage") {
    const pageId = (call.input as { pageId?: string }).pageId ?? "";
    const page = getPageById(context, pageId);
    return result(call.toolName, call.input, page ? { ...page, projectUpdatedAt: context.project.updatedAt } : {
      page: null,
      projectUpdatedAt: context.project.updatedAt,
    });
  }
  if (call.toolName === "readPages") {
    const pageIdInput = getPageIdsInput(call.input, AGENT_MAX_BATCH_READ_PAGES);
    return projectStateResult(context, call.toolName, call.input, {
      pageIds: pageIdInput.pageIds,
      requestedPageIdCount: pageIdInput.requestedPageIdCount,
      maxPageIds: pageIdInput.maxPageIds,
      truncated: pageIdInput.truncated,
      skippedPageIds: pageIdInput.skippedPageIds,
      pages: pageIdInput.pageIds.map((pageId) => getPageById(context, pageId)),
    });
  }
  if (call.toolName === "inspectSelection") {
    return result(call.toolName, call.input, {
      projectUpdatedAt: context.project.updatedAt,
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
    return projectStateResult(context, call.toolName, call.input, listFilteredImageAssets(context, call.input as {
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
    const detail = getRenderDetailInput(call.input);
    const crop = getRenderCropInput(call.input);
    const page = getPageById(context, pageId);
    const canvasSnapshot = await renderPageSnapshot(pageId, { detail, crop });
    return projectStateResult(context, call.toolName, call.input, {
      pageId,
      pageName: page?.name ?? null,
      isCurrent: Boolean(page?.isCurrent),
      renderOptions: {
        detail,
        crop: crop ?? null,
      },
      resources: {
        page,
        imageAssets: context.imageAssets.filter((asset) => asset.pageId === pageId),
      },
      canvasSnapshot,
    });
  }
  if (call.toolName === "renderPanel") {
    const pageId = (call.input as { pageId?: string }).pageId ?? "";
    const panelId = (call.input as { panelId?: string }).panelId ?? "";
    const detail = getRenderDetailInput(call.input);
    const { page, panel } = getPanelById(context, pageId, panelId);
    const crop = panel
      ? { x: panel.x, y: panel.y, width: panel.width, height: panel.height }
      : undefined;
    const canvasSnapshot = await renderPageSnapshot(pageId, { detail, crop });
    return projectStateResult(context, call.toolName, call.input, {
      pageId,
      pageName: page?.name ?? null,
      pageNumber: page?.pageNumber ?? null,
      panelId,
      panelRef: page && panel ? `${page.id}:${panel.id}` : null,
      renderOptions: {
        detail,
        crop: crop ?? null,
      },
      panel,
      imageAsset: context.imageAssets.find((asset) => asset.pageId === pageId && asset.panelId === panelId) ?? null,
      canvasSnapshot,
    });
  }
  if (call.toolName === "renderPages") {
    const pageIdInput = getPageIdsInput(call.input, AGENT_MAX_BATCH_RENDER_PAGES);
    const detail = getRenderDetailInput(call.input);
    const results = [];
    for (const pageId of pageIdInput.pageIds) {
      const page = getPageById(context, pageId);
      const canvasSnapshot = await renderPageSnapshot(pageId, { detail });
      results.push({
        pageId,
        pageName: page?.name ?? null,
        isCurrent: Boolean(page?.isCurrent),
        renderOptions: {
          detail,
          crop: null,
        },
        resources: {
          page,
          imageAssets: context.imageAssets.filter((asset) => asset.pageId === pageId),
        },
        canvasSnapshot,
      });
    }
    return projectStateResult(context, call.toolName, call.input, {
      pageIds: pageIdInput.pageIds,
      requestedPageIdCount: pageIdInput.requestedPageIdCount,
      maxPageIds: pageIdInput.maxPageIds,
      truncated: pageIdInput.truncated,
      skippedPageIds: pageIdInput.skippedPageIds,
      detail,
      results,
    });
  }
  if (call.toolName === "listCommandManifest") {
    return result(call.toolName, call.input, context.commandManifest);
  }
  if (call.toolName === "listDocuments") {
    const manifest = await listProjectDocuments(context.project.id);
    return result(call.toolName, call.input, {
      projectId: manifest.projectId,
      updatedAt: manifest.updatedAt,
      roles: manifest.roles.map((role) => ({
        id: role.id,
        name: role.name,
        title: role.title,
        metadocId: role.metadocId,
        defaultAutonomy: role.defaultAutonomy,
        preferredTools: role.preferredTools,
      })),
      documents: manifest.documents.map(documentIndexEntry),
    });
  }
  if (call.toolName === "listRoles") {
    const manifest = await listProjectDocuments(context.project.id);
    return result(call.toolName, call.input, {
      projectId: manifest.projectId,
      updatedAt: manifest.updatedAt,
      roles: manifest.roles,
    });
  }
  if (call.toolName === "readDocument") {
    const documentId = (call.input as { documentId?: string }).documentId ?? "";
    return result(call.toolName, call.input, await readProjectDocumentForTool(context.project.id, documentId));
  }
  if (call.toolName === "searchDocuments") {
    return result(call.toolName, call.input, await searchDocuments(context, call.input as {
      query?: string;
      role?: string;
      limit?: number;
    }));
  }
  if (call.toolName === "writeDocument") {
    const input = call.input as Partial<AgentDocumentMeta> & { content: string; operationId: string };
    let saved: AgentDocument;
    try {
      saved = await writeProjectDocument(context.project.id, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("was already applied with different document content")) {
        return result(call.toolName, call.input, {
          saved: false,
          alreadyApplied: false,
          operationId: input.operationId,
          conflict: true,
          reason: message,
          guidance:
            "This operationId belongs to a different document payload. Do not report this edit as completed. Retry only with a fresh operationId and the intended full document content.",
        });
      }
      throw error;
    }
    return result(call.toolName, call.input, {
      saved: true,
      verified: true,
      operationId: input.operationId,
      document: documentResultSummary(saved),
    });
  }
  if (call.toolName === "validateDocumentAgainstProject") {
    return result(call.toolName, call.input, await validateDocumentAgainstProject(context, call.input as { documentId?: string }));
  }
  if (call.toolName === "readSysmlStandardOverview") {
    return result(call.toolName, call.input, getSysmlStandardOverview());
  }
  if (call.toolName === "readSysmlStandardReference") {
    const topic = (call.input as { topic?: string }).topic ?? "";
    if (!SYSML_STANDARD_REFERENCE_TOPIC_IDS.includes(topic as (typeof SYSML_STANDARD_REFERENCE_TOPIC_IDS)[number])) {
      throw new Error(`Unsupported SysML standard reference topic: ${topic}`);
    }
    return result(
      call.toolName,
      call.input,
      readSysmlStandardReferenceTopic(topic as (typeof SYSML_STANDARD_REFERENCE_TOPIC_IDS)[number]),
    );
  }
  if (call.toolName === "getSysmlStatus") {
    return result(call.toolName, call.input, await getSysmlConfig());
  }
  if (call.toolName === "listSysmlFiles") {
    return result(call.toolName, call.input, await listSysmlProjectFiles(context.project.id));
  }
  if (call.toolName === "readSysmlFile") {
    const filePath = (call.input as { path?: string }).path ?? "";
    return result(call.toolName, call.input, await readSysmlProjectFile(context.project.id, filePath));
  }
  if (call.toolName === "writeSysmlFile") {
    const input = call.input as { operationId?: string; path?: string; content?: string };
    return result(call.toolName, call.input, await writeSysmlProjectFile(context.project.id, {
      path: input.path ?? "",
      content: input.content ?? "",
      operationId: input.operationId,
    }));
  }
  if (call.toolName === "validateSysmlModel") {
    const paths = Array.isArray((call.input as { paths?: unknown }).paths)
      ? ((call.input as { paths: unknown[] }).paths).filter((entry): entry is string => typeof entry === "string")
      : [];
    const files = paths.length > 0
      ? await Promise.all(paths.map((filePath) => readSysmlProjectFile(context.project.id, filePath).then((file) => ({
          path: file.path,
          content: file.content,
        }))))
      : undefined;
    return result(call.toolName, call.input, await validateSysmlProject(context.project.id, files));
  }
  if (call.toolName === "proposeCommandPlan") {
    return result(call.toolName, call.input, {
      accepted: false,
      reason:
        "Return this plan as pendingCommandPlan in the final JSON response so MangaMaker can validate schemas and apply confirmation policy.",
    });
  }
  throw new Error(`Unsupported Agent harness tool: ${call.toolName}`);
};
