import { describe, expect, it } from "vitest";
import { compileAgentCurrentTaskPacket } from "../../src/agent/contextCompiler";
import { createAgentHarnessToolResult } from "../../src/agent/harness";

describe("agent context compiler", () => {
  it("promotes the latest creator instruction over old conversation", () => {
    const packet = compileAgentCurrentTaskPacket({
      messages: [
        { role: "user", content: "Old task: rewrite chapter 1." },
        { role: "assistant", content: "I will work on chapter 1." },
        { role: "user", content: "New task: only edit the prompt rules document." },
      ],
      activeDocumentId: "prompt-rules",
    });

    expect(packet.latestCreatorInstruction).toBe("New task: only edit the prompt rules document.");
    expect(packet.objective).toContain("New task");
    expect(packet.recentConversationReference.map((entry) => entry.content)).toContain(
      "Old task: rewrite chapter 1.",
    );
    expect(packet.conversationPolicy).toMatchObject({
      latestCreatorInstructionWins: true,
      olderMessagesAreReferenceOnly: true,
    });
  });

  it("excludes harness diagnostics from creator intent and adds pinned task instructions", () => {
    const packet = compileAgentCurrentTaskPacket({
      messages: [
        { role: "user", content: "Please update the working document." },
        {
          role: "user",
          content:
            "MangaMaker internal harness notice: your previous requested tool calls were exact duplicates.",
        },
      ],
      currentTaskPin: "Always preserve section headings.",
    });

    expect(packet.latestCreatorInstruction).toBe("Please update the working document.");
    expect(packet.pinnedTaskInstructions).toBe("Always preserve section headings.");
    expect(packet.recentConversationReference).toHaveLength(0);
  });

  it("indexes completed tool results without embedding full document content", () => {
    const packet = compileAgentCurrentTaskPacket({
      messages: [{ role: "user", content: "Summarize the current document." }],
      harness: {
        mode: "tool-harness",
        currentPageId: null,
        projectId: "project",
        currentPageMarkedBy: "isCurrent",
        tools: [],
        initialToolResults: [],
        dynamicToolResults: [
          createAgentHarnessToolResult("readDocument", { documentId: "doc" }, {
            document: {
              id: "doc",
              content: "x".repeat(5000),
            },
            contentLength: 5000,
          }),
        ],
        taskProtocol: {
          requiredResponseField: "taskProgress",
          planningRequired: true,
          maxSteps: 12,
          stopRule: "",
          progressRule: "",
          actionRule: "",
          completionRule: "",
        },
        resourcePolicy: {
          modelCapability: "metadoc",
          metadocOnly: true,
          allPagesReadable: false,
          assetsReadableOnDemand: false,
          documentsReadableOnDemand: true,
          documentsWritableOnDemand: true,
          inlineDataUrlsRedactedFromPrompt: true,
          projectMutationPath: "documentOnly",
        },
      },
    });

    expect(packet.completedToolResultIndex).toEqual([
      expect.objectContaining({
        toolName: "readDocument",
        inputSummary: "documentId=doc",
        resultKeys: ["document", "contentLength"],
      }),
    ]);
    expect(JSON.stringify(packet)).not.toContain("xxxxx");
  });
});
