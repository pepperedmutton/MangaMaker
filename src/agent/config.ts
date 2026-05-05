import type { AgentConfig } from "./types";
import type { AgentAvailableModel } from "./modelCatalog";

export type AgentConfigEnv = Record<string, string | undefined>;

const readFlag = (env: AgentConfigEnv, key: string) => env[key] === "1";

export const getAgentConfigFromEnv = (
  env: AgentConfigEnv,
  availableModels?: AgentAvailableModel[],
): AgentConfig => {
  const testMode = readFlag(env, "MANGAMAKER_AGENT_TEST_MODE");
  const model = env.MANGAMAKER_AGENT_MODEL?.trim() || null;
  const apiKeyConfigured = Boolean(env.OPENROUTER_API_KEY?.trim());

  if (testMode) {
    return {
      enabled: true,
      provider: "test",
      model: model ?? "mangamaker-test-agent",
      apiKeyConfigured,
      testMode: true,
      visionEnabled: true,
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
  };
};
