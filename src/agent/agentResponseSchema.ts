import { z } from "zod";
import { commandRegistry } from "../commands/registry";
import { commandPlanRequiresConfirmation, getCommandDangerLevel } from "./commandManifest";
import type { AgentChatResponse, AgentCommandPlan, AgentCommandPlanItem } from "./types";

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

const rawResponseSchema = z.object({
  message: z.string(),
  pendingCommandPlan: rawPlanSchema.nullable().optional(),
  toolLogs: z.unknown().optional(),
  usedVision: z.boolean().optional(),
  warning: z.string().optional(),
  visionUnavailableReason: z.string().optional(),
});

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
    usedVision: parsed.usedVision,
    warning: parsed.warning,
    visionUnavailableReason: parsed.visionUnavailableReason,
  };
};
