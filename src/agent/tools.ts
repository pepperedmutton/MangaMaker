import { useEditorStore } from "../state/editorStore";
import type { ExecuteCommandOptions } from "../state/editorStore";
import { commandRegistry } from "../commands/registry";
import type { Page, Project } from "../domain/schema";
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
import type {
  AgentCommandPlan,
  AgentCommandPlanAffectedChange,
  AgentCommandPlanExecutionDiff,
  AgentCommandPlanItem,
} from "./types";

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

type ComparableRecord = Record<string, unknown>;
type ObjectCollectionKey = "panels" | "texts" | "bubbles" | "elements";

const PAGE_METADATA_FIELDS = new Set(["id", "panels", "texts", "bubbles", "elements"]);
const PROJECT_METADATA_FIELDS = new Set(["id", "createdAt", "updatedAt", "pages"]);
const OBJECT_METADATA_FIELDS = new Set(["id"]);

const objectCollections: Array<{
  key: ObjectCollectionKey;
  objectType: AgentCommandPlanAffectedChange["objectType"];
}> = [
  { key: "panels", objectType: "panel" },
  { key: "texts", objectType: "text" },
  { key: "bubbles", objectType: "bubble" },
  { key: "elements", objectType: "element" },
];

const toRecord = (value: unknown): ComparableRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as ComparableRecord : {};

const stringifyComparable = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getChangedFields = (
  before: unknown,
  after: unknown,
  ignoredFields: Set<string>,
) => {
  const beforeRecord = toRecord(before);
  const afterRecord = toRecord(after);
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  return [...keys]
    .filter((key) => !ignoredFields.has(key))
    .filter((key) => stringifyComparable(beforeRecord[key]) !== stringifyComparable(afterRecord[key]))
    .sort();
};

const getEntityFieldNames = (value: unknown, ignoredFields: Set<string>) =>
  Object.keys(toRecord(value)).filter((key) => !ignoredFields.has(key)).sort();

const indexById = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, item] as const));

const createObjectRef = (
  pageId: string,
  objectType: AgentCommandPlanAffectedChange["objectType"],
  objectId: string,
) => `${pageId}:${objectType}:${objectId}`;

const pushAffectedChange = (
  changes: AgentCommandPlanAffectedChange[],
  change: AgentCommandPlanAffectedChange,
) => {
  if (change.changedFields.length === 0) {
    return;
  }
  changes.push({
    ...change,
    changedFields: [...new Set(change.changedFields)].sort(),
  });
};

export const createRedactedCommandPlanDiff = (
  beforeProject: Project,
  afterProject: Project,
): AgentCommandPlanExecutionDiff => {
  const affected: AgentCommandPlanAffectedChange[] = [];
  const projectChangedFields = getChangedFields(beforeProject, afterProject, PROJECT_METADATA_FIELDS);
  pushAffectedChange(affected, {
    objectType: "project",
    changeType: "updated",
    changedFields: projectChangedFields,
  });

  const beforePages = indexById(beforeProject.pages);
  const afterPages = indexById(afterProject.pages);
  const pageIds = new Set([...beforePages.keys(), ...afterPages.keys()]);

  for (const pageId of pageIds) {
    const beforePage = beforePages.get(pageId);
    const afterPage = afterPages.get(pageId);
    const page = afterPage ?? beforePage;
    if (!page) {
      continue;
    }
    const pageNumber =
      afterProject.pages.findIndex((entry) => entry.id === page.id) + 1 ||
      beforeProject.pages.findIndex((entry) => entry.id === page.id) + 1 ||
      undefined;
    const pageInfo = {
      pageId: page.id,
      pageName: page.name,
      ...(pageNumber ? { pageNumber } : {}),
    };

    if (!beforePage && afterPage) {
      pushAffectedChange(affected, {
        ...pageInfo,
        objectType: "page",
        objectId: afterPage.id,
        objectRef: afterPage.id,
        changeType: "created",
        changedFields: getEntityFieldNames(afterPage, PAGE_METADATA_FIELDS),
      });
    } else if (beforePage && !afterPage) {
      pushAffectedChange(affected, {
        ...pageInfo,
        objectType: "page",
        objectId: beforePage.id,
        objectRef: beforePage.id,
        changeType: "deleted",
        changedFields: getEntityFieldNames(beforePage, PAGE_METADATA_FIELDS),
      });
    } else if (beforePage && afterPage) {
      pushAffectedChange(affected, {
        ...pageInfo,
        objectType: "page",
        objectId: afterPage.id,
        objectRef: afterPage.id,
        changeType: "updated",
        changedFields: getChangedFields(beforePage, afterPage, PAGE_METADATA_FIELDS),
      });
    }

    const beforePageCollections = beforePage as Page | undefined;
    const afterPageCollections = afterPage as Page | undefined;
    for (const { key, objectType } of objectCollections) {
      const beforeObjects = indexById((beforePageCollections?.[key] ?? []) as Array<{ id: string }>);
      const afterObjects = indexById((afterPageCollections?.[key] ?? []) as Array<{ id: string }>);
      const objectIds = new Set([...beforeObjects.keys(), ...afterObjects.keys()]);
      for (const objectId of objectIds) {
        const beforeObject = beforeObjects.get(objectId);
        const afterObject = afterObjects.get(objectId);
        const object = afterObject ?? beforeObject;
        if (!object) {
          continue;
        }
        const objectInfo = {
          ...pageInfo,
          objectType,
          objectId: object.id,
          objectRef: createObjectRef(page.id, objectType, object.id),
        };
        if (!beforeObject && afterObject) {
          pushAffectedChange(affected, {
            ...objectInfo,
            changeType: "created",
            changedFields: getEntityFieldNames(afterObject, OBJECT_METADATA_FIELDS),
          });
        } else if (beforeObject && !afterObject) {
          pushAffectedChange(affected, {
            ...objectInfo,
            changeType: "deleted",
            changedFields: getEntityFieldNames(beforeObject, OBJECT_METADATA_FIELDS),
          });
        } else if (beforeObject && afterObject) {
          pushAffectedChange(affected, {
            ...objectInfo,
            changeType: "updated",
            changedFields: getChangedFields(beforeObject, afterObject, OBJECT_METADATA_FIELDS),
          });
        }
      }
    }
  }

  const changedPageIds = [...new Set(affected.flatMap((change) => change.pageId ? [change.pageId] : []))];
  const changedObjectRefs = [
    ...new Set(
      affected.flatMap((change) =>
        change.objectRef && change.objectType !== "page" && change.objectType !== "project"
          ? [change.objectRef]
          : [],
      ),
    ),
  ];
  const changedFields = [...new Set(affected.flatMap((change) => change.changedFields))].sort();
  const changed = affected.length > 0;
  return {
    changed,
    redacted: true,
    summary: changed
      ? `项目状态变化 ${affected.length} 项，涉及 ${changedPageIds.length} 个页面、${changedObjectRefs.length} 个对象。`
      : "计划执行了但项目状态没有变化。",
    changedPageIds,
    changedObjectRefs,
    changedFields,
    affected,
  };
};

export const executeCommandPlan = async (
  plan: AgentCommandPlan,
  options: { approved?: boolean; persistProject?: boolean } = {},
) => {
  const normalizedPlan = previewCommandPlan({
    commands: plan.commands,
    summary: plan.summary,
  });
  const validatedPlan = validateCommandPlanPayloads(normalizedPlan);
  if (validatedPlan.requiresConfirmation && options.approved !== true) {
    throw new Error("This command plan requires user confirmation before execution.");
  }

  const beforeProject = structuredClone(useEditorStore.getState().project);
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
  const lastHistoryCommandIndex = validatedPlan.commands.reduce(
    (lastIndex, command, index) => (commandRecordsHistory(command.commandId) ? index : lastIndex),
    -1,
  );
  const lastSaveCommandIndex = validatedPlan.commands.reduce(
    (lastIndex, command, index) => (command.commandId === "saveProject" ? index : lastIndex),
    -1,
  );
  const hasExplicitSaveAfterMutations =
    lastSaveCommandIndex >= 0 && lastSaveCommandIndex > lastHistoryCommandIndex;
  if (options.persistProject === true && historyCommands.length > 0 && !hasExplicitSaveAfterMutations) {
    results.push(
      await executeCommand({
        commandId: "saveProject",
        payload: { target: "localDraft" },
      }),
    );
  }
  const executionDiff = createRedactedCommandPlanDiff(
    beforeProject,
    useEditorStore.getState().project,
  );
  return {
    plan: validatedPlan,
    results,
    executionDiff,
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
