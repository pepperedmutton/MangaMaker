export const KIMI_K2_6_MODEL_ID = "moonshotai/kimi-k2.6";
export const KIMI_K2_6_CONTEXT_WINDOW_TOKENS = 262_144;
export const DEEPSEEK_V4_PRO_CONTEXT_WINDOW_TOKENS = 1_048_576;
export const QWEN_3_6_FLASH_CONTEXT_WINDOW_TOKENS = 1_000_000;
export const DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS = KIMI_K2_6_CONTEXT_WINDOW_TOKENS;
export const MIN_AGENT_CONTEXT_WINDOW_TOKENS = 8_192;

export type AgentContextWindowResolution = {
  contextWindowTokens: number;
  contextWindowMaxTokens: number | null;
  contextWindowSource: "request" | "env" | "model" | "default" | "test";
};

export const parseAgentContextWindowTokens = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.max(MIN_AGENT_CONTEXT_WINDOW_TOKENS, Math.floor(parsed));
};

export const getKnownAgentModelContextWindow = (model: string | null | undefined) => {
  switch (model) {
    case KIMI_K2_6_MODEL_ID:
      return KIMI_K2_6_CONTEXT_WINDOW_TOKENS;
    case "deepseek/deepseek-v4-pro":
      return DEEPSEEK_V4_PRO_CONTEXT_WINDOW_TOKENS;
    case "qwen/qwen3.6-flash":
      return QWEN_3_6_FLASH_CONTEXT_WINDOW_TOKENS;
    default:
      return null;
  }
};

export const resolveAgentContextWindowTokens = ({
  requestedTokens,
  envTokens,
  model,
  modelContextLength,
  testMode = false,
}: {
  requestedTokens?: number | null;
  envTokens?: number | null;
  model?: string | null;
  modelContextLength?: number | null;
  testMode?: boolean;
}): AgentContextWindowResolution => {
  const knownMax = getKnownAgentModelContextWindow(model);
  const contextWindowMaxTokens =
    typeof modelContextLength === "number" && Number.isFinite(modelContextLength) && modelContextLength > 0
      ? modelContextLength
      : knownMax;
  const candidates = [
    requestedTokens ? { source: "request" as const, value: requestedTokens } : null,
    envTokens ? { source: "env" as const, value: envTokens } : null,
    contextWindowMaxTokens ? { source: "model" as const, value: contextWindowMaxTokens } : null,
    { source: testMode ? "test" as const : "default" as const, value: DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS },
  ].filter((entry): entry is { source: AgentContextWindowResolution["contextWindowSource"]; value: number } =>
    Boolean(entry),
  );
  const selected = candidates[0] ?? {
    source: testMode ? "test" as const : "default" as const,
    value: DEFAULT_AGENT_CONTEXT_WINDOW_TOKENS,
  };
  const clampedToMax =
    contextWindowMaxTokens && selected.value > contextWindowMaxTokens
      ? contextWindowMaxTokens
      : selected.value;
  return {
    contextWindowTokens: Math.max(MIN_AGENT_CONTEXT_WINDOW_TOKENS, Math.floor(clampedToMax)),
    contextWindowMaxTokens,
    contextWindowSource: selected.source,
  };
};
