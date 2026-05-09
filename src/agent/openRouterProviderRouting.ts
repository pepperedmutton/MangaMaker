export type OpenRouterProviderRouting = {
  order?: string[];
  ignore?: string[];
  only?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  sort?: "price" | "throughput" | "latency";
};

export const KIMI_K2_6_MODEL_ID = "moonshotai/kimi-k2.6";

const kimiK26PreferredProviderOrder = [
  "venice/int4",
  "moonshotai/int4",
  "fireworks",
  "siliconflow/fp8",
  "deepinfra/fp4",
  "atlas-cloud/int4",
];

export const getOpenRouterProviderRouting = (model: string): OpenRouterProviderRouting => {
  if (model === KIMI_K2_6_MODEL_ID) {
    return {
      order: kimiK26PreferredProviderOrder,
      ignore: ["phala"],
      allow_fallbacks: true,
      require_parameters: true,
    };
  }

  return {
    require_parameters: true,
  };
};

export const getOpenRouterFallbackProviderRouting = (model: string): OpenRouterProviderRouting => {
  if (model === KIMI_K2_6_MODEL_ID) {
    return {
      order: kimiK26PreferredProviderOrder.filter((provider) => provider !== "venice/int4"),
      ignore: ["venice/int4", "phala"],
      allow_fallbacks: true,
      require_parameters: true,
    };
  }

  return getOpenRouterProviderRouting(model);
};
