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
import type { AgentModelCapability } from "./modelCatalog";
import { renderPageSnapshot } from "./context";
import {
  deleteProjectDocument,
  listProjectDocuments,
  readProjectDocument,
  writeProjectDocument,
} from "./documents";
import {
  AGENT_DOCUMENT_WRITE_SCOPE,
  createAgentDocumentWriteScopeBlockedResult,
  validateExistingAgentDocumentWriteScope,
} from "./documentWriteScope";
import {
  applyAppendDocumentEdit,
  applyEditDocumentLinesEdit,
  applyReplaceDocumentSectionEdit,
  applyReplaceDocumentTextEdit,
  createDocumentLinesResult,
  incrementalDocumentEditFailureReason,
  isIncrementalDocumentEditVerifiedNoop,
  type AppendDocumentInput,
  type EditDocumentLinesInput,
  type IncrementalDocumentEdit,
  type ReplaceDocumentSectionInput,
  type ReplaceDocumentTextInput,
} from "./documentEditTools";
import {
  AGENT_MAX_BATCH_READ_PAGES,
  AGENT_MAX_BATCH_RENDER_PAGES,
} from "./toolLimits";
import { createCompletedAgentToolCallIndex } from "./toolCallPolicy";

const now = () => new Date().toISOString();
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_ASSET_LIMIT = 40;
const DEFAULT_DOCUMENT_SEARCH_LIMIT = 20;

export type AgentHarnessOptions = {
  modelCapability?: AgentModelCapability;
  activeMetadocId?: string;
  activeRoleWorkingDirectory?: string;
  primeDirective?: AgentDocument;
};

export const METADOC_ONLY_AGENT_TOOL_NAMES = new Set([
  "listDocuments",
  "listRoles",
  "readDocument",
  "readDocumentLines",
  "searchDocuments",
  "writeDocument",
  "appendDocument",
  "replaceDocumentSection",
  "replaceDocumentText",
  "editDocumentLines",
  "deleteDocument",
  "validateDocumentAgainstProject",
]);

export const isMetadocOnlyAgentToolName = (toolName: string) =>
  METADOC_ONLY_AGENT_TOOL_NAMES.has(toolName);

export const isMetadocOnlyToolCallAllowed = (
  call: AgentToolCallRequest,
) =>
  isMetadocOnlyAgentToolName(call.toolName);

export const createMetadocOnlyToolBlockedResult = (
  call: AgentToolCallRequest,
  activeMetadocId?: string | null,
  activeRoleWorkingDirectory?: string | null,
  projectUpdatedAt?: string | null,
) =>
  createAgentHarnessToolResult(call.toolName, call.input, {
    projectUpdatedAt: projectUpdatedAt ?? null,
    blocked: true,
    reason:
      "This Agent model is configured for text-only document work. It cannot read pages, image assets, or renders.",
    activeMetadocId: activeMetadocId ?? null,
    activeRoleWorkingDirectory: activeRoleWorkingDirectory ?? null,
    allowedTools: Array.from(METADOC_ONLY_AGENT_TOOL_NAMES),
    guidance:
      "Use the preloaded readPrimeDirective and readActiveRoleMetadoc results for pinned context. This mode is document-only: it may read/list/search any Markdown document and mutate only existing ordinary documents under the active role working directory, but it cannot create documents or inspect pages, images, or renders.",
  });

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

const documentWriteInputWouldChange = (
  existing: AgentDocument,
  input: Partial<AgentDocumentMeta> & { content: string },
) => {
  const relatedPageIdsChanged = Array.isArray(input.relatedPageIds) &&
    JSON.stringify(input.relatedPageIds) !== JSON.stringify(existing.relatedPageIds);
  return input.content !== existing.content ||
    (typeof input.title === "string" && input.title !== existing.title) ||
    (typeof input.role === "string" && input.role !== existing.role) ||
    (typeof input.status === "string" && input.status !== existing.status) ||
    (typeof input.path === "string" && input.path !== existing.path) ||
    (typeof input.summary === "string" && input.summary !== (existing.summary ?? "")) ||
    relatedPageIdsChanged;
};

const primeDirectiveResultValue = (document: AgentDocument) => ({
  document: {
    id: document.id,
    title: document.title,
    path: document.path,
    status: document.status,
    summary: document.summary ?? "",
    content: document.content,
    contentLength: document.content.length,
  },
  priority:
    "Project-level directive. Interpret role metadocs, creator requests, page evidence, and output documents through this directive.",
  conflictRule:
    "If role instructions, chat, or ordinary documents conflict with PrimeDirective.md, follow PrimeDirective.md and report the conflict.",
});

const incrementalDocumentEditSummary = (
  document: AgentDocument,
  edit: IncrementalDocumentEdit,
) => ({
  saved: true,
  verified: true,
  changed: edit.changed,
  edit,
  document: documentResultSummary(document),
});

const incrementalDocumentNoWriteSummary = (
  document: AgentDocument,
  edit: Parameters<typeof incrementalDocumentEditSummary>[1],
) => {
  const verified = isIncrementalDocumentEditVerifiedNoop(edit);
  return {
    saved: verified,
    verified,
    changed: false,
    alreadyApplied: verified,
    edit,
    document: documentResultSummary(document),
    reason: verified
      ? "The requested document edit was already present, so no file write was needed."
      : incrementalDocumentEditFailureReason(edit),
    guidance: verified
      ? "Treat this document edit as complete. Do not call the same document mutation again."
      : "Do not report the document edit as completed. Use the available document content to choose a correct heading/text target or ask for clarification.",
  };
};

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
    "Use one of the available document ids or paths. The Agent may edit or delete only existing ordinary Markdown documents under the active role working directory; if the target is missing, ask the creator to create it manually first.",
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
    name: "listDocuments",
    description: "List durable Markdown production documents in this project when the needed document id is not already known. The active role metadoc is already supplied as readActiveRoleMetadoc and is the role prompt/definition, not a work-output log.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Document ids, titles, optional role tags, status, paths, related pages, update times, summaries, and role metadoc bindings.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "listRoles",
    description: "List project Agent roles, required role prompt metadoc ids, and working directories. Every active role has one metadoc; work output should live in ordinary docs under the role working directory.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputDescription: "Role ids, names, metadoc ids, working directories, autonomy defaults, and preferred tools. The role metadoc content is the role prompt.",
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
    description: "Search durable Markdown production documents by title, summary, path, role, and content only when the preloaded Prime Directive, role metadoc, and known document ids are insufficient.",
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
    description: "Replace one existing durable Markdown production document with complete revised Markdown content. The Agent is forbidden to create new Markdown documents; if the target document does not already exist, ask the creator to create it manually. Prefer replaceDocumentSection or replaceDocumentText for focused edits; use appendDocument only for plain heading-free additive notes/log lines. Hard rule: reads may inspect any Markdown document, but writes are allowed only for existing ordinary docs under harness.resourcePolicy.activeRoleWorkingDirectory. Do not mutate role metadocs, PrimeDirective.md, or documents outside that working directory.",
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
    name: "readDocumentLines",
    description: "Read a Markdown document with stable 1-based line numbers. Use this before editDocumentLines when deleting, inserting, or replacing an arbitrary line range.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["documentId"],
      properties: {
        documentId: {
          type: "string",
          description: "Prefer the stable manifest document id from listDocuments/searchDocuments; path, filename, or exact title are accepted only as fallback.",
        },
        startLine: { type: "number", minimum: 1 },
        endLine: { type: "number", minimum: 1 },
      },
    },
    outputDescription: "Document metadata, total line count, requested line range, and line-numbered Markdown text.",
    mutatesProject: false,
    requiresConfirmation: false,
  }),
  tool({
    name: "appendDocument",
    description: "Append plain Markdown body text to an existing working-dir document or existing heading. Use only for truly additive notes, logs, or checklist items. Do not use this for replacing/restructuring sections, page ranges, metadoc plans, or any content that contains Markdown headings; use replaceDocumentSection or writeDocument for those edits. Writes are blocked unless the target document already lives under harness.resourcePolicy.activeRoleWorkingDirectory.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "documentId", "content"],
      properties: {
        operationId: {
          type: "string",
          description: "Stable idempotency key for this exact append operation. Reuse only when retrying the same content.",
        },
        documentId: {
          type: "string",
          description: "Stable manifest document id, path, filename, or exact title. For role output, prefer an ordinary document under the active role working directory.",
        },
        heading: {
          type: "string",
          description: "Optional existing heading to append under. If absent, content is appended to the end of the document.",
        },
        createHeadingIfMissing: {
          type: "boolean",
          description: "Legacy compatibility only. Prefer replaceDocumentSection to create a heading section.",
        },
        title: { type: "string" },
        role: { type: "string" },
        status: { type: "string", enum: ["draft", "ready", "applied", "obsolete"] },
        path: { type: "string" },
        relatedPageIds: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        content: { type: "string" },
      },
    },
    outputDescription: "Saved document metadata plus append summary, changed flag, target heading, and content lengths. Heading-bearing content is refused as an unsafe append.",
    mutatesProject: true,
    requiresConfirmation: false,
  }),
  tool({
    name: "deleteDocument",
    description: "Delete one existing ordinary Markdown document from the active role working directory when the creator explicitly asks for that document to be removed. This cannot delete PrimeDirective.md, role metadocs, or documents outside harness.resourcePolicy.activeRoleWorkingDirectory. The Agent may not create replacement documents.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "documentId"],
      properties: {
        operationId: {
          type: "string",
          description: "Stable idempotency key for this exact delete operation.",
        },
        documentId: {
          type: "string",
          description: "Stable manifest document id from listDocuments/searchDocuments. Path, filename, or exact title may be accepted by the backend as fallback.",
        },
      },
    },
    outputDescription: "Deletion verification, removed document metadata, and updated document manifest counts.",
    mutatesProject: true,
    requiresConfirmation: false,
  }),
  tool({
    name: "replaceDocumentSection",
    description: "Replace the body of one Markdown heading section in an existing working-dir document, or create that section when createIfMissing is not false. Use this for role output documents such as page ranges, plans, character notes, prompt rules, or supervision records. Writes are blocked unless the target document already lives under harness.resourcePolicy.activeRoleWorkingDirectory.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "documentId", "heading", "content"],
      properties: {
        operationId: {
          type: "string",
          description: "Stable idempotency key for this exact section replacement. Reuse only when retrying the same content.",
        },
        documentId: {
          type: "string",
          description: "Stable manifest document id, path, filename, or exact title. For role output, prefer an ordinary document under the active role working directory.",
        },
        heading: { type: "string" },
        headingLevel: { type: "number", minimum: 1, maximum: 6 },
        occurrence: { type: "number", minimum: 1 },
        createIfMissing: { type: "boolean" },
        contentIncludesHeading: {
          type: "boolean",
          description: "Set true only when content already includes the Markdown heading line to write as the complete replacement section.",
        },
        title: { type: "string" },
        role: { type: "string" },
        status: { type: "string", enum: ["draft", "ready", "applied", "obsolete"] },
        path: { type: "string" },
        relatedPageIds: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        content: { type: "string" },
      },
    },
    outputDescription: "Saved document metadata plus section replacement summary, changed flag, heading, occurrence, and content lengths.",
    mutatesProject: true,
    requiresConfirmation: false,
  }),
  tool({
    name: "replaceDocumentText",
    description: "Replace an exact text span in an existing working-dir Markdown document. Use this for precise small edits when the old text is known from readDocument/readDocumentLines. Writes are blocked unless the target document already lives under harness.resourcePolicy.activeRoleWorkingDirectory.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "documentId", "oldText", "newText"],
      properties: {
        operationId: {
          type: "string",
          description: "Stable idempotency key for this exact text replacement. Reuse only when retrying the same text replacement.",
        },
        documentId: {
          type: "string",
          description: "Stable manifest document id, path, filename, or exact title. For role output, prefer an ordinary document under the active role working directory.",
        },
        oldText: { type: "string" },
        newText: { type: "string" },
        replaceAll: { type: "boolean" },
        title: { type: "string" },
        role: { type: "string" },
        status: { type: "string", enum: ["draft", "ready", "applied", "obsolete"] },
        path: { type: "string" },
        relatedPageIds: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
    },
    outputDescription: "Saved document metadata plus exact text replacement count, changed flag, and content lengths.",
    mutatesProject: true,
    requiresConfirmation: false,
  }),
  tool({
    name: "editDocumentLines",
    description: "Apply arbitrary Markdown line edits to an existing working-dir document using 1-based line numbers from readDocumentLines. Use this for deleting any line range, replacing any line range, or inserting text at any line when section/text tools are too narrow. Multiple operations are interpreted against the original line-numbered snapshot and applied from bottom to top. Writes are blocked unless the target document already lives under harness.resourcePolicy.activeRoleWorkingDirectory.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["operationId", "documentId", "operations"],
      properties: {
        operationId: {
          type: "string",
          description: "Stable idempotency key for this exact set of line edits. Reuse only when retrying the same edit.",
        },
        documentId: {
          type: "string",
          description: "Stable manifest document id, path, filename, or exact title. For role output, prefer an ordinary document under the active role working directory.",
        },
        operations: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: { type: "string", enum: ["replace", "delete", "insertBefore", "insertAfter"] },
              startLine: { type: "number", minimum: 1 },
              endLine: { type: "number", minimum: 1 },
              line: { type: "number", minimum: 0 },
              content: { type: "string" },
            },
          },
        },
        title: { type: "string" },
        role: { type: "string" },
        status: { type: "string", enum: ["draft", "ready", "applied", "obsolete"] },
        path: { type: "string" },
        relatedPageIds: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
    },
    outputDescription: "Saved document metadata plus line edit summary, changed flag, applied operation count, line counts, and content lengths.",
    mutatesProject: true,
    requiresConfirmation: false,
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
  options: AgentHarnessOptions = {},
): AgentHarnessSnapshot => {
  const modelCapability = options.modelCapability ?? "multimodal";
  const metadocOnly = modelCapability === "metadoc";
  const existingPrimeDirectiveResult = dynamicToolResults.find((entry) => entry.toolName === "readPrimeDirective");
  const existingPrimeDirectiveInput =
    existingPrimeDirectiveResult?.input &&
    typeof existingPrimeDirectiveResult.input === "object" &&
    !Array.isArray(existingPrimeDirectiveResult.input)
      ? existingPrimeDirectiveResult.input as Record<string, unknown>
      : {};
  const primeDirectiveDocumentId =
    options.primeDirective?.id ??
    (typeof existingPrimeDirectiveInput.documentId === "string" ? existingPrimeDirectiveInput.documentId : undefined);
  const primeDirectivePreloaded = Boolean(options.primeDirective || existingPrimeDirectiveResult);
  const primeDirectiveResult = options.primeDirective && !existingPrimeDirectiveResult
    ? [
        result(
          "readPrimeDirective",
          { documentId: options.primeDirective.id },
          primeDirectiveResultValue(options.primeDirective),
        ),
      ]
    : [];
  const initialToolResults = metadocOnly
    ? [
        ...primeDirectiveResult,
        result("metadocOnlyPolicy", {}, {
          modelCapability,
          activeMetadocId: options.activeMetadocId ?? null,
          activeRoleWorkingDirectory: options.activeRoleWorkingDirectory ?? null,
          pinnedContext: ["systemPrompt", "readPrimeDirective", "readActiveRoleMetadoc"],
          roleMetadocPurpose: "role-prompt-definition-only",
          visibleContext:
            "This run is restricted to document-only work. Prime Directive and active role metadoc are pinned context. Page context, image assets, and renders are not supplied.",
          allowedTools: Array.from(METADOC_ONLY_AGENT_TOOL_NAMES),
          outputRule:
            "Read any project Markdown document when needed, but write only to ordinary Markdown documents under the active role working directory. Do not mutate role metadocs, PrimeDirective.md, or documents outside the working directory.",
        }),
      ]
    : [
    ...primeDirectiveResult,
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
  ];
  const tools = metadocOnly
    ? AGENT_HARNESS_TOOLS.filter((entry) => isMetadocOnlyAgentToolName(entry.name))
    : AGENT_HARNESS_TOOLS;
  return {
    mode: "tool-harness",
    currentPageId: context.currentPage?.id ?? context.selectedPageId,
    projectId: context.project.id,
    currentPageMarkedBy: "isCurrent",
    tools,
    initialToolResults,
    dynamicToolResults,
    completedToolCallIndex: createCompletedAgentToolCallIndex(
      [...initialToolResults, ...dynamicToolResults],
      {
        projectUpdatedAt: context.project.updatedAt,
        currentPageId: context.currentPage?.id ?? context.selectedPageId,
      },
    ),
    taskProtocol: {
      requiredResponseField: "taskProgress",
      planningRequired: true,
      maxSteps: 12,
      stopRule:
        "Before requesting tools, define the smallest task plan and a concrete stopCondition. Stop as soon as that condition is met instead of continuing exploratory tool use.",
      progressRule:
        "Every model response must update taskProgress with objective, phase, status, steps, currentStepId, stopCondition, nextAction, and percent when useful.",
      actionRule:
        "If taskProgress.status is planning, running, or needs_tool, you must request the exact next harness tool call or mark the task blocked with a concrete stopReason. requestedToolCalls: [] is valid for completed, blocked, or waiting_for_user responses that ask the creator for missing input.",
      completionRule:
        metadocOnly
          ? "When the document task is complete, return requestedToolCalls: [], pendingCommandPlan: null, taskProgress.status: completed, taskProgress.phase: complete, and a stopReason. Do not request page, image, or render tools."
          : "When the task is complete, return requestedToolCalls: [], pendingCommandPlan: null, taskProgress.status: completed, taskProgress.phase: complete, and a stopReason. After any allowed working-dir Markdown mutation returns saved=true, verified=true, and changed=true or alreadyApplied=true, report completion and stop.",
    },
    resourcePolicy: {
      modelCapability,
      metadocOnly,
      ...(options.activeMetadocId ? { activeMetadocId: options.activeMetadocId } : {}),
      ...(options.activeRoleWorkingDirectory ? { activeRoleWorkingDirectory: options.activeRoleWorkingDirectory } : {}),
      roleMetadocPurpose: "role-prompt-definition-only",
      pinnedContext: ["systemPrompt", "readPrimeDirective", "readActiveRoleMetadoc"],
      evictableContext: ["conversationMessages", "dynamicToolResults", "ordinaryDocuments", "pageReads", "renders"],
      allPagesReadable: !metadocOnly,
      assetsReadableOnDemand: !metadocOnly,
      documentsReadableOnDemand: true,
      documentsWritableOnDemand: true,
      documentsCreatableByAgent: false,
      documentWriteScope: AGENT_DOCUMENT_WRITE_SCOPE,
      primeDirectiveDocumentId,
      primeDirectivePreloaded,
      inlineDataUrlsRedactedFromPrompt: true,
      projectMutationPath: "documentOnly",
      pagePanelBoundary:
        metadocOnly
          ? "Unavailable in text-only document mode. This model cannot inspect pages or panels."
          : "A page is a top-level comic page. A panel is an object inside exactly one page. Refer to panels by pageId+panelId or panelRef.",
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
  options: AgentHarnessOptions = {},
): Promise<AgentHarnessToolResult> => {
  if (
    options.modelCapability === "metadoc" &&
    !isMetadocOnlyToolCallAllowed(call)
  ) {
    return createMetadocOnlyToolBlockedResult(
      call,
      options.activeMetadocId,
      options.activeRoleWorkingDirectory,
      context.project.updatedAt,
    );
  }
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
    return result(call.toolName, call.input, {
      available: false,
      reason:
        "Canvas/page command plans are disabled for the built-in Agent. Use editDocumentLines, replaceDocumentSection, replaceDocumentText, appendDocument, writeDocument, or deleteDocument for existing Markdown documents. The Agent cannot create documents.",
    });
  }
  if (call.toolName === "listDocuments") {
    const manifest = await listProjectDocuments(context.project.id);
    return result(call.toolName, call.input, {
      projectId: manifest.projectId,
      updatedAt: manifest.updatedAt,
      roles: manifest.roles.map((role) => ({
        id: role.id,
        name: role.name,
        metadocId: role.metadocId,
        workingDirectory: role.workingDirectory ?? null,
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
      roles: manifest.roles.map((role) => ({
        id: role.id,
        name: role.name,
        metadocId: role.metadocId,
        workingDirectory: role.workingDirectory ?? null,
        defaultAutonomy: role.defaultAutonomy,
        preferredTools: role.preferredTools,
        metadocIsRolePrompt: true,
      })),
    });
  }
  if (call.toolName === "readDocument") {
    const documentId = (call.input as { documentId?: string }).documentId ?? "";
    return result(call.toolName, call.input, await readProjectDocumentForTool(context.project.id, documentId));
  }
  if (call.toolName === "readDocumentLines") {
    const input = call.input as { documentId?: string; startLine?: number; endLine?: number };
    const document = await readProjectDocumentForTool(context.project.id, input.documentId ?? "");
    if (isDocumentLookupFailure(document)) {
      return result(call.toolName, call.input, document);
    }
    return result(call.toolName, call.input, createDocumentLinesResult(document, {
      documentId: document.id,
      startLine: input.startLine,
      endLine: input.endLine,
    }));
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
    const manifest = await listProjectDocuments(context.project.id);
    const documentId = String(input.id ?? "").trim();
    const existing = manifest.documents.find((document) => document.id === documentId) ?? null;
    let scopedWritePath = existing?.path ?? "";
    const existingScopeBlock = existing
      ? validateExistingAgentDocumentWriteScope({
          toolName: call.toolName,
          document: existing,
          requestedPath: input.path,
          activeRoleWorkingDirectory: options.activeRoleWorkingDirectory,
        })
      : null;
    if (existingScopeBlock) {
      return result(call.toolName, call.input, existingScopeBlock);
    }
    if (!existing) {
      return result(call.toolName, call.input, createAgentDocumentWriteScopeBlockedResult({
        toolName: call.toolName,
        requestedDocumentId: documentId,
        requestedPath: input.path,
        activeRoleWorkingDirectory: options.activeRoleWorkingDirectory,
        reason:
          `Document ${documentId || "(missing id)"} does not exist. The Agent is not allowed to create Markdown documents; create the document manually first.`,
      }));
    }
    input.path = scopedWritePath;
    const existingDocument = await readProjectDocumentForTool(context.project.id, documentId);
    if (isDocumentLookupFailure(existingDocument)) {
      return result(call.toolName, call.input, {
        ...existingDocument,
        saved: false,
        verified: false,
      });
    }
    const changed = documentWriteInputWouldChange(existingDocument, input);
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
      changed,
      alreadyApplied: false,
      operationId: input.operationId,
      document: documentResultSummary(saved),
      ...(changed
        ? {}
        : {
            reason:
              "writeDocument saved and verified the existing document, but the submitted content and metadata matched the current document. No document content changed.",
            guidance:
              "Do not report this as a completed edit unless the requested change was already present. If the creator asked for a change, inspect the target and retry with different content.",
          }),
    });
  }
  if (call.toolName === "deleteDocument") {
    const input = call.input as { operationId: string; documentId: string };
    const document = await readProjectDocumentForTool(context.project.id, input.documentId);
    if (isDocumentLookupFailure(document)) {
      return result(call.toolName, call.input, {
        ...document,
        saved: false,
        verified: false,
        deleted: false,
      });
    }
    const scopeBlock = validateExistingAgentDocumentWriteScope({
      toolName: call.toolName,
      document,
      activeRoleWorkingDirectory: options.activeRoleWorkingDirectory,
    });
    if (scopeBlock) {
      return result(call.toolName, call.input, scopeBlock);
    }
    const manifest = await deleteProjectDocument(context.project.id, document.id);
    const stillPresent = manifest.documents.some((entry) => entry.id === document.id);
    return result(call.toolName, call.input, {
      saved: !stillPresent,
      verified: !stillPresent,
      changed: !stillPresent,
      deleted: !stillPresent,
      operationId: input.operationId,
      document: documentResultSummary(document),
      documentCount: manifest.documents.length,
      guidance: stillPresent
        ? "The delete operation did not verify; do not report completion."
        : "The requested document was deleted and verified absent from the manifest.",
    });
  }
  if (call.toolName === "appendDocument") {
    const input = call.input as AppendDocumentInput;
    const document = await readProjectDocumentForTool(context.project.id, input.documentId);
    if (isDocumentLookupFailure(document)) {
      return result(call.toolName, call.input, {
        ...document,
        saved: false,
        verified: false,
      });
    }
    const scopeBlock = validateExistingAgentDocumentWriteScope({
      toolName: call.toolName,
      document,
      requestedPath: input.path,
      activeRoleWorkingDirectory: options.activeRoleWorkingDirectory,
    });
    if (scopeBlock) {
      return result(call.toolName, call.input, scopeBlock);
    }
    const scopedInput = { ...input, path: document.path };
    const applied = applyAppendDocumentEdit(document, scopedInput);
    if (!applied.edit.changed) {
      return result(call.toolName, call.input, incrementalDocumentNoWriteSummary(document, applied.edit));
    }
    try {
      const saved = await writeProjectDocument(context.project.id, applied.writePayload);
      return result(call.toolName, call.input, incrementalDocumentEditSummary(saved, applied.edit));
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
            "This operationId belongs to a different document payload. Retry only with a fresh operationId and the intended incremental document edit.",
        });
      }
      throw error;
    }
  }
  if (call.toolName === "replaceDocumentSection") {
    const input = call.input as ReplaceDocumentSectionInput;
    const document = await readProjectDocumentForTool(context.project.id, input.documentId);
    if (isDocumentLookupFailure(document)) {
      return result(call.toolName, call.input, {
        ...document,
        saved: false,
        verified: false,
      });
    }
    const scopeBlock = validateExistingAgentDocumentWriteScope({
      toolName: call.toolName,
      document,
      requestedPath: input.path,
      activeRoleWorkingDirectory: options.activeRoleWorkingDirectory,
    });
    if (scopeBlock) {
      return result(call.toolName, call.input, scopeBlock);
    }
    const scopedInput = { ...input, path: document.path };
    const applied = applyReplaceDocumentSectionEdit(document, scopedInput);
    if (!applied.edit.changed) {
      return result(call.toolName, call.input, incrementalDocumentNoWriteSummary(document, applied.edit));
    }
    try {
      const saved = await writeProjectDocument(context.project.id, applied.writePayload);
      return result(call.toolName, call.input, incrementalDocumentEditSummary(saved, applied.edit));
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
            "This operationId belongs to a different document payload. Retry only with a fresh operationId and the intended incremental document edit.",
        });
      }
      throw error;
    }
  }
  if (call.toolName === "replaceDocumentText") {
    const input = call.input as ReplaceDocumentTextInput;
    const document = await readProjectDocumentForTool(context.project.id, input.documentId);
    if (isDocumentLookupFailure(document)) {
      return result(call.toolName, call.input, {
        ...document,
        saved: false,
        verified: false,
      });
    }
    const scopeBlock = validateExistingAgentDocumentWriteScope({
      toolName: call.toolName,
      document,
      requestedPath: input.path,
      activeRoleWorkingDirectory: options.activeRoleWorkingDirectory,
    });
    if (scopeBlock) {
      return result(call.toolName, call.input, scopeBlock);
    }
    const scopedInput = { ...input, path: document.path };
    const applied = applyReplaceDocumentTextEdit(document, scopedInput);
    if (!applied.edit.changed) {
      return result(call.toolName, call.input, incrementalDocumentNoWriteSummary(document, applied.edit));
    }
    try {
      const saved = await writeProjectDocument(context.project.id, applied.writePayload);
      return result(call.toolName, call.input, incrementalDocumentEditSummary(saved, applied.edit));
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
            "This operationId belongs to a different document payload. Retry only with a fresh operationId and the intended incremental document edit.",
        });
      }
      throw error;
    }
  }
  if (call.toolName === "editDocumentLines") {
    const input = call.input as EditDocumentLinesInput;
    const document = await readProjectDocumentForTool(context.project.id, input.documentId);
    if (isDocumentLookupFailure(document)) {
      return result(call.toolName, call.input, {
        ...document,
        saved: false,
        verified: false,
      });
    }
    const scopeBlock = validateExistingAgentDocumentWriteScope({
      toolName: call.toolName,
      document,
      requestedPath: input.path,
      activeRoleWorkingDirectory: options.activeRoleWorkingDirectory,
    });
    if (scopeBlock) {
      return result(call.toolName, call.input, scopeBlock);
    }
    const scopedInput = { ...input, path: document.path };
    const applied = applyEditDocumentLinesEdit(document, scopedInput);
    if (!applied.edit.changed) {
      return result(call.toolName, call.input, incrementalDocumentNoWriteSummary(document, applied.edit));
    }
    try {
      const saved = await writeProjectDocument(context.project.id, applied.writePayload);
      return result(call.toolName, call.input, incrementalDocumentEditSummary(saved, applied.edit));
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
            "This operationId belongs to a different document payload. Retry only with a fresh operationId and the intended incremental document edit.",
        });
      }
      throw error;
    }
  }
  if (call.toolName === "validateDocumentAgainstProject") {
    return result(call.toolName, call.input, await validateDocumentAgainstProject(context, call.input as { documentId?: string }));
  }
  if (call.toolName === "proposeCommandPlan") {
    return result(call.toolName, call.input, {
      accepted: false,
      reason:
        "Canvas/page command plans are disabled for the built-in Agent. Persist intent in existing Markdown documents with editDocumentLines, replaceDocumentSection, replaceDocumentText, appendDocument, writeDocument, or deleteDocument, or describe the manual editor steps for the creator. The Agent cannot create documents.",
    });
  }
  throw new Error(`Unsupported Agent harness tool: ${call.toolName}`);
};
