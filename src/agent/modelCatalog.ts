export type OpenRouterModelMetadata = {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
};

export type AgentModelCapability = "multimodal" | "metadoc";

export type AgentAvailableModel = {
  id: string;
  name: string;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
  capability: AgentModelCapability;
};

export const DEEPSEEK_V4_PRO_MODEL_ID = "deepseek/deepseek-v4-pro";
export const QWEN_3_6_FLASH_MODEL_ID = "qwen/qwen3.6-flash";

export const AGENT_MODEL_PRESETS = [
  {
    id: DEEPSEEK_V4_PRO_MODEL_ID,
    label: "DeepSeek latest",
    description: "DeepSeek V4 Pro, text-only metadoc/document mode.",
  },
  {
    id: QWEN_3_6_FLASH_MODEL_ID,
    label: "Qwen latest",
    description: "Qwen3.6 Flash, multimodal page/render and document mode.",
  },
] as const;

const allowedAgentModelPrefixes = [
  "deepseek/",
  "moonshotai/",
  "~moonshotai/",
  "qwen/",
];

export const isAllowedAgentModelProvider = (modelId: string) =>
  allowedAgentModelPrefixes.some((prefix) => modelId.startsWith(prefix));

const supportsJsonTextOutput = (model: OpenRouterModelMetadata) => {
  const outputModalities = model.architecture?.output_modalities ?? [];
  const supportedParameters = model.supported_parameters ?? [];
  return outputModalities.includes("text") && supportedParameters.includes("response_format");
};

export const isAllowedMultimodalAgentModel = (model: OpenRouterModelMetadata) => {
  const inputModalities = model.architecture?.input_modalities ?? [];
  return (
    isAllowedAgentModelProvider(model.id) &&
    inputModalities.includes("image") &&
    supportsJsonTextOutput(model)
  );
};

export const isAllowedMetadocOnlyAgentModel = (model: OpenRouterModelMetadata) => {
  const inputModalities = model.architecture?.input_modalities ?? [];
  return (
    model.id === DEEPSEEK_V4_PRO_MODEL_ID &&
    inputModalities.includes("text") &&
    !inputModalities.includes("image") &&
    supportsJsonTextOutput(model)
  );
};

export const getAgentModelCapability = (model: OpenRouterModelMetadata): AgentModelCapability | null => {
  if (isAllowedMultimodalAgentModel(model)) {
    return "multimodal";
  }
  if (isAllowedMetadocOnlyAgentModel(model)) {
    return "metadoc";
  }
  return null;
};

export const normalizeAgentModel = (model: OpenRouterModelMetadata): AgentAvailableModel | null => {
  const capability = getAgentModelCapability(model);
  if (!capability) {
    return null;
  }
  return {
    id: model.id,
    name: model.name ?? model.id,
    contextLength: typeof model.context_length === "number" ? model.context_length : null,
    inputModalities: model.architecture?.input_modalities ?? [],
    outputModalities: model.architecture?.output_modalities ?? [],
    capability,
  };
};

export const filterAllowedAgentModels = (models: OpenRouterModelMetadata[]) =>
  models
    .map(normalizeAgentModel)
    .filter((model): model is AgentAvailableModel => model !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
