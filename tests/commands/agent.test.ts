import { describe, expect, it } from "vitest";
import { getAgentConfigFromEnv } from "../../src/agent/config";
import { filterAllowedAgentModels } from "../../src/agent/modelCatalog";
import {
  commandPlanRequiresConfirmation,
  getCommandManifestEntry,
  getCommandDangerLevel,
} from "../../src/agent/commandManifest";
import { parseAgentModelJson, validateAgentChatResponse } from "../../src/agent/agentResponseSchema";
import {
  OpenRouterEmptyAssistantContentError,
  describeOpenRouterResponse,
  extractOpenRouterAssistantContent,
  getOpenRouterFinishReason,
  getOpenRouterReasoningLength,
  parseOpenRouterResponseJson,
} from "../../src/agent/openRouterResponse";
import {
  getOpenRouterFallbackProviderRouting,
  getOpenRouterProviderRouting,
} from "../../src/agent/openRouterProviderRouting";
import {
  KIMI_K2_6_CONTEXT_WINDOW_TOKENS,
  MIN_AGENT_CONTEXT_WINDOW_TOKENS,
} from "../../src/agent/contextWindow";
import { AGENT_MAX_BATCH_READ_PAGES } from "../../src/agent/toolLimits";
import { executeCommandPlan, previewCommandPlan } from "../../src/agent/tools";
import { useEditorStore } from "../../src/state/editorStore";

describe("agent config", () => {
  it("enables the test provider in test mode", () => {
    expect(getAgentConfigFromEnv({ MANGAMAKER_AGENT_TEST_MODE: "1" })).toMatchObject({
      enabled: true,
      provider: "test",
      testMode: true,
      visionEnabled: true,
    });
  });

  it("reports a missing OpenRouter API key", () => {
    expect(getAgentConfigFromEnv({ MANGAMAKER_AGENT_MODEL: "openai/gpt-4o" })).toMatchObject({
      enabled: false,
      provider: "unavailable",
      apiKeyConfigured: false,
      visionEnabled: false,
    });
  });

  it("requires and reports an explicitly configured allowlisted model", () => {
    const availableModels = [
      {
        id: "moonshotai/kimi-k2.6",
        name: "MoonshotAI: Kimi K2.6",
        contextLength: KIMI_K2_6_CONTEXT_WINDOW_TOKENS,
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
      },
    ];
    expect(
      getAgentConfigFromEnv(
        {
          OPENROUTER_API_KEY: "not-a-real-key",
          MANGAMAKER_AGENT_MODEL: "moonshotai/kimi-k2.6",
        },
        availableModels,
      ),
    ).toMatchObject({
      enabled: true,
      provider: "openrouter",
      model: "moonshotai/kimi-k2.6",
      apiKeyConfigured: true,
      visionEnabled: true,
      contextWindowTokens: KIMI_K2_6_CONTEXT_WINDOW_TOKENS,
      contextWindowMaxTokens: KIMI_K2_6_CONTEXT_WINDOW_TOKENS,
      contextWindowSource: "model",
    });

    expect(
      getAgentConfigFromEnv(
        {
          OPENROUTER_API_KEY: "not-a-real-key",
          MANGAMAKER_AGENT_MODEL: "openai/gpt-4o",
        },
        availableModels,
      ),
    ).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("allowlist"),
      visionEnabled: false,
    });

    expect(getAgentConfigFromEnv({ OPENROUTER_API_KEY: "not-a-real-key" })).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("MANGAMAKER_AGENT_MODEL"),
    });
  });

  it("lets the Agent context window be configured without exceeding the model limit", () => {
    const availableModels = [
      {
        id: "moonshotai/kimi-k2.6",
        name: "MoonshotAI: Kimi K2.6",
        contextLength: KIMI_K2_6_CONTEXT_WINDOW_TOKENS,
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
      },
    ];

    expect(
      getAgentConfigFromEnv(
        {
          OPENROUTER_API_KEY: "not-a-real-key",
          MANGAMAKER_AGENT_MODEL: "moonshotai/kimi-k2.6",
          MANGAMAKER_AGENT_CONTEXT_WINDOW_TOKENS: "131072",
        },
        availableModels,
      ),
    ).toMatchObject({
      contextWindowTokens: 131072,
      contextWindowSource: "env",
    });

    expect(
      getAgentConfigFromEnv(
        {
          OPENROUTER_API_KEY: "not-a-real-key",
          MANGAMAKER_AGENT_MODEL: "moonshotai/kimi-k2.6",
          MANGAMAKER_AGENT_CONTEXT_WINDOW_TOKENS: "999999",
        },
        availableModels,
      ),
    ).toMatchObject({
      contextWindowTokens: KIMI_K2_6_CONTEXT_WINDOW_TOKENS,
      contextWindowSource: "env",
    });

    expect(
      getAgentConfigFromEnv({
        MANGAMAKER_AGENT_TEST_MODE: "1",
        MANGAMAKER_AGENT_CONTEXT_WINDOW_TOKENS: "1024",
      }),
    ).toMatchObject({
      contextWindowTokens: MIN_AGENT_CONTEXT_WINDOW_TOKENS,
      contextWindowSource: "env",
    });
  });

  it("lets the Agent repetition penalty be configured and clamps unsafe values", () => {
    const availableModels = [
      {
        id: "moonshotai/kimi-k2.6",
        name: "MoonshotAI: Kimi K2.6",
        contextLength: KIMI_K2_6_CONTEXT_WINDOW_TOKENS,
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
      },
    ];

    expect(
      getAgentConfigFromEnv(
        {
          OPENROUTER_API_KEY: "not-a-real-key",
          MANGAMAKER_AGENT_MODEL: "moonshotai/kimi-k2.6",
          MANGAMAKER_AGENT_REPETITION_PENALTY: "1.2",
        },
        availableModels,
      ),
    ).toMatchObject({
      repetitionPenalty: 1.2,
    });

    expect(
      getAgentConfigFromEnv(
        {
          OPENROUTER_API_KEY: "not-a-real-key",
          MANGAMAKER_AGENT_MODEL: "moonshotai/kimi-k2.6",
          MANGAMAKER_AGENT_REPETITION_PENALTY: "9",
        },
        availableModels,
      ),
    ).toMatchObject({
      repetitionPenalty: 2,
    });
  });

  it("filters available models to DeepSeek or Kimi multimodal JSON-capable models", () => {
    const models = filterAllowedAgentModels([
      {
        id: "moonshotai/kimi-k2.6",
        name: "MoonshotAI: Kimi K2.6",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["response_format"],
        context_length: KIMI_K2_6_CONTEXT_WINDOW_TOKENS,
      },
      {
        id: "deepseek/deepseek-vl",
        name: "DeepSeek VL",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["response_format"],
      },
      {
        id: "openai/gpt-5.5",
        name: "OpenAI GPT",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["response_format"],
      },
      {
        id: "moonshotai/kimi-text-only",
        name: "Kimi text only",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: ["response_format"],
      },
      {
        id: "moonshotai/kimi-no-json",
        name: "Kimi no JSON",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: [],
      },
    ]);

    expect(models.map((model) => model.id)).toEqual([
      "deepseek/deepseek-vl",
      "moonshotai/kimi-k2.6",
    ]);
  });

  it("prioritizes Venice for Kimi K2.6 OpenRouter routing", () => {
    expect(getOpenRouterProviderRouting("moonshotai/kimi-k2.6")).toEqual({
      order: [
        "venice/int4",
        "moonshotai/int4",
        "fireworks",
        "siliconflow/fp8",
        "deepinfra/fp4",
        "atlas-cloud/int4",
      ],
      ignore: ["phala"],
      allow_fallbacks: true,
      require_parameters: true,
    });

    expect(getOpenRouterProviderRouting("deepseek/deepseek-vl")).toEqual({
      require_parameters: true,
    });

    expect(getOpenRouterFallbackProviderRouting("moonshotai/kimi-k2.6")).toEqual({
      order: [
        "moonshotai/int4",
        "fireworks",
        "siliconflow/fp8",
        "deepinfra/fp4",
        "atlas-cloud/int4",
      ],
      ignore: ["venice/int4", "phala"],
      allow_fallbacks: true,
      require_parameters: true,
    });
  });
});

describe("agent response validation", () => {
  it("rejects invalid JSON model content", () => {
    expect(() => parseAgentModelJson("not json")).toThrow(/valid JSON/);
  });

  it("accepts oversized page batch tool requests as bounded harness work", () => {
    const pageIds = Array.from({ length: AGENT_MAX_BATCH_READ_PAGES + 1 }, (_, index) => `page-${index + 1}`);
    const response = validateAgentChatResponse({
      message: "Need a broad read",
      requestedToolCalls: [
        {
          toolName: "readPages",
          input: { pageIds },
          reason: "Inspect the project",
        },
      ],
      pendingCommandPlan: null,
    });

    expect(response.requestedToolCalls).toEqual([
      {
        toolName: "readPages",
        input: { pageIds },
        reason: expect.stringContaining(`first ${AGENT_MAX_BATCH_READ_PAGES}`),
      },
    ]);
  });

  it("extracts OpenRouter assistant content from string or part-array messages", () => {
    expect(
      extractOpenRouterAssistantContent({
        choices: [{ message: { content: "{\"message\":\"ok\",\"pendingCommandPlan\":null}" } }],
      }),
    ).toBe("{\"message\":\"ok\",\"pendingCommandPlan\":null}");

    expect(
      extractOpenRouterAssistantContent({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "{\"message\":\"ok\"," },
                { type: "text", text: "\"pendingCommandPlan\":null}" },
              ],
            },
          },
        ],
      }),
    ).toBe("{\"message\":\"ok\",\n\"pendingCommandPlan\":null}");
  });

  it("reports actionable OpenRouter empty-content details", () => {
    expect(() =>
      extractOpenRouterAssistantContent({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{ id: "call_1" }],
            },
          },
        ],
      }),
    ).toThrow(/toolCallCount=1/);

    expect(() =>
      extractOpenRouterAssistantContent({
        choices: [
          {
            finish_reason: "content_filter",
            message: {
              content: "",
              refusal: "The provider refused the request.",
            },
          },
        ],
      }),
    ).toThrow(/finishReason=content_filter/);

    expect(describeOpenRouterResponse({ choices: [{ message: { content: null } }] })).toContain("contentType=object");
  });

  it("classifies empty length-truncated reasoning responses", () => {
    const response = {
      choices: [
        {
          finish_reason: "length",
          message: {
            role: "assistant",
            content: null,
            reasoning: "thinking ".repeat(100),
            reasoning_details: [],
          },
        },
      ],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 8192,
        total_tokens: 9392,
      },
    };

    expect(() => extractOpenRouterAssistantContent(response)).toThrow(OpenRouterEmptyAssistantContentError);
    expect(() => extractOpenRouterAssistantContent(response)).toThrow(/finishReason=length/);
    expect(getOpenRouterFinishReason(response)).toBe("length");
    expect(getOpenRouterReasoningLength(response)).toBe("thinking ".repeat(100).length);
  });

  it("reports actionable OpenRouter non-JSON response details", () => {
    expect(() =>
      parseOpenRouterResponseJson("<html>Gateway timeout</html>", {
        status: 200,
        contentType: "text/html",
      }),
    ).toThrow(/non-JSON response.*text\/html.*Gateway timeout/);
  });

  it("rejects unknown command ids", () => {
    expect(() =>
      validateAgentChatResponse({
        message: "Bad plan",
        pendingCommandPlan: {
          summary: "Bad",
          commands: [{ commandId: "missingCommand", payload: {} }],
        },
      }),
    ).toThrow(/unknown commandId/);
  });

  it("rejects payloads that fail the command Zod schema", () => {
    expect(() =>
      validateAgentChatResponse({
        message: "Bad payload",
        pendingCommandPlan: {
          summary: "Bad",
          commands: [{ commandId: "createPanel", payload: { pageId: "p1", width: 100 } }],
        },
      }),
    ).toThrow();
  });

  it("allows known harness tool requests and rejects unknown tools", () => {
    expect(
      validateAgentChatResponse({
        message: "Need render",
        requestedToolCalls: [
          { toolName: "searchProject", input: { query: "hero", limit: 5 }, reason: "Find relevant pages" },
          { toolName: "readPages", input: { pageIds: ["p1", "p2"] }, reason: "Read a sample" },
          { toolName: "listImageAssets", input: { pageId: "p1", limit: 10 }, reason: "Inspect page resources" },
          { toolName: "listDocuments", input: {}, reason: "Inspect durable docs" },
          { toolName: "readDocument", input: { documentId: "production-plan" }, reason: "Read docs" },
          { toolName: "searchDocuments", input: { query: "beat", role: "storyboardDesigner", limit: 3 }, reason: "Search docs" },
          { toolName: "renderPages", input: { pageIds: ["p1", "p2"], detail: "preview" }, reason: "Inspect several pages" },
          { toolName: "renderPanel", input: { pageId: "p1", panelId: "panel-1", detail: "preview" }, reason: "Inspect one panel" },
          {
            toolName: "renderPage",
            input: { pageId: "p1", detail: "detail", crop: { x: 0, y: 0, width: 120, height: 80 } },
            reason: "Inspect composed page",
          },
        ],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      { toolName: "searchProject", input: { query: "hero", limit: 5 }, reason: "Find relevant pages" },
      { toolName: "readPages", input: { pageIds: ["p1", "p2"] }, reason: "Read a sample" },
      { toolName: "listImageAssets", input: { pageId: "p1", limit: 10 }, reason: "Inspect page resources" },
      { toolName: "listDocuments", input: {}, reason: "Inspect durable docs" },
      { toolName: "readDocument", input: { documentId: "production-plan" }, reason: "Read docs" },
      { toolName: "searchDocuments", input: { query: "beat", role: "storyboardDesigner", limit: 3 }, reason: "Search docs" },
      { toolName: "renderPages", input: { pageIds: ["p1", "p2"], detail: "preview" }, reason: "Inspect several pages" },
      { toolName: "renderPanel", input: { pageId: "p1", panelId: "panel-1", detail: "preview" }, reason: "Inspect one panel" },
      {
        toolName: "renderPage",
        input: { pageId: "p1", detail: "detail", crop: { x: 0, y: 0, width: 120, height: 80 } },
        reason: "Inspect composed page",
      },
    ]);

    expect(() =>
      validateAgentChatResponse({
        message: "Bad tool",
        requestedToolCalls: [{ toolName: "readFile", input: { path: "secret" } }],
        pendingCommandPlan: null,
      }),
    ).toThrow(/unknown tool/);

    expect(() =>
      validateAgentChatResponse({
        message: "Bad render detail",
        requestedToolCalls: [{ toolName: "renderPage", input: { pageId: "p1", detail: "high" } }],
        pendingCommandPlan: null,
      }),
    ).toThrow(/requestedToolCalls\[0\] renderPage: detail/);

    expect(
      validateAgentChatResponse({
        message: "Custom document role tag",
        requestedToolCalls: [
          {
            toolName: "writeDocument",
            input: { operationId: "op-doc", id: "doc", title: "Doc", role: "customRole", content: "" },
          },
        ],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      {
        toolName: "writeDocument",
        input: { operationId: "op-doc", id: "doc", title: "Doc", role: "customRole", content: "" },
        reason: undefined,
      },
    ]);

    expect(() =>
      validateAgentChatResponse({
        message: "Bad document write",
        requestedToolCalls: [{ toolName: "writeDocument", input: { id: "doc", title: "Doc", content: "" } }],
        pendingCommandPlan: null,
      }),
    ).toThrow(/operationId/);
  });

  it("preserves request trace metadata from the Agent backend", () => {
    const response = validateAgentChatResponse({
      message: "ok",
      pendingCommandPlan: null,
      requestTrace: {
        requestId: "agent-request-test",
        stage: "initial-model-response",
        status: "success",
        provider: "test",
        model: "mangamaker-test-agent",
        usedVision: false,
        startedAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.010Z",
        durationMs: 10,
        events: [
          {
            phase: "server_received",
            at: "2026-05-07T00:00:00.001Z",
            elapsedMs: 1,
            detail: { messageCount: 1 },
          },
        ],
      },
    });

    expect(response.requestTrace).toMatchObject({
      requestId: "agent-request-test",
      status: "success",
      provider: "test",
      events: [{ phase: "server_received" }],
    });
  });

  it("does not trust model-provided dangerLevel", () => {
    const response = validateAgentChatResponse({
      message: "Delete",
      pendingCommandPlan: {
        summary: "Delete",
        commands: [{ commandId: "removePage", payload: { pageId: "p1" }, dangerLevel: "safe" }],
      },
    });

    expect(response.pendingCommandPlan?.commands[0].dangerLevel).toBe("destructive");
    expect(getCommandDangerLevel("removePage")).toBe("destructive");
  });
});

describe("agent command plan policy", () => {
  it("requires confirmation for destructive, multi-mutating, and cross-page plans", () => {
    expect(commandPlanRequiresConfirmation([{ commandId: "removePage", payload: { pageId: "p1" } }])).toBe(true);
    expect(
      commandPlanRequiresConfirmation([
        { commandId: "createPanel", payload: { pageId: "p1", x: 0, y: 0, width: 10, height: 10 } },
        { commandId: "createText", payload: { pageId: "p1", x: 0, y: 0, content: "A" } },
      ]),
    ).toBe(true);
    expect(
      commandPlanRequiresConfirmation([
        { commandId: "selectPage", payload: { pageId: "p1" } },
        { commandId: "selectObject", payload: { pageId: "p2", objectType: "text", objectId: "t1" } },
      ]),
    ).toBe(true);
  });

  it("does not count saveProject as a second content mutation", () => {
    expect(getCommandManifestEntry("saveProject")?.mutatesProject).toBe(false);
    expect(
      commandPlanRequiresConfirmation([
        { commandId: "createBubble", payload: { pageId: "p1", x: 0, y: 0, width: 100, height: 80 } },
        { commandId: "saveProject", payload: {} },
      ]),
    ).toBe(false);
  });

  it("groups multiple history-recording Agent commands into one undo step", async () => {
    const store = useEditorStore.getState();
    store.resetProject();
    await useEditorStore.getState().executeCommand("createProject", { title: "Agent Undo" });
    const page = (await useEditorStore.getState().executeCommand("addPage", {})) as { id: string };

    const plan = previewCommandPlan({
      summary: "Create two panels",
      commands: [
        { commandId: "createPanel", payload: { pageId: page.id, x: 10, y: 10, width: 100, height: 100 } },
        { commandId: "createPanel", payload: { pageId: page.id, x: 130, y: 10, width: 100, height: 100 } },
      ],
    });

    expect(plan.requiresConfirmation).toBe(true);
    await executeCommandPlan(plan, { approved: true });
    expect(useEditorStore.getState().project.pages[0].panels).toHaveLength(2);

    await useEditorStore.getState().executeCommand("undo", {});
    expect(useEditorStore.getState().project.pages[0].panels).toHaveLength(0);
  });

  it("returns a redacted project diff for Agent command plans", async () => {
    useEditorStore.getState().resetProject();
    await useEditorStore.getState().executeCommand("createProject", { title: "Agent Diff" });
    const page = (await useEditorStore.getState().executeCommand("addPage", {})) as { id: string };

    const createResult = await executeCommandPlan(
      previewCommandPlan({
        summary: "Create secret text",
        commands: [
          {
            commandId: "createText",
            payload: { pageId: page.id, x: 10, y: 20, content: "Secret line that must not leak" },
          },
        ],
      }),
      { approved: true },
    );

    expect(createResult.executionDiff).toMatchObject({
      changed: true,
      redacted: true,
      changedPageIds: [page.id],
    });
    expect(createResult.executionDiff.affected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageId: page.id,
          objectType: "text",
          changeType: "created",
          changedFields: expect.arrayContaining(["content"]),
        }),
      ]),
    );
    expect(JSON.stringify(createResult.executionDiff)).not.toContain("Secret line");
  });

  it("reports no project-state changes when commands only touch timestamps or save", async () => {
    useEditorStore.getState().resetProject();
    await useEditorStore.getState().executeCommand("createProject", { title: "Agent No Change" });
    const page = (await useEditorStore.getState().executeCommand("addPage", {})) as { id: string };
    const text = (await useEditorStore.getState().executeCommand("createText", {
      pageId: page.id,
      x: 10,
      y: 20,
      content: "Same",
    })) as { id: string };

    const result = await executeCommandPlan(
      previewCommandPlan({
        summary: "No-op text update",
        commands: [
          {
            commandId: "updateText",
            payload: { pageId: page.id, textId: text.id, content: "Same" },
          },
        ],
      }),
      { approved: true },
    );

    expect(result.executionDiff).toMatchObject({
      changed: false,
      redacted: true,
      summary: "计划执行了但项目状态没有变化。",
      affected: [],
    });
  });
});
