export type OpenRouterProviderRouting = {
  order?: string[];
  ignore?: string[];
  only?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  sort?: "price" | "throughput" | "latency";
};

export const KIMI_K2_6_MODEL_ID = "moonshotai/kimi-k2.6";

const createCostRouting = (options: { ignore?: string[] } = {}): OpenRouterProviderRouting => ({
  ...(options.ignore && options.ignore.length > 0 ? { ignore: options.ignore } : {}),
  allow_fallbacks: true,
  require_parameters: true,
  sort: "price",
});

export const getOpenRouterProviderRouting = (model: string): OpenRouterProviderRouting => {
  if (model === KIMI_K2_6_MODEL_ID) {
    return createCostRouting({ ignore: ["phala"] });
  }

  return createCostRouting();
};

export const getOpenRouterFallbackProviderRouting = (model: string): OpenRouterProviderRouting => {
  if (model === KIMI_K2_6_MODEL_ID) {
    return createCostRouting({ ignore: ["phala"] });
  }

  return getOpenRouterProviderRouting(model);
};
