import { describe, expect, it } from "vitest";
import { getAgentConfigFromEnv } from "../../src/agent/config";
import {
  DEEPSEEK_V4_PRO_MODEL_ID,
  QWEN_3_6_FLASH_MODEL_ID,
  filterAllowedAgentModels,
} from "../../src/agent/modelCatalog";
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
import {
  applyAppendDocumentEdit,
  applyEditDocumentLinesEdit,
  applyReplaceDocumentSectionEdit,
  applyReplaceDocumentTextEdit,
  createDocumentLinesResult,
} from "../../src/agent/documentEditTools";
import { executeCommandPlan, previewCommandPlan } from "../../src/agent/tools";
import { useEditorStore } from "../../src/state/editorStore";

const testDocument = {
  id: "story",
  title: "Story",
  status: "draft" as const,
  path: "docs/story.md",
  relatedPageIds: [],
  updatedAt: "2026-01-01T00:00:00.000Z",
  content: "# Story\n\n## Page 1\n\nOld beat.\n\n## Notes\n\nExisting note.\n",
};

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
        capability: "multimodal" as const,
      },
      {
        id: DEEPSEEK_V4_PRO_MODEL_ID,
        name: "DeepSeek V4 Pro",
        contextLength: 1048576,
        inputModalities: ["text"],
        outputModalities: ["text"],
        capability: "metadoc" as const,
      },
      {
        id: QWEN_3_6_FLASH_MODEL_ID,
        name: "Qwen 3.6 Flash",
        contextLength: 1000000,
        inputModalities: ["text", "image", "video"],
        outputModalities: ["text"],
        capability: "multimodal" as const,
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
      modelCapability: "multimodal",
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
          MANGAMAKER_AGENT_MODEL: DEEPSEEK_V4_PRO_MODEL_ID,
        },
        availableModels,
      ),
    ).toMatchObject({
      enabled: true,
      provider: "openrouter",
      model: DEEPSEEK_V4_PRO_MODEL_ID,
      modelCapability: "metadoc",
      apiKeyConfigured: true,
      visionEnabled: false,
      contextWindowTokens: 1048576,
      contextWindowMaxTokens: 1048576,
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

    expect(
      getAgentConfigFromEnv(
        {
          OPENROUTER_API_KEY: "not-a-real-key",
        },
        availableModels,
        QWEN_3_6_FLASH_MODEL_ID,
      ),
    ).toMatchObject({
      enabled: true,
      provider: "openrouter",
      model: QWEN_3_6_FLASH_MODEL_ID,
      modelCapability: "multimodal",
      visionEnabled: true,
      contextWindowTokens: 1000000,
      contextWindowMaxTokens: 1000000,
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
        capability: "multimodal" as const,
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
        capability: "multimodal" as const,
      },
      {
        id: DEEPSEEK_V4_PRO_MODEL_ID,
        name: "DeepSeek V4 Pro",
        contextLength: 1048576,
        inputModalities: ["text"],
        outputModalities: ["text"],
        capability: "metadoc" as const,
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

  it("filters available models to multimodal models plus DeepSeek V4 Pro metadoc-only mode", () => {
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
        id: "deepseek/deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: ["response_format"],
        context_length: 1048576,
      },
      {
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: ["response_format"],
      },
      {
        id: QWEN_3_6_FLASH_MODEL_ID,
        name: "Qwen 3.6 Flash",
        architecture: { input_modalities: ["text", "image", "video"], output_modalities: ["text"] },
        supported_parameters: ["response_format"],
        context_length: 1000000,
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
      DEEPSEEK_V4_PRO_MODEL_ID,
      "deepseek/deepseek-vl",
      "moonshotai/kimi-k2.6",
      QWEN_3_6_FLASH_MODEL_ID,
    ]);
    expect(models.find((model) => model.id === DEEPSEEK_V4_PRO_MODEL_ID)).toMatchObject({
      capability: "metadoc",
      inputModalities: ["text"],
    });
    expect(models.find((model) => model.id === "deepseek/deepseek-vl")).toMatchObject({
      capability: "multimodal",
    });
    expect(models.find((model) => model.id === QWEN_3_6_FLASH_MODEL_ID)).toMatchObject({
      capability: "multimodal",
      inputModalities: ["text", "image", "video"],
    });
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
    expect(response.taskProgress).toMatchObject({
      phase: "gathering_context",
      status: "needs_tool",
      stopCondition: expect.stringContaining("Stop"),
    });
  });

  it("preserves explicit model task progress", () => {
    const response = validateAgentChatResponse({
      message: "I will edit the metadoc.",
      requestedToolCalls: [
        {
          toolName: "editDocumentLines",
          input: {
            operationId: "edit-lines-progress",
            documentId: "story",
            operations: [{ type: "delete", startLine: 4, endLine: 5 }],
          },
          reason: "Remove obsolete lines.",
        },
      ],
      pendingCommandPlan: null,
      taskProgress: {
        objective: "Clean the story metadoc.",
        phase: "editing_document",
        status: "needs_tool",
        steps: [
          { id: "read", title: "Identify obsolete lines", status: "completed" },
          { id: "edit", title: "Delete obsolete lines", status: "in_progress", stopCondition: "editDocumentLines verifies saved=true" },
        ],
        currentStepId: "edit",
        stopCondition: "Stop after editDocumentLines verifies saved=true.",
        nextAction: "Call editDocumentLines.",
        percent: 70,
      },
    });

    expect(response.taskProgress).toMatchObject({
      objective: "Clean the story metadoc.",
      phase: "editing_document",
      status: "needs_tool",
      currentStepId: "edit",
      percent: 70,
    });
  });

  it("does not treat an explicitly incomplete no-action response as a completed fallback", () => {
    const response = validateAgentChatResponse({
      message: "I still need to read the target document before I can finish.",
      requestedToolCalls: [],
      pendingCommandPlan: null,
      taskProgress: {
        objective: "Update the working document.",
        phase: "gathering_context",
        status: "needs_tool",
        steps: [
          { id: "read", title: "Read the target document", status: "in_progress" },
        ],
        currentStepId: "read",
        stopCondition: "Stop after the document is updated and verified.",
        nextAction: "Request readDocument.",
        percent: 20,
      },
    });

    expect(response.taskProgress).toMatchObject({
      phase: "gathering_context",
      status: "needs_tool",
      currentStepId: "read",
      nextAction: "Request readDocument.",
    });
  });

  it("preserves waiting-for-user responses with object-shaped steps", () => {
    const response = validateAgentChatResponse({
      message: "已收到约束。请提供需要修改的文本内容。",
      requestedToolCalls: [],
      pendingCommandPlan: null,
      taskProgress: {
        objective: "根据创作者要求调整文本。",
        phase: "waiting_for_user",
        status: "waiting_for_user",
        steps: {
          "step-1": {
            description: "接收创作者的约束条件",
            status: "completed",
          },
          "step-2": {
            description: "等待创作者提供具体文本",
            status: "pending",
          },
        },
        currentStepId: "step-2",
        stopCondition: "创作者提供需要修改的文本内容",
        nextAction: "等待创作者提供具体文本",
        percent: 10,
      },
    });

    expect(response.requestedToolCalls).toEqual([]);
    expect(response.taskProgress).toMatchObject({
      phase: "reporting",
      status: "waiting_for_user",
      currentStepId: "step-2",
      steps: [
        { id: "step-1", title: "接收创作者的约束条件", status: "completed" },
        { id: "step-2", title: "等待创作者提供具体文本", status: "pending" },
      ],
      nextAction: "等待创作者提供具体文本",
    });
  });

  it("uses a neutral completed fallback for true final answers without tool calls", () => {
    const response = validateAgentChatResponse({
      message: "Done.",
      requestedToolCalls: [],
      pendingCommandPlan: null,
    });

    expect(response.taskProgress).toMatchObject({
      phase: "complete",
      status: "completed",
      stopReason: "The Agent returned a final answer and did not request additional tools.",
    });
    expect(response.taskProgress?.stopReason).not.toContain("no requestedToolCalls");
  });

  it("normalizes loose model task progress instead of failing the response", () => {
    const response = validateAgentChatResponse({
      message: "I need to inspect the project.",
      requestedToolCalls: [
        {
          toolName: "readPages",
          input: { pageIds: ["page-1"] },
          reason: "Inspect relevant page.",
        },
      ],
      pendingCommandPlan: null,
      taskProgress: {
        objective: "Inspect page state.",
        phase: "inspection",
        status: "inProgress",
        steps: [
          "Read project context",
          "Inspect requested page",
          "Decide whether a document edit is needed",
        ],
        currentStep: "step-1",
        stop_condition: "Stop when enough evidence is available.",
        progress: "25%",
      },
    });

    expect(response.taskProgress).toMatchObject({
      objective: "Inspect page state.",
      phase: "gathering_context",
      status: "running",
      currentStepId: "step-1",
      stopCondition: "Stop when enough evidence is available.",
      percent: 25,
      steps: [
        { id: "step-1", title: "Read project context", status: "in_progress" },
        { id: "step-2", title: "Inspect requested page", status: "pending" },
        { id: "step-3", title: "Decide whether a document edit is needed", status: "pending" },
      ],
    });
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

  it("ignores model command plans because page edits are disabled for the built-in Agent", () => {
    const unknownCommand = validateAgentChatResponse({
      message: "Bad plan",
      pendingCommandPlan: {
        summary: "Bad",
        commands: [{ commandId: "missingCommand", payload: {} }],
      },
    });
    const invalidPayload = validateAgentChatResponse({
      message: "Bad payload",
      pendingCommandPlan: {
        summary: "Bad",
        commands: [{ commandId: "createPanel", payload: { pageId: "p1", width: 100 } }],
      },
    });
    const malformedPlan = validateAgentChatResponse({
      message: "Malformed page plan",
      pendingCommandPlan: { commands: "not an array" },
    });

    expect(unknownCommand.pendingCommandPlan).toBeNull();
    expect(unknownCommand.warning).toContain("page/canvas edits are disabled");
    expect(invalidPayload.pendingCommandPlan).toBeNull();
    expect(invalidPayload.warning).toContain("page/canvas edits are disabled");
    expect(malformedPlan.pendingCommandPlan).toBeNull();
    expect(malformedPlan.warning).toContain("page/canvas edits are disabled");
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
          { toolName: "readDocumentLines", input: { documentId: "production-plan", startLine: 10, endLine: 20 }, reason: "Read line numbers" },
          { toolName: "searchDocuments", input: { query: "beat", role: "storyboardDesigner", limit: 3 }, reason: "Search docs" },
          { toolName: "appendDocument", input: { operationId: "append-1", documentId: "production-plan", content: "Note" }, reason: "Append docs" },
          { toolName: "deleteDocument", input: { operationId: "delete-1", documentId: "production-plan" }, reason: "Delete docs" },
          { toolName: "replaceDocumentSection", input: { operationId: "section-1", documentId: "production-plan", heading: "Notes", content: "Body" }, reason: "Replace section" },
          { toolName: "replaceDocumentText", input: { operationId: "text-1", documentId: "production-plan", oldText: "old", newText: "new" }, reason: "Replace text" },
          { toolName: "editDocumentLines", input: { operationId: "edit-lines-1", documentId: "production-plan", operations: [{ type: "delete", startLine: 10, endLine: 20 }] }, reason: "Delete line range" },
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
      { toolName: "readDocumentLines", input: { documentId: "production-plan", startLine: 10, endLine: 20 }, reason: "Read line numbers" },
      { toolName: "searchDocuments", input: { query: "beat", role: "storyboardDesigner", limit: 3 }, reason: "Search docs" },
      { toolName: "appendDocument", input: { operationId: "append-1", documentId: "production-plan", content: "Note" }, reason: "Append docs" },
      { toolName: "deleteDocument", input: { operationId: "delete-1", documentId: "production-plan" }, reason: "Delete docs" },
      { toolName: "replaceDocumentSection", input: { operationId: "section-1", documentId: "production-plan", heading: "Notes", content: "Body" }, reason: "Replace section" },
      { toolName: "replaceDocumentText", input: { operationId: "text-1", documentId: "production-plan", oldText: "old", newText: "new" }, reason: "Replace text" },
      { toolName: "editDocumentLines", input: { operationId: "edit-lines-1", documentId: "production-plan", operations: [{ type: "delete", startLine: 10, endLine: 20 }] }, reason: "Delete line range" },
      { toolName: "renderPages", input: { pageIds: ["p1", "p2"], detail: "preview" }, reason: "Inspect several pages" },
      { toolName: "renderPanel", input: { pageId: "p1", panelId: "panel-1", detail: "preview" }, reason: "Inspect one panel" },
      {
        toolName: "renderPage",
        input: { pageId: "p1", detail: "detail", crop: { x: 0, y: 0, width: 120, height: 80 } },
        reason: "Inspect composed page",
      },
    ]);

    expect(
      validateAgentChatResponse({
        message: "Bad tool",
        requestedToolCalls: [{ toolName: "readFile", input: { path: "secret" } }],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      expect.objectContaining({
        toolName: "toolInputError",
        input: expect.objectContaining({
          attemptedToolName: "readFile",
          error: expect.stringContaining("unknown tool"),
        }),
      }),
    ]);

    expect(
      validateAgentChatResponse({
        message: "Bad render detail",
        requestedToolCalls: [{ toolName: "renderPage", input: { pageId: "p1", detail: "high" } }],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      expect.objectContaining({
        toolName: "toolInputError",
        input: expect.objectContaining({
          attemptedToolName: "renderPage",
          error: expect.stringContaining("detail"),
        }),
      }),
    ]);

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

    expect(
      validateAgentChatResponse({
        message: "Bad document write",
        requestedToolCalls: [{ toolName: "writeDocument", input: { id: "doc", title: "Doc", content: "" } }],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      expect.objectContaining({
        toolName: "toolInputError",
        input: expect.objectContaining({
          attemptedToolName: "writeDocument",
          error: expect.stringContaining("operationId"),
        }),
      }),
    ]);
  });

  it("reports misplaced requested tool reason as a model-visible tool input error", () => {
    expect(
      validateAgentChatResponse({
        message: "Replace section",
        requestedToolCalls: [
          {
            toolName: "replaceDocumentSection",
            input: {
              operationId: "section-reason-1",
              documentId: "production-plan",
              heading: "Notes",
              content: "Body",
              reason: "The model put this in the wrong place.",
            },
          },
        ],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      expect.objectContaining({
        toolName: "toolInputError",
        input: expect.objectContaining({
          attemptedToolName: "replaceDocumentSection",
          error: expect.stringContaining("reason"),
          guidance: expect.stringContaining("requestedToolCalls[].reason"),
        }),
        reason: "Repair invalid replaceDocumentSection tool input.",
      }),
    ]);
  });

  it("reports malformed requestedToolCalls entries as model-visible repair tool results", () => {
    expect(
      validateAgentChatResponse({
        message: "Need tools",
        requestedToolCalls: [
          { toolName: "readDocument", input: { documentId: "production-plan" }, reason: "Read first" },
          "then update the document",
        ],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      expect.objectContaining({
        toolName: "toolInputError",
        input: expect.objectContaining({
          requestedToolCallIndex: 1,
          attemptedToolName: "unknown",
          attemptedToolCallPreview: expect.stringContaining("then update the document"),
          error: expect.stringContaining("requestedToolCalls[1] must be an object"),
          guidance: expect.stringContaining("Do not put prose strings inside requestedToolCalls"),
        }),
        reason: "Repair malformed requestedToolCalls entry.",
      }),
    ]);

    expect(
      validateAgentChatResponse({
        message: "Need tools",
        requestedToolCalls: "readDocument",
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      expect.objectContaining({
        toolName: "toolInputError",
        input: expect.objectContaining({
          requestedToolCallIndex: 0,
          error: expect.stringContaining("requestedToolCalls must be an array"),
        }),
      }),
    ]);
  });

  it("reports malformed top-level Agent responses as model-visible schema repair tool results", () => {
    expect(
      validateAgentChatResponse({
        requestedToolCalls: [],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      expect.objectContaining({
        toolName: "toolInputError",
        input: expect.objectContaining({
          attemptedToolName: "agentResponse",
          error: expect.stringContaining("message must be a string"),
          guidance: expect.stringContaining("Do not omit message"),
        }),
        reason: "Repair malformed Agent response JSON.",
      }),
    ]);

    const stringResponse = validateAgentChatResponse("not an object");
    expect(stringResponse).toMatchObject({
      message: expect.stringContaining("malformed Agent response"),
      pendingCommandPlan: null,
      warning: expect.stringContaining("response must be a JSON object"),
      requestedToolCalls: [
        expect.objectContaining({
          toolName: "toolInputError",
          input: expect.objectContaining({
            attemptedToolName: "agentResponse",
            error: expect.stringContaining("must be a JSON object"),
          }),
        }),
      ],
    });
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

  it("does not expose model-provided dangerLevel through chat responses", () => {
    const response = validateAgentChatResponse({
      message: "Delete",
      pendingCommandPlan: {
        summary: "Delete",
        commands: [{ commandId: "removePage", payload: { pageId: "p1" }, dangerLevel: "safe" }],
      },
    });

    expect(response.pendingCommandPlan).toBeNull();
    expect(response.warning).toContain("page/canvas edits are disabled");
    expect(getCommandDangerLevel("removePage")).toBe("destructive");
  });
});

describe("agent incremental document edits", () => {
  it("appends Markdown under an existing heading without requiring a full document rewrite", () => {
    const result = applyAppendDocumentEdit(testDocument, {
      operationId: "append-note",
      documentId: "story",
      heading: "Notes",
      content: "New note.",
    });

    expect(result.writePayload.content).toContain("## Notes\n\nExisting note.\n\nNew note.");
    expect(result.edit.changed).toBe(true);
    expect(result.edit.heading).toBe("Notes");
  });

  it("does not append the same Markdown block twice even with a fresh operation id", () => {
    const first = applyAppendDocumentEdit(testDocument, {
      operationId: "append-note-1",
      documentId: "story",
      heading: "Notes",
      content: "New note.",
    });
    const second = applyAppendDocumentEdit(
      { ...testDocument, content: first.writePayload.content },
      {
        operationId: "append-note-2",
        documentId: "story",
        heading: "Notes",
        content: "New note.",
      },
    );

    expect(second.edit.changed).toBe(false);
    expect(second.edit.duplicateAppend).toBe(true);
    expect(second.writePayload.content.match(/New note\./g)).toHaveLength(1);
  });

  it("treats appended Markdown sections as section upserts instead of repeated appends", () => {
    const first = applyAppendDocumentEdit(testDocument, {
      operationId: "append-section-1",
      documentId: "story",
      content: "## Page 1\n\nReplacement beat.",
    });
    const second = applyAppendDocumentEdit(
      { ...testDocument, content: first.writePayload.content },
      {
        operationId: "append-section-2",
        documentId: "story",
        content: "## Page 1\n\nReplacement beat.",
      },
    );

    expect(first.edit.type).toBe("replaceSection");
    expect(first.writePayload.content).toContain("## Page 1\n\nReplacement beat.");
    expect(first.writePayload.content.match(/## Page 1/g)).toHaveLength(1);
    expect(second.edit.changed).toBe(false);
    expect(second.edit.alreadyApplied).toBe(true);
    expect(second.writePayload.content.match(/## Page 1/g)).toHaveLength(1);
  });

  it("refuses appendDocument content that contains a different Markdown heading", () => {
    const result = applyAppendDocumentEdit(testDocument, {
      operationId: "unsafe-heading-append",
      documentId: "story",
      heading: "Notes",
      content: "## Page 2\n\nThis is a section replacement, not an append.",
    });

    expect(result.edit.changed).toBe(false);
    expect(result.edit.unsafeAppend).toBe(true);
    expect(result.edit.alreadyApplied).toBeUndefined();
    expect(result.writePayload.content).not.toContain("This is a section replacement");
  });

  it("replaces a heading section and preserves surrounding sections", () => {
    const result = applyReplaceDocumentSectionEdit(testDocument, {
      operationId: "replace-page-1",
      documentId: "story",
      heading: "Page 1",
      content: "New beat.",
    });

    expect(result.writePayload.content).toContain("## Page 1\n\nNew beat.");
    expect(result.writePayload.content).toContain("## Notes\n\nExisting note.");
    expect(result.edit.changed).toBe(true);
  });

  it("accepts Markdown heading markers in replaceDocumentSection heading input", () => {
    const result = applyReplaceDocumentSectionEdit(testDocument, {
      operationId: "replace-page-1-marked-heading",
      documentId: "story",
      heading: "## Page 1",
      content: "New beat.",
      headingLevel: 2,
      createIfMissing: true,
    });

    expect(result.writePayload.content).toContain("## Page 1\n\nNew beat.");
    expect(result.writePayload.content.match(/## ## Page 1/g)).toBeNull();
    expect(result.edit.createdSection).toBeUndefined();
    expect(result.edit.changed).toBe(true);
  });

  it("reads document content with stable line numbers for range edits", () => {
    const result = createDocumentLinesResult(testDocument, {
      documentId: "story",
      startLine: 3,
      endLine: 5,
    });

    expect(result.lineCount).toBe(9);
    expect(result.lines).toEqual([
      { line: 3, text: "## Page 1" },
      { line: 4, text: "" },
      { line: 5, text: "Old beat." },
    ]);
  });

  it("deletes arbitrary Markdown line ranges", () => {
    const result = applyEditDocumentLinesEdit(testDocument, {
      operationId: "delete-lines",
      documentId: "story",
      operations: [{ type: "delete", startLine: 9, endLine: 9 }],
    });

    expect(result.writePayload.content).toContain("## Notes\n");
    expect(result.writePayload.content).not.toContain("Existing note.");
    expect(result.edit).toMatchObject({
      type: "editLines",
      changed: true,
      operationsApplied: 1,
      lineCountBefore: 9,
      lineCountAfter: 8,
    });
  });

  it("replaces and inserts arbitrary Markdown line ranges against original line numbers", () => {
    const result = applyEditDocumentLinesEdit(testDocument, {
      operationId: "edit-lines",
      documentId: "story",
      operations: [
        { type: "replace", startLine: 5, endLine: 5, content: "Sharper beat." },
        { type: "insertAfter", line: 9, content: "New note." },
      ],
    });

    expect(result.writePayload.content).toContain("## Page 1\n\nSharper beat.");
    expect(result.writePayload.content).toContain("Existing note.\nNew note.");
    expect(result.edit.operationsApplied).toBe(2);
  });

  it("replaces exact text spans for focused document edits", () => {
    const result = applyReplaceDocumentTextEdit(testDocument, {
      operationId: "replace-text",
      documentId: "story",
      oldText: "Old beat.",
      newText: "Sharper beat.",
    });

    expect(result.writePayload.content).toContain("Sharper beat.");
    expect(result.writePayload.content).not.toContain("Old beat.");
    expect(result.edit.replacements).toBe(1);
  });

  it("reports missing exact text replacements as unverified no-op edits", () => {
    const result = applyReplaceDocumentTextEdit(testDocument, {
      operationId: "replace-missing-text",
      documentId: "story",
      oldText: "missing text",
      newText: "new text",
    });

    expect(result.edit.changed).toBe(false);
    expect(result.edit.notFound).toBe(true);
    expect(result.edit.alreadyApplied).toBeUndefined();
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
