import type { AgentConfig } from "./types";
import {
  DEEPSEEK_V4_PRO_MODEL_ID,
  type AgentAvailableModel,
} from "./modelCatalog";
import {
  parseAgentContextWindowTokens,
  resolveAgentContextWindowTokens,
} from "./contextWindow";

export type AgentConfigEnv = Record<string, string | undefined>;

const readFlag = (env: AgentConfigEnv, key: string) => env[key] === "1";
const parseRepetitionPenalty = (value: string | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1.05;
  }
  return Math.min(2, Math.max(1, parsed));
};

export const getAgentConfigFromEnv = (
  env: AgentConfigEnv,
  availableModels?: AgentAvailableModel[],
  modelOverride?: string | null,
): AgentConfig => {
  const testMode = readFlag(env, "MANGAMAKER_AGENT_TEST_MODE");
  const model = modelOverride?.trim() || env.MANGAMAKER_AGENT_MODEL?.trim() || null;
  const apiKeyConfigured = Boolean(env.OPENROUTER_API_KEY?.trim());
  const envContextWindowTokens = parseAgentContextWindowTokens(
    env.MANGAMAKER_AGENT_CONTEXT_WINDOW_TOKENS ?? env.MANGAMAKER_AGENT_CONTEXT_WINDOW,
  );
  const repetitionPenalty = parseRepetitionPenalty(env.MANGAMAKER_AGENT_REPETITION_PENALTY);
  const configuredModel = availableModels?.find((entry) => entry.id === model) ?? null;
  const contextWindow = resolveAgentContextWindowTokens({
    envTokens: envContextWindowTokens,
    model,
    modelContextLength: configuredModel?.contextLength ?? null,
    testMode,
  });

  if (testMode) {
    return {
      enabled: true,
      provider: "test",
      model: model ?? "mangamaker-test-agent",
      modelCapability: "multimodal",
      apiKeyConfigured,
      testMode: true,
      visionEnabled: true,
      repetitionPenalty,
      ...contextWindow,
    };
  }

  if (!apiKeyConfigured) {
    return {
      enabled: false,
      provider: "unavailable",
      model,
      modelCapability: null,
      apiKeyConfigured: false,
      testMode: false,
      visionEnabled: false,
      repetitionPenalty,
      ...contextWindow,
      reason: "OPENROUTER_API_KEY is not configured.",
    };
  }

  if (!model) {
    return {
      enabled: false,
      provider: "unavailable",
      model: null,
      modelCapability: null,
      apiKeyConfigured: true,
      testMode: false,
      visionEnabled: false,
      repetitionPenalty,
      ...contextWindow,
      reason: "MANGAMAKER_AGENT_MODEL must be explicitly configured for the Agent.",
    };
  }

  if (availableModels && !availableModels.some((entry) => entry.id === model)) {
    return {
      enabled: false,
      provider: "unavailable",
      model,
      modelCapability: null,
      apiKeyConfigured: true,
      testMode: false,
      visionEnabled: false,
      repetitionPenalty,
      ...contextWindow,
      reason:
        `Configured model is not in the MangaMaker Agent allowlist. Use a Kimi/Qwen/DeepSeek multimodal JSON model, or ${DEEPSEEK_V4_PRO_MODEL_ID} for text-only document work.`,
    };
  }

  const modelCapability = configuredModel?.capability ?? (model === DEEPSEEK_V4_PRO_MODEL_ID ? "metadoc" : "multimodal");

  return {
    enabled: true,
    provider: "openrouter",
    model,
    modelCapability,
    apiKeyConfigured: true,
    testMode: false,
    visionEnabled: modelCapability === "multimodal",
    repetitionPenalty,
    ...contextWindow,
  };
};
