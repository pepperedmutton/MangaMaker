import type { AgentConfig } from "./types";
import type { AgentAvailableModel } from "./modelCatalog";
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
): AgentConfig => {
  const testMode = readFlag(env, "MANGAMAKER_AGENT_TEST_MODE");
  const model = env.MANGAMAKER_AGENT_MODEL?.trim() || null;
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
      apiKeyConfigured: true,
      testMode: false,
      visionEnabled: false,
      repetitionPenalty,
      ...contextWindow,
      reason: "MANGAMAKER_AGENT_MODEL must be explicitly configured for the multimodal Agent.",
    };
  }

  if (availableModels && !availableModels.some((entry) => entry.id === model)) {
    return {
      enabled: false,
      provider: "unavailable",
      model,
      apiKeyConfigured: true,
      testMode: false,
      visionEnabled: false,
      repetitionPenalty,
      ...contextWindow,
      reason:
        "Configured model is not in the MangaMaker Agent allowlist. Use a DeepSeek or Kimi model that supports image input, text output, and JSON response_format.",
    };
  }

  return {
    enabled: true,
    provider: "openrouter",
    model,
    apiKeyConfigured: true,
    testMode: false,
    visionEnabled: true,
    repetitionPenalty,
    ...contextWindow,
  };
};
