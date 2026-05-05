import { describe, expect, it } from "vitest";
import { getAgentConfigFromEnv } from "../../src/agent/config";
import { filterAllowedAgentModels } from "../../src/agent/modelCatalog";
import {
  commandPlanRequiresConfirmation,
  getCommandDangerLevel,
} from "../../src/agent/commandManifest";
import { parseAgentModelJson, validateAgentChatResponse } from "../../src/agent/agentResponseSchema";
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
        contextLength: 262142,
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

  it("filters available models to DeepSeek or Kimi multimodal JSON-capable models", () => {
    const models = filterAllowedAgentModels([
      {
        id: "moonshotai/kimi-k2.6",
        name: "MoonshotAI: Kimi K2.6",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        supported_parameters: ["response_format"],
        context_length: 262142,
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
});

describe("agent response validation", () => {
  it("rejects invalid JSON model content", () => {
    expect(() => parseAgentModelJson("not json")).toThrow(/valid JSON/);
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
          { toolName: "renderPage", input: { pageId: "p1" }, reason: "Inspect composed page" },
        ],
        pendingCommandPlan: null,
      }).requestedToolCalls,
    ).toEqual([
      { toolName: "renderPage", input: { pageId: "p1" }, reason: "Inspect composed page" },
    ]);

    expect(() =>
      validateAgentChatResponse({
        message: "Bad tool",
        requestedToolCalls: [{ toolName: "readFile", input: { path: "secret" } }],
        pendingCommandPlan: null,
      }),
    ).toThrow(/unknown tool/);
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
});
