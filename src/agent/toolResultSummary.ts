import { isAgentDocumentMutationToolName } from "./documentEditTools";

export type AgentToolResultPromptSummary = {
  toolName: string;
  input: unknown;
  createdAt: string;
  resultHandle?: string;
  resultByteLength?: number;
  resultSummary: unknown;
  resultPolicy: {
    fullResultStored: boolean;
    fullResultNotEmbedded: boolean;
    guidance: string;
  };
};

type ToolResultLike = {
  toolName: string;
  input: unknown;
  result: unknown;
  createdAt: string;
  resultHandle?: string;
  resultByteLength?: number;
};

const MAX_GENERIC_STRING_CHARS = 900;
const MAX_GENERIC_ARRAY_ITEMS = 24;
const MAX_GENERIC_OBJECT_KEYS = 32;
const MAX_DOCUMENT_PREVIEW_CHARS = 800;
const MAX_DOCUMENT_CONTENT_CHARS = 120_000;
const MAX_DOCUMENT_OUTLINE_ITEMS = 80;
const MAX_LINE_TEXT_CHARS = 1200;
const MAX_LINE_ITEMS = 220;
const MAX_PAGE_OBJECTS = 80;
const MAX_RENDER_RESULTS = 12;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, Math.max(0, limit - 40))}\n[truncated ${value.length - limit} chars]` : value;

const lineCount = (content: string) => {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized) {
    return 0;
  }
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n").length
    : normalized.split("\n").length;
};

const markdownOutline = (content: string) => {
  const headings: Array<{ line: number; level: number; text: string }> = [];
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match || headings.length >= MAX_DOCUMENT_OUTLINE_ITEMS) {
      return;
    }
    headings.push({
      line: index + 1,
      level: match[1].length,
      text: truncate(match[2].replace(/\s+#+\s*$/, "").trim(), 160),
    });
  });
  return headings;
};

const summarizeDocument = (value: unknown, includeContentPreview: boolean) => {
  const record = isRecord(value) ? value : {};
  const documentRecord = isRecord(record.document) ? record.document : record;
  const content = typeof documentRecord.content === "string"
    ? documentRecord.content
    : typeof record.content === "string"
      ? record.content
      : "";
  return {
    id: typeof documentRecord.id === "string" ? documentRecord.id : null,
    title: typeof documentRecord.title === "string" ? documentRecord.title : null,
    role: typeof documentRecord.role === "string" ? documentRecord.role : null,
    status: typeof documentRecord.status === "string" ? documentRecord.status : null,
    path: typeof documentRecord.path === "string" ? documentRecord.path : null,
    relatedPageIds: Array.isArray(documentRecord.relatedPageIds) ? documentRecord.relatedPageIds : [],
    updatedAt: typeof documentRecord.updatedAt === "string" ? documentRecord.updatedAt : null,
    summary: typeof documentRecord.summary === "string" ? truncate(documentRecord.summary, 500) : "",
    contentLength:
      typeof documentRecord.contentLength === "number"
        ? documentRecord.contentLength
        : typeof record.contentLength === "number"
          ? record.contentLength
          : content.length,
    lineCount: content ? lineCount(content) : null,
    outline: content ? markdownOutline(content) : [],
    ...(includeContentPreview && content
      ? {
          content: truncate(content, MAX_DOCUMENT_CONTENT_CHARS),
          contentPreview: truncate(content, MAX_DOCUMENT_PREVIEW_CHARS),
          contentTruncatedForPrompt: content.length > MAX_DOCUMENT_CONTENT_CHARS,
        }
      : {}),
    contentOmitted: Boolean(content) && (!includeContentPreview || content.length > MAX_DOCUMENT_CONTENT_CHARS),
    contentAccess:
      "readDocument provides whole-document content when it fits the prompt budget. Use readDocumentLines when exact line numbers or a narrower range are useful.",
  };
};

const summarizeDocumentLines = (value: unknown) => {
  const record = isRecord(value) ? value : {};
  const lines = Array.isArray(record.lines) ? record.lines : [];
  return {
    document: summarizeDocument(record.document, false),
    lineCount: typeof record.lineCount === "number" ? record.lineCount : null,
    startLine: typeof record.startLine === "number" ? record.startLine : null,
    endLine: typeof record.endLine === "number" ? record.endLine : null,
    truncatedBefore: record.truncatedBefore === true,
    truncatedAfter: record.truncatedAfter === true || lines.length > MAX_LINE_ITEMS,
    lines: lines.slice(0, MAX_LINE_ITEMS).map((entry) => {
      const lineRecord = isRecord(entry) ? entry : {};
      return {
        line: typeof lineRecord.line === "number" ? lineRecord.line : null,
        text: typeof lineRecord.text === "string" ? truncate(lineRecord.text, MAX_LINE_TEXT_CHARS) : "",
      };
    }),
  };
};

const summarizePageObject = (value: unknown) => {
  const record = isRecord(value) ? value : {};
  const image = isRecord(record.image) ? record.image : null;
  return {
    id: record.id ?? null,
    objectType: record.objectType ?? null,
    objectRef: record.objectRef ?? null,
    panelRef: record.panelRef ?? null,
    x: record.x ?? null,
    y: record.y ?? null,
    width: record.width ?? null,
    height: record.height ?? null,
    layerRef: record.layerRef ?? null,
    layerIndex: record.layerIndex ?? null,
    content: typeof record.content === "string" ? truncate(record.content, 800) : undefined,
    description: typeof record.description === "string" ? truncate(record.description, 500) : undefined,
    hasImage: record.hasImage === true,
    image: image
      ? {
          src: typeof image.src === "string" ? truncate(image.src, 240) : null,
          panelRef: image.panelRef ?? null,
          sourceWidth: image.sourceWidth ?? null,
          sourceHeight: image.sourceHeight ?? null,
          viewBox: image.viewBox ?? null,
          prompt: typeof image.prompt === "string" ? truncate(image.prompt, 500) : "",
          description: typeof image.description === "string" ? truncate(image.description, 500) : "",
        }
      : undefined,
  };
};

const summarizePage = (value: unknown) => {
  const record = isRecord(value) ? value : {};
  const objects = Array.isArray(record.objects) ? record.objects : [];
  return {
    id: record.id ?? null,
    pageNumber: record.pageNumber ?? null,
    name: record.name ?? null,
    width: record.width ?? null,
    height: record.height ?? null,
    background: record.background ?? null,
    panelCount: record.panelCount ?? null,
    textCount: record.textCount ?? null,
    bubbleCount: record.bubbleCount ?? null,
    layerCount: record.layerCount ?? null,
    isCurrent: record.isCurrent === true || record.viewing === true,
    objectCount: objects.length,
    objects: objects.slice(0, MAX_PAGE_OBJECTS).map(summarizePageObject),
    objectsTruncated: objects.length > MAX_PAGE_OBJECTS,
  };
};

const summarizeCanvasSnapshot = (value: unknown) => {
  const record = isRecord(value) ? value : {};
  return {
    available: typeof record.dataUrl === "string" && record.dataUrl.length > 0,
    dataUrl: typeof record.dataUrl === "string" && record.dataUrl ? "[attached as vision image when vision is enabled]" : null,
    width: record.width ?? null,
    height: record.height ?? null,
    byteLength: record.byteLength ?? null,
    source: record.source ?? null,
    detail: record.detail ?? null,
    crop: record.crop ?? null,
    reason: typeof record.reason === "string" ? truncate(record.reason, 500) : undefined,
  };
};

const summarizeRenderResult = (value: unknown) => {
  const record = isRecord(value) ? value : {};
  const resources = isRecord(record.resources) ? record.resources : {};
  return {
    pageId: record.pageId ?? null,
    pageName: record.pageName ?? null,
    pageNumber: record.pageNumber ?? null,
    isCurrent: record.isCurrent === true,
    renderOptions: record.renderOptions ?? null,
    canvasSnapshot: summarizeCanvasSnapshot(record.canvasSnapshot),
    resources: {
      page: summarizePage(resources.page),
      imageAssetCount: Array.isArray(resources.imageAssets) ? resources.imageAssets.length : 0,
    },
  };
};

const summarizeGeneric = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return "[redacted inline image data]";
    }
    return truncate(value, depth <= 1 ? MAX_GENERIC_STRING_CHARS : Math.floor(MAX_GENERIC_STRING_CHARS / 2));
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_GENERIC_ARRAY_ITEMS).map((entry) => summarizeGeneric(entry, depth + 1));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_GENERIC_OBJECT_KEYS)
      .map(([key, entry]) => [
        key,
        key === "dataUrl" && typeof entry === "string" && entry
          ? "[attached image redacted from prompt text]"
          : summarizeGeneric(entry, depth + 1),
      ]),
  );
};

const summarizeDocumentMutationInput = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return summarizeGeneric(value);
  }
  const summarizeString = (entry: unknown) =>
    typeof entry === "string"
      ? {
          omitted: true,
          length: entry.length,
          preview: truncate(entry, 160),
        }
      : summarizeGeneric(entry);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === "content" || key === "oldText" || key === "newText") {
        return [key, summarizeString(entry)];
      }
      if (key === "patches" && Array.isArray(entry)) {
        return [
          key,
          entry.map((patch) =>
            isRecord(patch)
              ? Object.fromEntries(
                  Object.entries(patch).map(([patchKey, patchValue]) => [
                    patchKey,
                    patchKey === "content" || patchKey === "oldText" || patchKey === "newText"
                      ? summarizeString(patchValue)
                      : summarizeGeneric(patchValue),
                  ]),
                )
              : summarizeGeneric(patch),
          ),
        ];
      }
      if (key === "operations" && Array.isArray(entry)) {
        return [
          key,
          entry.map((operation) =>
            isRecord(operation)
              ? Object.fromEntries(
                  Object.entries(operation).map(([operationKey, operationValue]) => [
                    operationKey,
                    operationKey === "content" ? summarizeString(operationValue) : summarizeGeneric(operationValue),
                  ]),
                )
              : summarizeGeneric(operation),
          ),
        ];
      }
      return [key, summarizeGeneric(entry)];
    }),
  );
};

export const summarizeAgentToolResultForPrompt = (
  entry: ToolResultLike,
): AgentToolResultPromptSummary => {
  const result = isRecord(entry.result) ? entry.result : entry.result;
  let resultSummary: unknown;
  if (entry.toolName === "readDocument") {
    resultSummary = summarizeDocument(result, true);
  } else if (entry.toolName === "readPrimeDirective" || entry.toolName === "readActiveRoleMetadoc") {
    resultSummary = summarizeGeneric(result);
  } else if (entry.toolName === "readDocumentLines") {
    resultSummary = summarizeDocumentLines(result);
  } else if (entry.toolName === "readPage") {
    resultSummary = summarizePage(result);
  } else if (entry.toolName === "readPages") {
    const record = isRecord(result) ? result : {};
    const pages = Array.isArray(record.pages) ? record.pages : [];
    resultSummary = {
      projectUpdatedAt: record.projectUpdatedAt ?? null,
      pageIds: Array.isArray(record.pageIds) ? record.pageIds : [],
      requestedPageIdCount: record.requestedPageIdCount ?? pages.length,
      maxPageIds: record.maxPageIds ?? null,
      truncated: record.truncated === true,
      skippedPageIds: Array.isArray(record.skippedPageIds) ? record.skippedPageIds : [],
      pages: pages.map(summarizePage),
    };
  } else if (entry.toolName === "renderPage" || entry.toolName === "renderCurrentPage" || entry.toolName === "renderPanel") {
    resultSummary = summarizeRenderResult(result);
  } else if (entry.toolName === "renderPages") {
    const record = isRecord(result) ? result : {};
    const results = Array.isArray(record.results) ? record.results : [];
    resultSummary = {
      projectUpdatedAt: record.projectUpdatedAt ?? null,
      pageIds: Array.isArray(record.pageIds) ? record.pageIds : [],
      requestedPageIdCount: record.requestedPageIdCount ?? results.length,
      maxPageIds: record.maxPageIds ?? null,
      truncated: record.truncated === true || results.length > MAX_RENDER_RESULTS,
      skippedPageIds: Array.isArray(record.skippedPageIds) ? record.skippedPageIds : [],
      detail: record.detail ?? null,
      results: results.slice(0, MAX_RENDER_RESULTS).map(summarizeRenderResult),
    };
  } else {
    resultSummary = summarizeGeneric(result);
  }
  const readDocumentContentTruncated =
    entry.toolName === "readDocument" &&
    isRecord(resultSummary) &&
    resultSummary.contentTruncatedForPrompt === true;
  return {
    toolName: entry.toolName,
    input: isAgentDocumentMutationToolName(entry.toolName)
      ? summarizeDocumentMutationInput(entry.input)
      : summarizeGeneric(entry.input),
    createdAt: entry.createdAt,
    ...(entry.resultHandle ? { resultHandle: entry.resultHandle } : {}),
    ...(typeof entry.resultByteLength === "number" ? { resultByteLength: entry.resultByteLength } : {}),
    resultSummary,
    resultPolicy: {
      fullResultStored: Boolean(entry.resultHandle),
      fullResultNotEmbedded: entry.toolName === "readDocument" ? readDocumentContentTruncated : true,
      guidance:
        entry.toolName === "readDocument"
          ? "Choose readDocument or readDocumentLines based on the task. This summary includes document content when it fits the prompt budget; use line reads only when line numbers or a narrow range are useful."
          : "Use this summary, completedToolCallIndex, and cached tool results. Request a narrower tool call only when this summary is insufficient.",
    },
  };
};
