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

export type AgentAvailableModel = {
  id: string;
  name: string;
  contextLength: number | null;
  inputModalities: string[];
  outputModalities: string[];
};

const allowedAgentModelPrefixes = [
  "deepseek/",
  "moonshotai/",
  "~moonshotai/",
];

export const isAllowedAgentModelProvider = (modelId: string) =>
  allowedAgentModelPrefixes.some((prefix) => modelId.startsWith(prefix));

export const isAllowedMultimodalAgentModel = (model: OpenRouterModelMetadata) => {
  const inputModalities = model.architecture?.input_modalities ?? [];
  const outputModalities = model.architecture?.output_modalities ?? [];
  const supportedParameters = model.supported_parameters ?? [];
  return (
    isAllowedAgentModelProvider(model.id) &&
    inputModalities.includes("image") &&
    outputModalities.includes("text") &&
    supportedParameters.includes("response_format")
  );
};

export const normalizeAgentModel = (model: OpenRouterModelMetadata): AgentAvailableModel => ({
  id: model.id,
  name: model.name ?? model.id,
  contextLength: typeof model.context_length === "number" ? model.context_length : null,
  inputModalities: model.architecture?.input_modalities ?? [],
  outputModalities: model.architecture?.output_modalities ?? [],
});

export const filterAllowedAgentModels = (models: OpenRouterModelMetadata[]) =>
  models
    .filter(isAllowedMultimodalAgentModel)
    .map(normalizeAgentModel)
    .sort((a, b) => a.id.localeCompare(b.id));
