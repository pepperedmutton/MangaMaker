import { describe, expect, it } from "vitest";
import { getAgentConfigFromEnv } from "../../src/agent/config";
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

  it("requires and reports an explicitly configured model", () => {
    expect(
      getAgentConfigFromEnv({
        OPENROUTER_API_KEY: "not-a-real-key",
        MANGAMAKER_AGENT_MODEL: "openai/gpt-4o",
      }),
    ).toMatchObject({
      enabled: true,
      provider: "openrouter",
      model: "openai/gpt-4o",
      apiKeyConfigured: true,
      visionEnabled: true,
    });

    expect(getAgentConfigFromEnv({ OPENROUTER_API_KEY: "not-a-real-key" })).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("MANGAMAKER_AGENT_MODEL"),
    });
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
