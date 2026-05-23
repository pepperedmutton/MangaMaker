export const AGENT_RUN_MODE_IDS = ["economy", "balanced", "deep"] as const;

export type AgentRunMode = (typeof AGENT_RUN_MODE_IDS)[number];

export type AgentRunModeProfile = {
  id: AgentRunMode;
  label: string;
  description: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  reasoningMaxTokens: number;
  toolBudget: {
    maxToolRounds: number;
    maxToolCalls: number;
    maxToolCallsPerRound: number;
  };
  mutationBudget: {
    maxMutationRounds: number;
    rule: string;
  };
  batchLimits: {
    readPages: number;
    renderPages: number;
  };
  visualPolicy: string;
};

export const DEFAULT_AGENT_RUN_MODE: AgentRunMode = "economy";

export const AGENT_RUN_MODE_PROFILES: Record<AgentRunMode, AgentRunModeProfile> = {
  economy: {
    id: "economy",
    label: "Economy",
    description: "Lower cost through low tool budget and structured reads before screenshots. Input/output caps use the selected model limit.",
    contextWindowTokens: 65_536,
    maxOutputTokens: 4_096,
    reasoningMaxTokens: 1_024,
    toolBudget: {
      maxToolRounds: 6,
      maxToolCalls: 18,
      maxToolCallsPerRound: 6,
    },
    mutationBudget: {
      maxMutationRounds: 2,
      rule:
        "Gather context first. Once any document mutation tool is executed, MangaMaker allows at most two mutation rounds before forcing a final report.",
    },
    batchLimits: {
      readPages: 8,
      renderPages: 2,
    },
    visualPolicy:
      "Default to no screenshots. Use list/read/document tools first; request render tools only when visual evidence is explicitly required or structured page data is insufficient.",
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    description: "General work with a moderate tool budget. Input/output caps use the selected model limit.",
    contextWindowTokens: 131_072,
    maxOutputTokens: 8_192,
    reasoningMaxTokens: 2_048,
    toolBudget: {
      maxToolRounds: 12,
      maxToolCalls: 48,
      maxToolCallsPerRound: 12,
    },
    mutationBudget: {
      maxMutationRounds: 2,
      rule:
        "Gather context first. Once any document mutation tool is executed, MangaMaker allows at most two mutation rounds before forcing a final report.",
    },
    batchLimits: {
      readPages: 18,
      renderPages: 6,
    },
    visualPolicy:
      "Use targeted screenshots for visual page judgment, but prefer one batched render over repeated single-page renders.",
  },
  deep: {
    id: "deep",
    label: "Deep",
    description: "Expensive review with larger page batches and multi-page renders. Input/output caps use the selected model limit.",
    contextWindowTokens: 262_144,
    maxOutputTokens: 16_384,
    reasoningMaxTokens: 4_096,
    toolBudget: {
      maxToolRounds: 36,
      maxToolCalls: 144,
      maxToolCallsPerRound: 24,
    },
    mutationBudget: {
      maxMutationRounds: 2,
      rule:
        "Gather context first. Once any document mutation tool is executed, MangaMaker allows at most two mutation rounds before forcing a final report.",
    },
    batchLimits: {
      readPages: 72,
      renderPages: 24,
    },
    visualPolicy:
      "Use broad page reads and multi-page visual renders only when the creator asks for deep review or the task truly requires visual coverage across many pages.",
  },
};

export const parseAgentRunMode = (value: unknown): AgentRunMode | null =>
  typeof value === "string" && AGENT_RUN_MODE_IDS.includes(value as AgentRunMode)
    ? (value as AgentRunMode)
    : null;

export const getAgentRunModeProfile = (value: unknown): AgentRunModeProfile =>
  AGENT_RUN_MODE_PROFILES[parseAgentRunMode(value) ?? DEFAULT_AGENT_RUN_MODE];
