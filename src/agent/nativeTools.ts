export type OpenRouterNativeTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
};

export type OpenRouterNativeToolSource = {
  name: string;
  description: string;
  inputSchema: unknown;
  outputDescription: string;
  mutatesProject: boolean;
};

const OPENAI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export const createOpenRouterNativeTools = (
  tools: OpenRouterNativeToolSource[] | undefined,
): OpenRouterNativeTool[] =>
  (tools ?? [])
    .filter((tool) => OPENAI_TOOL_NAME_PATTERN.test(tool.name))
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: [
          tool.description,
          tool.outputDescription ? `Returns: ${tool.outputDescription}` : "",
          tool.mutatesProject
            ? "This tool mutates a durable MangaMaker project document. Call it only when the creator's requested edit should be persisted."
            : "",
        ].filter(Boolean).join("\n"),
        parameters: tool.inputSchema,
      },
    }));
