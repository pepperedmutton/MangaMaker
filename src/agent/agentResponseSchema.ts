import { z } from "zod";
import { commandRegistry } from "../commands/registry";
import { commandPlanRequiresConfirmation, getCommandDangerLevel } from "./commandManifest";
import { agentDocumentStatusSchema } from "./documentSchema";
import {
  AGENT_MAX_BATCH_READ_PAGES,
  AGENT_MAX_BATCH_RENDER_PAGES,
  AGENT_MAX_MODEL_PAGE_IDS_PER_TOOL_CALL,
} from "./toolLimits";
import type { AgentChatResponse, AgentCommandPlan, AgentCommandPlanItem, AgentToolCallRequest } from "./types";

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

const rawResponseSchema = z.object({
  message: z.string(),
  pendingCommandPlan: rawPlanSchema.nullable().optional(),
  requestedToolCalls: z.array(z.object({
    toolName: z.string().min(1),
    input: z.custom<unknown>(() => true),
    reason: z.string().optional(),
  })).optional(),
  toolLogs: z.unknown().optional(),
  usedVision: z.boolean().optional(),
  warning: z.string().optional(),
  visionUnavailableReason: z.string().optional(),
  requestTrace: requestTraceSchema.optional(),
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
  "renderPages",
  "listCommandManifest",
  "listDocuments",
  "listRoles",
  "readDocument",
  "searchDocuments",
  "writeDocument",
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

const describeZodIssues = (error: unknown) => {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
};

const validateRequestedToolCalls = (
  value: Array<{ toolName: string; input?: unknown; reason?: string }> | undefined,
): AgentToolCallRequest[] => {
  if (!value) {
    return [];
  }
  return value.map((call, index) => {
    try {
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
          role: z.string().min(1).optional(),
          status: agentDocumentStatusSchema.optional(),
          path: z.string().min(1).optional(),
          relatedPageIds: z.array(z.string().min(1)).optional(),
          summary: z.string().optional(),
          content: z.string(),
        }).strict().parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      if (call.toolName === "proposeCommandPlan") {
        const parsed = rawPlanSchema.parse(call.input);
        return { toolName: call.toolName, input: parsed, reason: call.reason };
      }
      const input = z.object({}).passthrough().parse(call.input ?? {});
      return { toolName: call.toolName, input, reason: call.reason };
    } catch (error) {
      throw new Error(
        `Agent requested invalid input for requestedToolCalls[${index}] ${call.toolName}: ${describeZodIssues(error)}`,
      );
    }
  });
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

export const validateAgentChatResponse = (value: unknown): AgentChatResponse => {
  const parsed = rawResponseSchema.parse(value);
  return {
    message: parsed.message,
    pendingCommandPlan: validateAgentCommandPlan(parsed.pendingCommandPlan ?? null),
    requestedToolCalls: validateRequestedToolCalls(parsed.requestedToolCalls),
    usedVision: parsed.usedVision,
    warning: parsed.warning,
    visionUnavailableReason: parsed.visionUnavailableReason,
    requestTrace: parsed.requestTrace,
  };
};
