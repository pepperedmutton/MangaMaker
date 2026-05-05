import { useEditorStore } from "../state/editorStore";
import type { ExecuteCommandOptions } from "../state/editorStore";
import { commandRegistry } from "../commands/registry";
import {
  buildCommandManifest,
  commandPlanRequiresConfirmation,
  commandRecordsHistory,
  getCommandDangerLevel,
} from "./commandManifest";
import {
  captureCurrentCanvasSnapshot,
  getAgentContext,
  listImageAssets as listImageAssetsFromProject,
  readImageAsset as readImageAssetBySrc,
} from "./context";
import type { AgentCommandPlan, AgentCommandPlanItem } from "./types";

const now = () => new Date().toISOString();

const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const readProject = () => useEditorStore.getState().project;

export const readSession = () => {
  const state = useEditorStore.getState();
  return {
    selectedPageId: state.selectedPageId,
    selection: state.selection,
    multiSelection: state.multiSelection,
    activeTool: state.activeTool,
    zoom: state.zoom,
    saveStatus: state.saveStatus,
    appView: state.appView,
  };
};

export const readCommandManifest = () => buildCommandManifest();

export const readCanvasSnapshot = (scope: "canvas" | "selection" = "canvas") =>
  captureCurrentCanvasSnapshot(scope);

export const listImageAssets = () => listImageAssetsFromProject();

export const readImageAsset = ({ src }: { src: string }) => readImageAssetBySrc(src);

export const previewCommandPlan = ({ commands, summary }: { commands: AgentCommandPlanItem[]; summary?: string }): AgentCommandPlan => {
  const hydratedCommands = commands.map((command) => ({
    commandId: command.commandId,
    payload: command.payload,
    reason: command.reason,
    dangerLevel: getCommandDangerLevel(command.commandId),
  }));
  return {
    summary: summary ?? "Command plan",
    commands: hydratedCommands,
    requiresConfirmation: commandPlanRequiresConfirmation(hydratedCommands),
  };
};

export const validateCommandPlanPayloads = (plan: AgentCommandPlan): AgentCommandPlan => ({
  ...plan,
  commands: plan.commands.map((command, index) => {
    const definition = commandRegistry[command.commandId as keyof typeof commandRegistry];
    if (!definition) {
      throw new Error(`Unknown command in Agent plan at index ${index}: ${command.commandId}`);
    }
    return {
      ...command,
      payload: definition.inputSchema.parse(command.payload),
      dangerLevel: getCommandDangerLevel(command.commandId),
    };
  }),
});

export const executeCommand = async ({
  commandId,
  payload,
  options,
}: {
  commandId: string;
  payload: unknown;
  options?: ExecuteCommandOptions;
}) => {
  const result = await useEditorStore.getState().executeCommand(commandId, payload, options);
  return {
    commandId,
    result,
    executedAt: now(),
  };
};

export const executeCommandPlan = async (
  plan: AgentCommandPlan,
  options: { approved?: boolean } = {},
) => {
  const normalizedPlan = previewCommandPlan({
    commands: plan.commands,
    summary: plan.summary,
  });
  const validatedPlan = validateCommandPlanPayloads(normalizedPlan);
  if (validatedPlan.requiresConfirmation && options.approved !== true) {
    throw new Error("This command plan requires user confirmation before execution.");
  }

  const results: Array<{ commandId: string; result: unknown; executedAt: string }> = [];
  const historyCommands = validatedPlan.commands.filter((command) =>
    commandRecordsHistory(command.commandId),
  );
  const shouldGroupHistory = historyCommands.length > 1;
  const historyKey = shouldGroupHistory ? createId("agent-plan-history") : undefined;
  let remainingHistoryCommands = historyCommands.length;

  for (const command of validatedPlan.commands) {
    const recordsHistory = commandRecordsHistory(command.commandId);
    const commandOptions =
      shouldGroupHistory && recordsHistory
        ? {
            historyKey,
            transient: remainingHistoryCommands > 1,
            commitHistory: remainingHistoryCommands === 1,
          }
        : undefined;
    results.push(
      await executeCommand({
        commandId: command.commandId,
        payload: command.payload,
        options: commandOptions,
      }),
    );
    if (recordsHistory) {
      remainingHistoryCommands -= 1;
    }
  }
  return {
    plan: validatedPlan,
    results,
  };
};

export const agentTools = {
  readProject,
  readSession,
  readCommandManifest,
  readCanvasSnapshot,
  listImageAssets,
  readImageAsset,
  previewCommandPlan,
  executeCommand,
  executeCommandPlan,
  getAgentContext,
};
