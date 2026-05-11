export type AgentToolCallLike = {
  toolName: string;
  input: unknown;
  reason?: string;
};

export type AgentHarnessToolResultLike = {
  toolName: string;
  input: unknown;
  result: unknown;
  createdAt: string;
};

export type AgentToolResultReuseOptions = {
  projectUpdatedAt?: string | null;
  currentPageId?: string | null;
};

export type AgentCompletedToolCallIndexEntryLike = {
  key: string;
  toolName: string;
  input: unknown;
  createdAt: string;
  projectUpdatedAt?: string | null;
  resultKeys: string[];
  reusableInCurrentProjectState: boolean;
};

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const readOperationId = (input: unknown) => {
  const operationId = readRecord(input).operationId;
  return typeof operationId === "string" && operationId.trim().length > 0
    ? operationId.trim()
    : null;
};

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stableJsonValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

const stableStringify = (value: unknown) => JSON.stringify(stableJsonValue(value));

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const hashStableValue = (value: unknown) => hashString(stableStringify(value));

const createWriteDocumentKeyPayload = (input: unknown) => {
  const record = readRecord(input);
  const content = typeof record.content === "string" ? record.content : "";
  return {
    id: typeof record.id === "string" ? record.id : "",
    title: typeof record.title === "string" ? record.title : "",
    role: typeof record.role === "string" ? record.role : "",
    status: typeof record.status === "string" ? record.status : "",
    path: typeof record.path === "string" ? record.path : "",
    relatedPageIds: Array.isArray(record.relatedPageIds)
      ? record.relatedPageIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    summary: typeof record.summary === "string" ? record.summary : "",
    contentHash: hashString(content),
    contentLength: content.length,
  };
};

const summarizeToolInputForIndex = (toolName: string, input: unknown) => {
  if (toolName !== "writeDocument") {
    return input;
  }
  const record = readRecord(input);
  const content = typeof record.content === "string" ? record.content : "";
  return {
    ...record,
    content: `[redacted:${content.length}]`,
    contentHash: hashString(content),
  };
};

const PROJECT_STATE_SENSITIVE_TOOLS = new Set([
  "readProjectSummary",
  "searchProject",
  "readPage",
  "readPages",
  "inspectSelection",
  "listImageAssets",
  "renderCurrentPage",
  "renderPage",
  "renderPanel",
  "renderPages",
  "validateDocumentAgainstProject",
  "proposeCommandPlan",
]);

const isProjectStateSensitiveTool = (toolName: string) => PROJECT_STATE_SENSITIVE_TOOLS.has(toolName);
const isToolBudgetResult = (result: AgentHarnessToolResultLike) => result.toolName === "toolBudget";
const isToolCallSkippedResult = (result: AgentHarnessToolResultLike) => result.toolName === "toolCallSkipped";

export const createAgentToolCallKey = (call: { toolName: string; input: unknown }) => {
  if (call.toolName === "writeDocument") {
    const operationId = readOperationId(call.input);
    if (operationId) {
      return `${call.toolName}:operationId:${operationId}:inputHash:${hashStableValue(createWriteDocumentKeyPayload(call.input))}`;
    }
  }
  return `${call.toolName}:${stableStringify(call.input ?? {})}`;
};

const readResultProjectUpdatedAt = (result: AgentHarnessToolResultLike) => {
  const projectUpdatedAt = readRecord(result.result).projectUpdatedAt;
  return typeof projectUpdatedAt === "string" && projectUpdatedAt.trim().length > 0
    ? projectUpdatedAt.trim()
    : null;
};

const readResultPageId = (result: AgentHarnessToolResultLike) => {
  const pageId = readRecord(result.result).pageId;
  return typeof pageId === "string" && pageId.trim().length > 0 ? pageId.trim() : null;
};

const resultMatchesCurrentProjectState = (
  result: AgentHarnessToolResultLike,
  call: AgentToolCallLike,
  options: AgentToolResultReuseOptions,
) => {
  if (call.toolName === "writeDocument") {
    const record = readRecord(result.result);
    return result.toolName === "writeDocument" && record.saved === true && record.conflict !== true && record.verified !== false;
  }
  if (call.toolName === "renderCurrentPage") {
    const currentPageId = options.currentPageId?.trim();
    if (currentPageId && readResultPageId(result) !== currentPageId) {
      return false;
    }
  }
  if (!isProjectStateSensitiveTool(call.toolName)) {
    return true;
  }
  const currentProjectUpdatedAt = options.projectUpdatedAt?.trim();
  if (!currentProjectUpdatedAt) {
    return true;
  }
  return readResultProjectUpdatedAt(result) === currentProjectUpdatedAt;
};

export const isReusableAgentToolResult = (
  result: AgentHarnessToolResultLike,
  call: AgentToolCallLike,
  options: AgentToolResultReuseOptions = {},
) => {
  if (isToolBudgetResult(result) || isToolCallSkippedResult(result)) {
    return false;
  }
  if (createAgentToolCallKey({ toolName: result.toolName, input: result.input }) !== createAgentToolCallKey(call)) {
    return false;
  }
  return resultMatchesCurrentProjectState(result, call, options);
};

export const findReusableAgentToolResult = (
  results: AgentHarnessToolResultLike[],
  call: AgentToolCallLike,
  options: AgentToolResultReuseOptions = {},
) => {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (result && isReusableAgentToolResult(result, call, options)) {
      return result;
    }
  }
  return null;
};

export const collectCompletedAgentToolCallKeys = (
  results: AgentHarnessToolResultLike[],
  options: AgentToolResultReuseOptions = {},
) => {
  const keys = new Set<string>();
  for (const result of results) {
    if (
      isToolBudgetResult(result) ||
      isToolCallSkippedResult(result) ||
      !resultMatchesCurrentProjectState(
        result,
        { toolName: result.toolName, input: result.input },
        options,
      )
    ) {
      continue;
    }
    keys.add(createAgentToolCallKey({ toolName: result.toolName, input: result.input }));
  }
  return keys;
};

export const createDuplicateToolCallSkippedResult = (
  call: AgentToolCallLike,
  createdAt = new Date().toISOString(),
  reusedResult?: AgentHarnessToolResultLike | null,
): AgentHarnessToolResultLike => {
  const operationId = call.toolName === "writeDocument" ? readOperationId(call.input) : null;
  const reusedResultRecord = reusedResult ? readRecord(reusedResult.result) : {};
  const writeAlreadyApplied =
    Boolean(operationId) &&
    reusedResult?.toolName === "writeDocument" &&
    reusedResultRecord.saved === true &&
    reusedResultRecord.conflict !== true &&
    reusedResultRecord.verified !== false;
  return {
    toolName: "toolCallSkipped",
    input: {
      toolName: call.toolName,
      input: summarizeToolInputForIndex(call.toolName, call.input),
    },
    result: {
      duplicate: true,
      toolCallKey: createAgentToolCallKey(call),
      reusedResult: reusedResult
        ? {
            toolName: reusedResult.toolName,
            createdAt: reusedResult.createdAt,
            projectUpdatedAt: readResultProjectUpdatedAt(reusedResult),
        }
        : null,
      ...(operationId ? { operationId, alreadyApplied: writeAlreadyApplied } : {}),
      reason: operationId
        ? writeAlreadyApplied
          ? "Duplicate writeDocument operation skipped; the same operationId and document payload were already verified by the harness."
          : "Duplicate writeDocument operation was not treated as applied because the reusable result was not a verified successful write."
        : "Duplicate tool call skipped; the previous result is already present in the harness.",
      guidance: operationId
        ? writeAlreadyApplied
          ? "Do not call writeDocument again with this exact operationId and document payload. Treat the verified document write as completed unless a different new edit is explicitly needed."
          : "Do not report this write as completed. Use a fresh operationId for a new write or inspect the previous write result before answering."
        : "Use the previous result already available in the harness, answer from current evidence, write the document, or request a different missing tool. Do not repeat this same toolName/input.",
    },
    createdAt,
  };
};

export const createCachedAgentToolResult = (
  call: AgentToolCallLike,
  reusedResult: AgentHarnessToolResultLike,
  createdAt = new Date().toISOString(),
): AgentHarnessToolResultLike => {
  const reusedRecord = readRecord(reusedResult.result);
  const isRecordResult =
    reusedResult.result &&
    typeof reusedResult.result === "object" &&
    !Array.isArray(reusedResult.result);
  return {
    toolName: call.toolName,
    input: call.input,
    result: isRecordResult
      ? {
          ...reusedRecord,
          cacheHit: true,
          cachedFromCreatedAt: reusedResult.createdAt,
        }
      : reusedResult.result,
    createdAt,
  };
};

export const createCompletedAgentToolCallIndex = (
  results: AgentHarnessToolResultLike[],
  options: AgentToolResultReuseOptions & { limit?: number } = {},
): AgentCompletedToolCallIndexEntryLike[] => {
  const latestByKey = new Map<string, AgentCompletedToolCallIndexEntryLike>();
  for (const result of results) {
    if (isToolBudgetResult(result) || isToolCallSkippedResult(result)) {
      continue;
    }
    const key = createAgentToolCallKey({ toolName: result.toolName, input: result.input });
    const resultRecord = readRecord(result.result);
    latestByKey.set(key, {
      key,
      toolName: result.toolName,
      input: summarizeToolInputForIndex(result.toolName, result.input),
      createdAt: result.createdAt,
      projectUpdatedAt: readResultProjectUpdatedAt(result),
      resultKeys: Object.keys(resultRecord).sort(),
      reusableInCurrentProjectState: resultMatchesCurrentProjectState(
        result,
        { toolName: result.toolName, input: result.input },
        options,
      ),
    });
  }
  const entries = Array.from(latestByKey.values());
  return entries.slice(-Math.max(1, options.limit ?? 80));
};

export const mergeAgentToolResults = (
  existing: AgentHarnessToolResultLike[],
  incoming: AgentHarnessToolResultLike[],
) => {
  const latestByKey = new Map<string, AgentHarnessToolResultLike>();
  const passthrough: AgentHarnessToolResultLike[] = [];
  for (const entry of [...existing, ...incoming]) {
    if (isToolBudgetResult(entry)) {
      passthrough.push(entry);
      continue;
    }
    const key = createAgentToolCallKey({ toolName: entry.toolName, input: entry.input });
    latestByKey.delete(key);
    latestByKey.set(key, entry);
  }
  return [...latestByKey.values(), ...passthrough];
};

export const selectAgentDynamicToolResultsForPrompt = (
  results: AgentHarnessToolResultLike[],
  options: {
    recentLimit?: number;
    preservedResultLimit?: number;
    budgetLimit?: number;
    skippedLimit?: number;
  } = {},
) => {
  const recentLimit = options.recentLimit ?? 12;
  const preservedResultLimit = options.preservedResultLimit ?? 10;
  const budgetLimit = options.budgetLimit ?? 3;
  const skippedLimit = options.skippedLimit ?? 3;

  const latestMeaningful = new Map<string, { index: number; result: AgentHarnessToolResultLike }>();
  const budgetResults: Array<{ index: number; result: AgentHarnessToolResultLike }> = [];
  const skippedResults: Array<{ index: number; result: AgentHarnessToolResultLike }> = [];
  const recentResults = results.slice(-recentLimit).map((result, offset) => ({
    index: results.length - Math.min(results.length, recentLimit) + offset,
    result,
  }));

  results.forEach((result, index) => {
    if (isToolBudgetResult(result)) {
      budgetResults.push({ index, result });
      return;
    }
    if (isToolCallSkippedResult(result)) {
      skippedResults.push({ index, result });
      return;
    }
    const key = createAgentToolCallKey({ toolName: result.toolName, input: result.input });
    latestMeaningful.set(key, { index, result });
  });

  const selected = new Map<string, { index: number; result: AgentHarnessToolResultLike }>();
  const add = (entry: { index: number; result: AgentHarnessToolResultLike }) => {
    const key = isToolBudgetResult(entry.result)
      ? `toolBudget:${entry.index}:${entry.result.createdAt}`
      : createAgentToolCallKey({ toolName: entry.result.toolName, input: entry.result.input });
    selected.set(key, entry);
  };

  Array.from(latestMeaningful.values()).slice(-preservedResultLimit).forEach(add);
  budgetResults.slice(-budgetLimit).forEach(add);
  skippedResults.slice(-skippedLimit).forEach(add);
  recentResults.forEach(add);

  return Array.from(selected.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.result);
};
