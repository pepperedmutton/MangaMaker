import { z } from "zod";
import { commandRegistry } from "../commands/registry";
import type { CommandDefinition } from "../commands/types";
import type {
  AgentCommandManifestEntry,
  AgentCommandPlanItem,
  AgentDangerLevel,
} from "./types";

type JsonSchema = Record<string, unknown>;

const ZOD_KIND = z.ZodFirstPartyTypeKind;

const safeDescription = (label: string) =>
  label
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

const getTypeName = (schema: z.ZodTypeAny) => schema._def.typeName;

const unwrapForSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  const typeName = getTypeName(schema);
  if (typeName === ZOD_KIND.ZodOptional || typeName === ZOD_KIND.ZodDefault || typeName === ZOD_KIND.ZodCatch) {
    return unwrapForSchema((schema._def as { innerType: z.ZodTypeAny }).innerType);
  }
  if (typeName === ZOD_KIND.ZodEffects) {
    return unwrapForSchema((schema._def as { schema: z.ZodTypeAny }).schema);
  }
  if (typeName === ZOD_KIND.ZodPipeline) {
    return unwrapForSchema((schema._def as { out: z.ZodTypeAny }).out);
  }
  return schema;
};

const isOptionalObjectField = (schema: z.ZodTypeAny): boolean => {
  const typeName = getTypeName(schema);
  if (typeName === ZOD_KIND.ZodOptional || typeName === ZOD_KIND.ZodDefault || typeName === ZOD_KIND.ZodCatch) {
    return true;
  }
  if (typeName === ZOD_KIND.ZodEffects) {
    return isOptionalObjectField((schema._def as { schema: z.ZodTypeAny }).schema);
  }
  return false;
};

const mergeNumberChecks = (schema: z.ZodTypeAny, jsonSchema: JsonSchema) => {
  const checks = (schema._def as { checks?: Array<{ kind: string; value?: number; inclusive?: boolean }> }).checks ?? [];
  for (const check of checks) {
    if (check.kind === "min" && typeof check.value === "number") {
      jsonSchema[check.inclusive === false ? "exclusiveMinimum" : "minimum"] = check.value;
    }
    if (check.kind === "max" && typeof check.value === "number") {
      jsonSchema[check.inclusive === false ? "exclusiveMaximum" : "maximum"] = check.value;
    }
    if (check.kind === "int") {
      jsonSchema.type = "integer";
    }
  }
};

const mergeStringChecks = (schema: z.ZodTypeAny, jsonSchema: JsonSchema) => {
  const checks = (schema._def as { checks?: Array<{ kind: string; value?: number; regex?: RegExp }> }).checks ?? [];
  for (const check of checks) {
    if (check.kind === "min" && typeof check.value === "number") {
      jsonSchema.minLength = check.value;
    }
    if (check.kind === "max" && typeof check.value === "number") {
      jsonSchema.maxLength = check.value;
    }
    if (check.kind === "regex" && check.regex) {
      jsonSchema.pattern = check.regex.source;
    }
  }
};

export const zodToJsonSchema = (schema: z.ZodTypeAny): JsonSchema => {
  const original = schema;
  const unwrapped = unwrapForSchema(schema);
  const typeName = getTypeName(unwrapped);

  if (typeName === ZOD_KIND.ZodNullable) {
    const inner = (unwrapped._def as { innerType: z.ZodTypeAny }).innerType;
    return {
      anyOf: [zodToJsonSchema(inner), { type: "null" }],
    };
  }

  if (typeName === ZOD_KIND.ZodString) {
    const jsonSchema: JsonSchema = { type: "string" };
    mergeStringChecks(unwrapped, jsonSchema);
    return jsonSchema;
  }

  if (typeName === ZOD_KIND.ZodNumber || typeName === ZOD_KIND.ZodNaN) {
    const jsonSchema: JsonSchema = { type: "number" };
    mergeNumberChecks(unwrapped, jsonSchema);
    return jsonSchema;
  }

  if (typeName === ZOD_KIND.ZodBoolean) {
    return { type: "boolean" };
  }

  if (typeName === ZOD_KIND.ZodEnum) {
    return {
      type: "string",
      enum: (unwrapped._def as { values: string[] }).values,
    };
  }

  if (typeName === ZOD_KIND.ZodNativeEnum) {
    return {
      enum: Object.values((unwrapped._def as { values: Record<string, string | number> }).values),
    };
  }

  if (typeName === ZOD_KIND.ZodLiteral) {
    const value = (unwrapped._def as { value: unknown }).value;
    return {
      const: value,
      type: typeof value,
    };
  }

  if (typeName === ZOD_KIND.ZodArray) {
    return {
      type: "array",
      items: zodToJsonSchema((unwrapped._def as { type: z.ZodTypeAny }).type),
    };
  }

  if (typeName === ZOD_KIND.ZodTuple) {
    const items = (unwrapped._def as { items: z.ZodTypeAny[] }).items;
    return {
      type: "array",
      prefixItems: items.map((item) => zodToJsonSchema(item)),
      minItems: items.length,
      maxItems: items.length,
    };
  }

  if (typeName === ZOD_KIND.ZodRecord) {
    return {
      type: "object",
      additionalProperties: zodToJsonSchema((unwrapped._def as { valueType: z.ZodTypeAny }).valueType),
    };
  }

  if (typeName === ZOD_KIND.ZodUnion) {
    return {
      anyOf: (unwrapped._def as { options: z.ZodTypeAny[] }).options.map((option) => zodToJsonSchema(option)),
    };
  }

  if (typeName === ZOD_KIND.ZodDiscriminatedUnion) {
    return {
      anyOf: Array.from((unwrapped._def as { options: Map<string, z.ZodTypeAny> }).options.values()).map((option) =>
        zodToJsonSchema(option),
      ),
    };
  }

  if (typeName === ZOD_KIND.ZodIntersection) {
    return {
      allOf: [
        zodToJsonSchema((unwrapped._def as { left: z.ZodTypeAny }).left),
        zodToJsonSchema((unwrapped._def as { right: z.ZodTypeAny }).right),
      ],
    };
  }

  if (typeName === ZOD_KIND.ZodObject) {
    const shape = (unwrapped._def as { shape: () => Record<string, z.ZodTypeAny> }).shape();
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!isOptionalObjectField(value)) {
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    };
  }

  if (typeName === ZOD_KIND.ZodAny || typeName === ZOD_KIND.ZodUnknown) {
    return {};
  }

  if (typeName === ZOD_KIND.ZodNever) {
    return { not: {} };
  }

  if (typeName === ZOD_KIND.ZodVoid || typeName === ZOD_KIND.ZodUndefined) {
    return { type: "null" };
  }

  return {
    description: `Unsupported Zod schema kind: ${String(getTypeName(unwrapForSchema(original)))}`,
  };
};

const destructiveCommandIds = new Set([
  "deleteStoredProject",
  "deleteObject",
  "removePage",
  "loadProject",
  "setProjectType",
  "createProject",
]);

const sessionOnlyCommandIds = new Set([
  "listStoredProjects",
  "createClipboardEnvelope",
  "selectPage",
  "selectObject",
  "selectObjects",
  "clearSelection",
  "setTool",
  "setBubbleInsertState",
  "setLocale",
  "setZoom",
  "enterPanelImageEdit",
  "exitPanelImageEdit",
  "exportPagePng",
  "exportProjectPdf",
  "exportProjectJpgZip",
]);

const normalSideEffectCommandIds = new Set([
  "saveProject",
  "goHome",
  "undo",
  "redo",
  "duplicateStoredProject",
]);

const projectPersistenceOnlyCommandIds = new Set([
  "saveProject",
]);

const projectReplacementCommandIds = new Set([
  "createProject",
  "loadProject",
  "setProjectType",
]);

const descriptionByCommandId: Record<string, string> = {
  createPanel: "Create one panel on a page.",
  createText: "Create one text box on a page.",
  updateText: "Update the selected text box geometry, content, font, color, or stroke.",
  createBubble: "Create one speech bubble on a page.",
  updateBubble: "Update one speech bubble geometry and style.",
  saveProject: "Save the current project through the normal project persistence command.",
  removePage: "Remove one page from the current project.",
  deleteObject: "Delete one panel, text box, or bubble from a page.",
  setTool: "Switch the active editor tool.",
  selectObject: "Select one object in the editor.",
  selectObjects: "Select multiple objects on a page.",
};

const guiEquivalentByCommandId: Record<string, string> = {
  createPanel: "Panel tool drag on canvas or canvas context menu create panel",
  createText: "Text tool click/drag on canvas or canvas context menu create text",
  updateText: "Inspector text controls",
  createBubble: "Bubble tool drag on canvas or inspector bubble insert",
  updateBubble: "Inspector bubble controls",
  saveProject: "Ribbon Save button or Ctrl/Cmd+S",
  removePage: "Left sidebar page delete action",
  deleteObject: "Delete key or inspector delete button",
  setTool: "Ribbon tool buttons",
  selectObject: "Click object on canvas",
  selectObjects: "Canvas marquee selection",
  setZoom: "Ribbon zoom slider",
  setPageBackground: "Ribbon page background color picker",
  placeImageInPanel: "Inspector Import Image button",
  moveLayer: "Canvas context menu layer actions",
};

const exampleByCommandId: Record<string, unknown[]> = {
  createPanel: [
    { pageId: "page-id", x: 120, y: 120, width: 320, height: 260 },
  ],
  createText: [
    { pageId: "page-id", x: 200, y: 200, content: "Hello" },
  ],
  updateText: [
    { pageId: "page-id", textId: "text-id", strokeColor: "#ff0000", strokeWidth: 4 },
  ],
  createBubble: [
    { pageId: "page-id", x: 280, y: 240, width: 260, height: 150, bubbleType: "round" },
  ],
  saveProject: [{}],
  setTool: [{ tool: "panel" }],
  selectObject: [{ pageId: "page-id", objectType: "text", objectId: "text-id" }],
};

const inferDangerLevel = (commandId: string, definition: CommandDefinition): AgentDangerLevel => {
  if (destructiveCommandIds.has(commandId)) {
    return "destructive";
  }
  if (commandId === "removePanelPoint") {
    return "normal";
  }
  if (normalSideEffectCommandIds.has(commandId) || definition.recordHistory) {
    return "normal";
  }
  return "safe";
};

const inferMutatesProject = (commandId: string, definition: CommandDefinition) => {
  if (sessionOnlyCommandIds.has(commandId)) {
    return false;
  }
  if (projectPersistenceOnlyCommandIds.has(commandId)) {
    return false;
  }
  if (projectReplacementCommandIds.has(commandId)) {
    return true;
  }
  return Boolean(definition.recordHistory) || normalSideEffectCommandIds.has(commandId);
};

export const buildCommandManifest = (): AgentCommandManifestEntry[] =>
  (Object.values(commandRegistry) as CommandDefinition[]).map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: descriptionByCommandId[definition.id] ?? safeDescription(definition.label),
    inputJsonSchema: zodToJsonSchema(definition.inputSchema),
    recordHistory: Boolean(definition.recordHistory),
    mutatesProject: inferMutatesProject(definition.id, definition),
    dangerLevel: inferDangerLevel(definition.id, definition),
    guiEquivalent: guiEquivalentByCommandId[definition.id] ?? `GUI command equivalent: ${definition.label}`,
    examples: exampleByCommandId[definition.id] ?? [],
  }));

export const getCommandManifestEntry = (commandId: string) =>
  buildCommandManifest().find((entry) => entry.id === commandId) ?? null;

export const getCommandDangerLevel = (commandId: string): AgentDangerLevel =>
  getCommandManifestEntry(commandId)?.dangerLevel ?? "destructive";

export const commandMutatesProject = (commandId: string) =>
  getCommandManifestEntry(commandId)?.mutatesProject ?? true;

export const commandRecordsHistory = (commandId: string) =>
  getCommandManifestEntry(commandId)?.recordHistory ?? false;

export const commandPlanRequiresConfirmation = (commands: AgentCommandPlanItem[]) => {
  if (commands.some((command) => getCommandDangerLevel(command.commandId) === "destructive")) {
    return true;
  }
  const pageIds = new Set<string>();
  let mutatingCommands = 0;
  for (const command of commands) {
    const payload = command.payload && typeof command.payload === "object" ? command.payload as Record<string, unknown> : {};
    if (typeof payload.pageId === "string") {
      pageIds.add(payload.pageId);
    }
    if (commandMutatesProject(command.commandId)) {
      mutatingCommands += 1;
    }
  }
  return pageIds.size > 1 || mutatingCommands > 1;
};
