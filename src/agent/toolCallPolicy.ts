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

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const readOperationId = (input: unknown) => {
  const operationId = readRecord(input).operationId;
  return typeof operationId === "string" && operationId.trim().length > 0
    ? operationId.trim()
    : null;
};

export const createAgentToolCallKey = (call: { toolName: string; input: unknown }) => {
  if (call.toolName === "writeDocument") {
    const operationId = readOperationId(call.input);
    if (operationId) {
      return `${call.toolName}:operationId:${operationId}`;
    }
  }
  return `${call.toolName}:${JSON.stringify(call.input ?? {})}`;
};

const isToolBudgetResult = (result: AgentHarnessToolResultLike) => result.toolName === "toolBudget";
const isToolCallSkippedResult = (result: AgentHarnessToolResultLike) => result.toolName === "toolCallSkipped";

export const collectCompletedAgentToolCallKeys = (results: AgentHarnessToolResultLike[]) => {
  const keys = new Set<string>();
  for (const result of results) {
    if (isToolBudgetResult(result) || isToolCallSkippedResult(result)) {
      continue;
    }
    keys.add(createAgentToolCallKey({ toolName: result.toolName, input: result.input }));
  }
  return keys;
};

export const createDuplicateToolCallSkippedResult = (
  call: AgentToolCallLike,
  createdAt = new Date().toISOString(),
): AgentHarnessToolResultLike => {
  const operationId = call.toolName === "writeDocument" ? readOperationId(call.input) : null;
  return {
    toolName: "toolCallSkipped",
    input: {
      toolName: call.toolName,
      input: call.input,
    },
    result: {
      duplicate: true,
      ...(operationId ? { operationId, alreadyApplied: true } : {}),
      reason: operationId
        ? "Duplicate writeDocument operation skipped; this operationId was already applied in the harness."
        : "Duplicate tool call skipped; the previous result is already present in the harness.",
      guidance: operationId
        ? "Do not call writeDocument again with this operationId. Treat the document write as already completed from the previous writeDocument result and report completion to the creator unless a different new edit is explicitly needed."
        : "MangaMaker will pause instead of automatically resuming after this duplicate request. Use the previous result already available in the harness, answer from current evidence, write the document, or request a different missing tool.",
    },
    createdAt,
  };
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
