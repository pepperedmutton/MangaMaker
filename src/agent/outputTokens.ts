export const DEFAULT_AGENT_MAX_OUTPUT_TOKENS = 16_384;
export const MIN_AGENT_MAX_OUTPUT_TOKENS = 1;

export const KIMI_K2_6_MAX_OUTPUT_TOKENS = 262_142;
export const DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS = 384_000;
export const QWEN_3_6_FLASH_MAX_OUTPUT_TOKENS = 65_536;

export type AgentMaxOutputResolution = {
  maxOutputTokens: number;
  maxOutputMaxTokens: number | null;
  maxOutputSource: "env" | "model" | "default" | "test";
};

export const parseAgentMaxOutputTokens = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.max(MIN_AGENT_MAX_OUTPUT_TOKENS, Math.floor(parsed));
};

export const getKnownAgentModelMaxOutputTokens = (model: string | null | undefined) => {
  switch (model) {
    case "moonshotai/kimi-k2.6":
      return KIMI_K2_6_MAX_OUTPUT_TOKENS;
    case "deepseek/deepseek-v4-pro":
      return DEEPSEEK_V4_PRO_MAX_OUTPUT_TOKENS;
    case "qwen/qwen3.6-flash":
      return QWEN_3_6_FLASH_MAX_OUTPUT_TOKENS;
    default:
      return null;
  }
};

export const resolveAgentMaxOutputTokens = ({
  envTokens,
  model,
  modelMaxOutputTokens,
  testMode = false,
}: {
  envTokens?: number | null;
  model?: string | null;
  modelMaxOutputTokens?: number | null;
  testMode?: boolean;
}): AgentMaxOutputResolution => {
  const knownMax = getKnownAgentModelMaxOutputTokens(model);
  const maxOutputMaxTokens =
    typeof modelMaxOutputTokens === "number" && Number.isFinite(modelMaxOutputTokens) && modelMaxOutputTokens > 0
      ? modelMaxOutputTokens
      : knownMax;
  const candidates = [
    envTokens ? { source: "env" as const, value: envTokens } : null,
    maxOutputMaxTokens ? { source: "model" as const, value: maxOutputMaxTokens } : null,
    {
      source: testMode ? "test" as const : "default" as const,
      value: testMode ? QWEN_3_6_FLASH_MAX_OUTPUT_TOKENS : DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
    },
  ].filter((entry): entry is { source: AgentMaxOutputResolution["maxOutputSource"]; value: number } =>
    Boolean(entry),
  );
  const selected = candidates[0] ?? {
    source: testMode ? "test" as const : "default" as const,
    value: testMode ? QWEN_3_6_FLASH_MAX_OUTPUT_TOKENS : DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
  };
  const clampedToMax =
    maxOutputMaxTokens && selected.value > maxOutputMaxTokens
      ? maxOutputMaxTokens
      : selected.value;
  return {
    maxOutputTokens: Math.max(MIN_AGENT_MAX_OUTPUT_TOKENS, Math.floor(clampedToMax)),
    maxOutputMaxTokens,
    maxOutputSource: selected.source,
  };
};
