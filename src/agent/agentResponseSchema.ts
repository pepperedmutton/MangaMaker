import { z } from "zod";
import { commandRegistry } from "../commands/registry";
import { commandPlanRequiresConfirmation, getCommandDangerLevel } from "./commandManifest";
import { agentDocumentStatusSchema } from "./documentSchema";
import {
  AGENT_MAX_BATCH_READ_PAGES,
  AGENT_MAX_BATCH_RENDER_PAGES,
  AGENT_MAX_MODEL_PAGE_IDS_PER_TOOL_CALL,
} from "./toolLimits";
import { isAgentDocumentMutationToolName } from "./documentEditTools";
import type {
  AgentChatResponse,
  AgentCommandPlan,
  AgentCommandPlanItem,
  AgentTaskProgress,
  AgentToolCallRequest,
} from "./types";

const rawPlanItemSchema = z.object({
  commandId: z.string().min(1),
  payload: z.unknown(),
  reason: z.string().optional(),
  dangerLevel: z.unknown().optional(),
});

const rawPlanSchema = z.object({
  summary: z.string().trim().min(1),
  commands: z.array(rawPlanItemSchema).min(1),
  requiresConfirmation: z.boolean().optional(),
});

const requestTraceDetailValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const requestTraceSchema = z.object({
  requestId: z.string().min(1),
  parentRequestId: z.string().min(1).optional(),
  stage: z.string().min(1),
  status: z.enum(["pending", "success", "error", "timeout"]),
  provider: z.enum(["openrouter", "test", "unavailable"]).nullable(),
  model: z.string().nullable(),
  usedVision: z.boolean().nullable(),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  durationMs: z.number().min(0),
  events: z.array(z.object({
    phase: z.string().min(1),
    at: z.string().min(1),
    elapsedMs: z.number().min(0),
    message: z.string().optional(),
    detail: z.record(requestTraceDetailValueSchema).optional(),
  })),
  error: z.string().optional(),
});

const taskProgressStepSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  stopCondition: z.string().trim().min(1).optional(),
}).strict();

const taskProgressSchema = z.object({
  objective: z.string().trim().min(1),
  phase: z.enum(["planning", "gathering_context", "editing_document", "validating", "reporting", "complete", "blocked"]),
  status: z.enum(["planning", "running", "needs_tool", "waiting_for_user", "completed", "blocked"]),
  steps: z.array(taskProgressStepSchema).min(1).max(12),
  currentStepId: z.string().trim().min(1).optional(),
  stopCondition: z.string().trim().min(1),
  stopReason: z.string().trim().min(1).optional(),
  nextAction: z.string().trim().min(1).optional(),
  percent: z.number().min(0).max(100).optional(),
}).strict();

const rawResponseSchema = z.object({
  message: z.unknown().optional(),
  pendingCommandPlan: z.unknown().nullable().optional(),
  requestedToolCalls: z.unknown().optional(),
  toolLogs: z.unknown().optional(),
  usedVision: z.boolean().optional(),
  warning: z.string().optional(),
  visionUnavailableReason: z.string().optional(),
  taskProgress: z.unknown().optional(),
  requestTrace: requestTraceSchema.optional(),
  modelDebug: z.object({
    rawAssistantContent: z.string().optional(),
    parsedResponse: z.unknown().optional(),
    finishReason: z.string().optional(),
    promptTokens: z.number().nullable().optional(),
    completionTokens: z.number().nullable().optional(),
    totalTokens: z.number().nullable().optional(),
    providerRouting: z.unknown().optional(),
  }).optional(),
});

const allowedToolNames = new Set([
  "readProjectSummary",
  "listPages",
  "searchProject",
  "readPage",
  "readPages",
  "inspectSelection",
  "listImageAssets",
  "renderCurrentPage",
  "renderPage",
  "renderPanel",
  "renderPages",
  // Retained only so stale model/tool-call resumes can be answered with disabled guidance
  // instead of failing the run. These tools are not exposed in the active harness catalog.
  "listCommandManifest",
  "listDocuments",
  "listRoles",
  "readDocument",
  "readDocumentLines",
  "searchDocuments",
  "writeDocument",
  "deleteDocument",
  "appendDocument",
  "replaceDocumentSection",
  "replaceDocumentText",
  "editDocumentLines",
  "validateDocumentAgainstProject",
  "proposeCommandPlan",
]);

const renderDetailSchema = z.enum(["preview", "detail"]).optional();
const renderCropSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
}).strict().optional();

const pageIdsSchema = z.array(z.string().trim().min(1)).min(1).max(AGENT_MAX_MODEL_PAGE_IDS_PER_TOOL_CALL);
const documentMetaWithoutTitlePatchSchema = {
  role: z.string().min(1).optional(),
  status: agentDocumentStatusSchema.optional(),
  path: z.string().min(1).optional(),
  relatedPageIds: z.array(z.string().min(1)).optional(),
  summary: z.string().optional(),
};
const documentMetaPatchSchema = {
  title: z.string().min(1).optional(),
  ...documentMetaWithoutTitlePatchSchema,
};

const appendLimitReason = (
  reason: string | undefined,
  toolName: string,
  requested: number,
  maximum: number,
) => {
  if (requested <= maximum) {
    return reason;
  }
  const limitNotice = `${toolName} received ${requested} pageIds; MangaMaker will process the first ${maximum}.`;
  return reason ? `${reason} ${limitNotice}` : limitNotice;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const describeZodIssues = (error: unknown) => {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
};

const INTERNAL_TOOL_INPUT_ERROR_TOOL_NAME = "toolInputError";

const describeInvalidToolCallValue = (value: unknown) => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (typeof value === "object") {
    return `object keys: ${Object.keys(value as Record<string, unknown>).slice(0, 12).join(", ")}`;
  }
  const preview = typeof value === "string" ? value : String(value);
  return `${typeof value}: ${preview.slice(0, 160)}`;
};

const createInvalidToolInputRepairCall = (
  call: { toolName: string; input?: unknown; reason?: string },
  index: number,
  error: unknown,
): AgentToolCallRequest => ({
  toolName: INTERNAL_TOOL_INPUT_ERROR_TOOL_NAME,
  input: {
    requestedToolCallIndex: index,
    attemptedToolName: call.toolName,
    attemptedInput: call.input ?? null,
    attemptedReason: call.reason ?? null,
    error: describeZodIssues(error),
    guidance:
      "Repair this tool call in your next response. Keep the tool call explanation in requestedToolCalls[].reason, not inside input. The input object must exactly match the tool inputSchema.",
  },
  reason: `Repair invalid ${call.toolName} tool input.`,
});

const createInvalidToolCallShapeRepairCall = (
  value: unknown,
  index: number,
  error: string,
): AgentToolCallRequest => ({
  toolName: INTERNAL_TOOL_INPUT_ERROR_TOOL_NAME,
  input: {
    requestedToolCallIndex: index,
    attemptedToolName: "unknown",
    attemptedInput: null,
    attemptedReason: null,
    attemptedToolCallPreview: describeInvalidToolCallValue(value),
    error,
    guidance:
      "Repair requestedToolCalls in your next response. requestedToolCalls must be an array of objects shaped as { toolName: string, input: object, reason?: string }. Do not put prose strings inside requestedToolCalls.",
  },
  reason: "Repair malformed requestedToolCalls entry.",
});

const createInvalidAgentResponseShapeRepairCall = (
  value: unknown,
  error: string,
): AgentToolCallRequest => ({
  toolName: INTERNAL_TOOL_INPUT_ERROR_TOOL_NAME,
  input: {
    requestedToolCallIndex: null,
    attemptedToolName: "agentResponse",
    attemptedInput: null,
    attemptedReason: null,
    attemptedResponsePreview: describeInvalidToolCallValue(value),
    error,
    guidance:
      "Repair your whole Agent response in your next response. Return one JSON object with message as a string, requestedToolCalls as an array of tool-call objects, and pendingCommandPlan as null. Do not omit message. If a previous document write already completed the task, return requestedToolCalls: [] and report completion in message.",
  },
  reason: "Repair malformed Agent response JSON.",
});

const validateOneRequestedToolCall = (
  call: { toolName: string; input?: unknown; reason?: string },
  index: number,
): AgentToolCallRequest => {
      if (!allowedToolNames.has(call.toolName)) {
        throw new Error(`unknown tool: ${call.toolName}`);
      }
      if (call.toolName === "readPage") {
        const parsed = z.object({ pageId: z.string().min(1) }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "renderCurrentPage") {
        const parsed = z.object({
          detail: renderDetailSchema,
          crop: renderCropSchema,
        }).strict().parse(call.input ?? {});
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "renderPage") {
        const parsed = z.object({
          pageId: z.string().min(1),
          detail: renderDetailSchema,
          crop: renderCropSchema,
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "renderPanel") {
        const parsed = z.object({
          pageId: z.string().min(1),
          panelId: z.string().min(1),
          detail: renderDetailSchema,
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "readPages") {
        const parsed = z.object({
          pageIds: pageIdsSchema,
        }).strict().parse(call.input);
        return {
          toolName: call.toolName,
          input: parsed,
          reason: appendLimitReason(call.reason, call.toolName, parsed.pageIds.length, AGENT_MAX_BATCH_READ_PAGES),
        };
      }
      if (call.toolName === "renderPages") {
        const parsed = z.object({
          pageIds: pageIdsSchema,
          detail: renderDetailSchema,
        }).strict().parse(call.input);
        return {
          toolName: call.toolName,
          input: parsed,
          reason: appendLimitReason(call.reason, call.toolName, parsed.pageIds.length, AGENT_MAX_BATCH_RENDER_PAGES),
        };
      }
      if (call.toolName === "searchProject") {
        const parsed = z.object({
          query: z.string().optional(),
          pageId: z.string().min(1).optional(),
          objectTypes: z.array(z.enum(["panel", "text", "bubble", "element"])).optional(),
          limit: z.number().min(1).max(100).optional(),
        }).parse(call.input ?? {});
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "listImageAssets") {
        const parsed = z.object({
          pageId: z.string().min(1).optional(),
          query: z.string().optional(),
          limit: z.number().min(1).max(100).optional(),
        }).parse(call.input ?? {});
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "readDocument" || call.toolName === "validateDocumentAgainstProject") {
        const parsed = z.object({
          documentId: z.string().min(1),
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "readDocumentLines") {
        const parsed = z.object({
          documentId: z.string().min(1),
          startLine: z.number().min(1).optional(),
          endLine: z.number().min(1).optional(),
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "searchDocuments") {
        const parsed = z.object({
          query: z.string().optional(),
          role: z.string().min(1).optional(),
          limit: z.number().min(1).max(100).optional(),
        }).strict().parse(call.input ?? {});
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "writeDocument") {
        const parsed = z.object({
          operationId: z.string().min(1),
          id: z.string().min(1),
          title: z.string().min(1),
          ...documentMetaWithoutTitlePatchSchema,
          content: z.string(),
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "deleteDocument") {
        const parsed = z.object({
          operationId: z.string().min(1),
          documentId: z.string().min(1),
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "appendDocument") {
        const parsed = z.object({
          operationId: z.string().min(1),
          documentId: z.string().min(1),
          content: z.string().min(1),
          heading: z.string().min(1).optional(),
          createHeadingIfMissing: z.boolean().optional(),
          ...documentMetaPatchSchema,
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "replaceDocumentSection") {
        const parsed = z.object({
          operationId: z.string().min(1),
          documentId: z.string().min(1),
          heading: z.string().min(1),
          content: z.string(),
          headingLevel: z.number().min(1).max(6).optional(),
          occurrence: z.number().min(1).optional(),
          createIfMissing: z.boolean().optional(),
          contentIncludesHeading: z.boolean().optional(),
          ...documentMetaPatchSchema,
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "replaceDocumentText") {
        const parsed = z.object({
          operationId: z.string().min(1),
          documentId: z.string().min(1),
          oldText: z.string().min(1),
          newText: z.string(),
          replaceAll: z.boolean().optional(),
          ...documentMetaPatchSchema,
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "editDocumentLines") {
        const replaceOperationSchema = z.object({
          type: z.literal("replace"),
          startLine: z.number().min(1),
          endLine: z.number().min(1),
          content: z.string(),
        }).strict();
        const deleteOperationSchema = z.object({
          type: z.literal("delete"),
          startLine: z.number().min(1),
          endLine: z.number().min(1),
        }).strict();
        const insertBeforeOperationSchema = z.object({
          type: z.literal("insertBefore"),
          line: z.number().min(1),
          content: z.string(),
        }).strict();
        const insertAfterOperationSchema = z.object({
          type: z.literal("insertAfter"),
          line: z.number().min(0),
          content: z.string(),
        }).strict();
        const parsed = z.object({
          operationId: z.string().min(1),
          documentId: z.string().min(1),
          operations: z.array(z.discriminatedUnion("type", [
            replaceOperationSchema,
            deleteOperationSchema,
            insertBeforeOperationSchema,
            insertAfterOperationSchema,
          ])).min(1),
          ...documentMetaPatchSchema,
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "proposeCommandPlan") {
        return { toolName: call.toolName, input: call.input, reason: call.reason };
      }
      const input = z.object({}).passthrough().parse(call.input ?? {});
      return { toolName: call.toolName, input, reason: call.reason };
};

const validateRequestedToolCalls = (
  value: unknown,
): AgentToolCallRequest[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [
      createInvalidToolCallShapeRepairCall(
        value,
        0,
        `requestedToolCalls must be an array, but the model returned ${describeInvalidToolCallValue(value)}.`,
      ),
    ];
  }
  const validCalls: AgentToolCallRequest[] = [];
  const invalidCalls: AgentToolCallRequest[] = [];
  value.forEach((call, index) => {
    if (!isRecord(call)) {
      invalidCalls.push(createInvalidToolCallShapeRepairCall(
        call,
        index,
        `requestedToolCalls[${index}] must be an object, but the model returned ${describeInvalidToolCallValue(call)}.`,
      ));
      return;
    }
    if (typeof call.toolName !== "string" || call.toolName.trim().length === 0) {
      invalidCalls.push(createInvalidToolCallShapeRepairCall(
        call,
        index,
        `requestedToolCalls[${index}].toolName must be a non-empty string.`,
      ));
      return;
    }
    if ("reason" in call && call.reason !== undefined && typeof call.reason !== "string") {
      invalidCalls.push(createInvalidToolCallShapeRepairCall(
        call,
        index,
        `requestedToolCalls[${index}].reason must be a string when provided.`,
      ));
      return;
    }
    const normalizedCall = {
      toolName: call.toolName,
      input: call.input,
      reason: typeof call.reason === "string" ? call.reason : undefined,
    };
    try {
      validCalls.push(validateOneRequestedToolCall(normalizedCall, index));
    } catch (error) {
      invalidCalls.push(createInvalidToolInputRepairCall(normalizedCall, index, error));
    }
  });
  return invalidCalls.length > 0 ? invalidCalls : validCalls;
};

export const parseAgentModelJson = (content: string): unknown => {
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      return JSON.parse(fenced);
    }
    const objectStart = content.indexOf("{");
    const objectEnd = content.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(content.slice(objectStart, objectEnd + 1));
    }
    throw new Error("The model did not return valid JSON.");
  }
};

export const validateAgentCommandPlan = (value: unknown): AgentCommandPlan | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = rawPlanSchema.parse(value);
  const commands: AgentCommandPlanItem[] = parsed.commands.map((command, index) => {
    const definition = commandRegistry[command.commandId as keyof typeof commandRegistry];
    if (!definition) {
      throw new Error(`Agent command plan contains unknown commandId at commands[${index}]: ${command.commandId}`);
    }
    const payload = definition.inputSchema.parse(command.payload);
    return {
      commandId: command.commandId,
      payload,
      reason: command.reason,
      dangerLevel: getCommandDangerLevel(command.commandId),
    };
  });

  return {
    summary: parsed.summary,
    commands,
    requiresConfirmation: commandPlanRequiresConfirmation(commands),
  };
};

export const AGENT_PAGE_COMMAND_PLAN_DISABLED_MESSAGE =
  "MangaMaker ignored a model command plan because built-in Agent page/canvas edits are disabled. The Agent can mutate existing Markdown documents with editDocumentLines, replaceDocumentSection, replaceDocumentText, appendDocument, writeDocument, or deleteDocument, but it cannot create documents or modify comic pages directly.";

const appendAgentWarning = (warning: string | undefined, nextWarning: string | null) => {
  if (!nextWarning) {
    return warning;
  }
  return warning ? `${warning}\n${nextWarning}` : nextWarning;
};

const readTaskString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readTaskNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(/%$/, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeTaskToken = (value: unknown) =>
  typeof value === "string"
    ? value
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[\s-]+/g, "_")
        .toLowerCase()
    : "";

const normalizeTaskPhase = (value: unknown): AgentTaskProgress["phase"] | null => {
  const normalized = normalizeTaskToken(value);
  if (normalized === "planning" || normalized === "plan") {
    return "planning";
  }
  if (
    normalized === "gathering_context" ||
    normalized === "inspection" ||
    normalized === "inspect" ||
    normalized === "inspecting" ||
    normalized === "reading" ||
    normalized === "read" ||
    normalized === "context" ||
    normalized === "analysis" ||
    normalized === "analyzing"
  ) {
    return "gathering_context";
  }
  if (
    normalized === "editing_document" ||
    normalized === "document_edit" ||
    normalized === "editing" ||
    normalized === "writing" ||
    normalized === "write" ||
    normalized === "mutation" ||
    normalized === "persisting"
  ) {
    return "editing_document";
  }
  if (normalized === "validating" || normalized === "validation" || normalized === "verify" || normalized === "verification") {
    return "validating";
  }
  if (normalized === "reporting" || normalized === "responding" || normalized === "answering" || normalized === "final_answer") {
    return "reporting";
  }
  if (normalized === "waiting_for_user" || normalized === "waiting" || normalized === "awaiting_user") {
    return "reporting";
  }
  if (normalized === "complete" || normalized === "completed" || normalized === "done" || normalized === "finished") {
    return "complete";
  }
  if (normalized === "blocked" || normalized === "failed" || normalized === "error") {
    return "blocked";
  }
  return null;
};

const normalizeTaskStatus = (value: unknown): AgentTaskProgress["status"] | null => {
  const normalized = normalizeTaskToken(value);
  if (normalized === "planning" || normalized === "plan") {
    return "planning";
  }
  if (normalized === "running" || normalized === "in_progress" || normalized === "inprogress" || normalized === "working") {
    return "running";
  }
  if (normalized === "needs_tool" || normalized === "need_tool" || normalized === "tool" || normalized === "tool_call" || normalized === "requesting_tool") {
    return "needs_tool";
  }
  if (normalized === "waiting_for_user" || normalized === "waiting" || normalized === "awaiting_user" || normalized === "needs_confirmation") {
    return "waiting_for_user";
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "done" || normalized === "finished") {
    return "completed";
  }
  if (normalized === "blocked" || normalized === "failed" || normalized === "error") {
    return "blocked";
  }
  return null;
};

const normalizeTaskStepStatus = (value: unknown): AgentTaskProgress["steps"][number]["status"] | null => {
  const normalized = normalizeTaskToken(value);
  if (normalized === "pending" || normalized === "todo" || normalized === "not_started") {
    return "pending";
  }
  if (normalized === "in_progress" || normalized === "inprogress" || normalized === "running" || normalized === "working") {
    return "in_progress";
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "done" || normalized === "finished") {
    return "completed";
  }
  if (normalized === "blocked" || normalized === "failed" || normalized === "error") {
    return "blocked";
  }
  return null;
};

const createFallbackTaskProgress = (
  message: string,
  requestedToolCalls: AgentToolCallRequest[],
  pendingCommandPlan: AgentCommandPlan | null,
): AgentTaskProgress => {
  const firstTool = requestedToolCalls[0];
  const hasDocumentMutation = requestedToolCalls.some((call) => isAgentDocumentMutationToolName(call.toolName));
  if (requestedToolCalls.length > 0) {
    const toolNames = Array.from(new Set(requestedToolCalls.map((call) => call.toolName))).join(", ");
    return {
      objective: "Handle the creator request through the MangaMaker harness.",
      phase: hasDocumentMutation ? "editing_document" : "gathering_context",
      status: "needs_tool",
      currentStepId: "tool-call",
      steps: [
        {
          id: "tool-call",
          title: `Request harness tool(s): ${toolNames}`,
          status: "in_progress",
          stopCondition: hasDocumentMutation
            ? "Stop after the document mutation tool returns saved=true, verified=true, and changed=true or alreadyApplied=true."
            : "Stop when the requested evidence is sufficient to answer or persist the requested document change.",
        },
      ],
      stopCondition: hasDocumentMutation
        ? "Stop after a verified document mutation result that changed the document or was already applied."
        : "Stop when enough evidence is available to answer without repeating tool calls.",
      nextAction: firstTool?.reason ?? (firstTool ? `Run ${firstTool.toolName}.` : "Run the requested harness tools."),
      percent: 35,
    };
  }
  if (pendingCommandPlan) {
    return {
      objective: "Prepare a bounded MangaMaker operation plan.",
      phase: "reporting",
      status: pendingCommandPlan.requiresConfirmation ? "waiting_for_user" : "completed",
      currentStepId: "command-plan",
      steps: [
        {
          id: "command-plan",
          title: pendingCommandPlan.summary,
          status: pendingCommandPlan.requiresConfirmation ? "in_progress" : "completed",
          stopCondition: pendingCommandPlan.requiresConfirmation
            ? "Stop until the creator confirms or cancels the plan."
            : "Stop after presenting the plan.",
        },
      ],
      stopCondition: pendingCommandPlan.requiresConfirmation
        ? "Wait for creator confirmation."
        : "Plan is ready.",
      nextAction: pendingCommandPlan.requiresConfirmation ? "Wait for confirmation." : undefined,
      percent: pendingCommandPlan.requiresConfirmation ? 75 : 100,
    };
  }
  return {
    objective: "Handle the creator request through the MangaMaker harness.",
    phase: "complete",
    status: "completed",
    currentStepId: "answer",
    steps: [
      {
        id: "answer",
        title: message.trim().length > 0 ? "Return final answer" : "Complete the task",
        status: "completed",
      },
    ],
    stopCondition: "Stop when no further tool call is required and the creator has a clear result.",
    stopReason: "The Agent returned a final answer and did not request additional tools.",
    percent: 100,
  };
};

const normalizeTaskProgress = (
  value: unknown,
  fallback: AgentTaskProgress,
): AgentTaskProgress => {
  if (!isRecord(value)) {
    return fallback;
  }
  const rawSteps = Array.isArray(value.steps)
    ? value.steps.slice(0, 12)
    : isRecord(value.steps)
      ? Object.entries(value.steps)
          .slice(0, 12)
          .map(([id, step]) => isRecord(step) ? { id, ...step } : step)
      : [];
  const steps = rawSteps.flatMap((step, index): AgentTaskProgress["steps"] => {
    if (typeof step === "string") {
      const title = step.trim();
      return title
        ? [{
            id: `step-${index + 1}`,
            title,
            status: index === 0 ? "in_progress" : "pending",
          }]
        : [];
    }
    if (!isRecord(step)) {
      return [];
    }
    const title =
      readTaskString(step.title) ??
      readTaskString(step.name) ??
      readTaskString(step.description) ??
      readTaskString(step.task) ??
      `Step ${index + 1}`;
    return [{
      id: readTaskString(step.id) ?? `step-${index + 1}`,
      title,
      status: normalizeTaskStepStatus(step.status) ?? (step.done === true ? "completed" : index === 0 ? "in_progress" : "pending"),
      ...(readTaskString(step.stopCondition) ? { stopCondition: readTaskString(step.stopCondition)! } : {}),
    }];
  });
  const percent = readTaskNumber(value.percent ?? value.progress);
  const normalized = {
    objective: readTaskString(value.objective) ?? readTaskString(value.goal) ?? fallback.objective,
    phase: normalizeTaskPhase(value.phase) ?? fallback.phase,
    status: normalizeTaskStatus(value.status) ?? fallback.status,
    steps: steps.length > 0 ? steps : fallback.steps,
    currentStepId:
      readTaskString(value.currentStepId) ??
      readTaskString(value.currentStep) ??
      readTaskString(value.activeStepId) ??
      fallback.currentStepId,
    stopCondition:
      readTaskString(value.stopCondition) ??
      readTaskString(value.stop_condition) ??
      fallback.stopCondition,
    ...(readTaskString(value.stopReason) ?? readTaskString(value.stop_reason) ?? fallback.stopReason
      ? { stopReason: readTaskString(value.stopReason) ?? readTaskString(value.stop_reason) ?? fallback.stopReason }
      : {}),
    ...(readTaskString(value.nextAction) ?? readTaskString(value.next_action) ?? fallback.nextAction
      ? { nextAction: readTaskString(value.nextAction) ?? readTaskString(value.next_action) ?? fallback.nextAction }
      : {}),
    ...(percent !== null ? { percent: Math.max(0, Math.min(100, percent)) } : fallback.percent !== undefined ? { percent: fallback.percent } : {}),
  };
  const parsed = taskProgressSchema.safeParse(normalized);
  return parsed.success ? parsed.data : fallback;
};

export const validateAgentChatResponse = (value: unknown): AgentChatResponse => {
  if (!isRecord(value)) {
    const repairCall = createInvalidAgentResponseShapeRepairCall(
      value,
      `Agent response must be a JSON object, but the model returned ${describeInvalidToolCallValue(value)}.`,
    );
    return {
      message: "MangaMaker detected a malformed Agent response and asked the model to repair it.",
      pendingCommandPlan: null,
      requestedToolCalls: [repairCall],
      warning: "Model response schema repair requested: response must be a JSON object.",
      taskProgress: createFallbackTaskProgress("Repair malformed Agent response.", [repairCall], null),
    };
  }
  const parsed = rawResponseSchema.parse(value);
  if (typeof parsed.message !== "string") {
    const repairCall = createInvalidAgentResponseShapeRepairCall(
      value,
      `Agent response message must be a string, but the model returned ${describeInvalidToolCallValue(parsed.message)}.`,
    );
    return {
      message: "MangaMaker detected a malformed Agent response and asked the model to repair it.",
      pendingCommandPlan: null,
      requestedToolCalls: [repairCall],
      usedVision: parsed.usedVision,
      warning: appendAgentWarning(
        typeof parsed.warning === "string" ? parsed.warning : undefined,
        "Model response schema repair requested: message must be a string.",
      ),
      visionUnavailableReason: parsed.visionUnavailableReason,
      taskProgress: createFallbackTaskProgress("Repair malformed Agent response.", [repairCall], null),
      requestTrace: parsed.requestTrace,
      modelDebug: parsed.modelDebug,
    };
  }
  const ignoredCommandPlanWarning = parsed.pendingCommandPlan !== null && parsed.pendingCommandPlan !== undefined
    ? AGENT_PAGE_COMMAND_PLAN_DISABLED_MESSAGE
    : null;
  const pendingCommandPlan = null;
  const requestedToolCalls = validateRequestedToolCalls(parsed.requestedToolCalls);
  const fallbackTaskProgress = createFallbackTaskProgress(parsed.message, requestedToolCalls, pendingCommandPlan);
  return {
    message: parsed.message,
    pendingCommandPlan,
    requestedToolCalls,
    usedVision: parsed.usedVision,
    warning: appendAgentWarning(parsed.warning, ignoredCommandPlanWarning),
    visionUnavailableReason: parsed.visionUnavailableReason,
    taskProgress: normalizeTaskProgress(parsed.taskProgress, fallbackTaskProgress),
    requestTrace: parsed.requestTrace,
    modelDebug: parsed.modelDebug,
  };
};
