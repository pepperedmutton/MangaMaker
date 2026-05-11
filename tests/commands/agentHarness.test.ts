import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentHarness, executeAgentHarnessToolCall } from "../../src/agent/harness";
import {
  createAgentConversationFingerprint,
  isAgentHarnessDiagnosticContent,
  isAgentMutationCompletionClaim,
  sanitizeAgentConversationMessages,
} from "../../src/agent/conversationSanitizer";
import { migrateAgentSystemPrompt } from "../../src/agent/systemPrompt";
import { AGENT_MAX_BATCH_READ_PAGES } from "../../src/agent/toolLimits";
import {
  collectCompletedAgentToolCallKeys,
  createCachedAgentToolResult,
  createCompletedAgentToolCallIndex,
  createAgentToolCallKey,
  createDuplicateToolCallSkippedResult,
  findReusableAgentToolResult,
  mergeAgentToolResults,
  selectAgentDynamicToolResultsForPrompt,
} from "../../src/agent/toolCallPolicy";
import type { AgentCanvasSnapshot, AgentContextSnapshot, AgentPageContextSummary } from "../../src/agent/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const snapshot: AgentCanvasSnapshot = {
  scope: "canvas",
  dataUrl: "data:image/png;base64,AAAA",
  width: 100,
  height: 100,
  mimeType: "image/png",
  byteLength: 4,
  capturedAt: "2026-01-01T00:00:00.000Z",
  source: "page-render",
};

const page = (
  id: string,
  isCurrent: boolean,
  objects: AgentPageContextSummary["objects"],
): AgentPageContextSummary => ({
  id,
  name: id,
  width: 800,
  height: 1200,
  background: "#ffffff",
  panelCount: objects.filter((object) => object.objectType === "panel").length,
  textCount: objects.filter((object) => object.objectType === "text").length,
  bubbleCount: objects.filter((object) => object.objectType === "bubble").length,
  layerCount: objects.length,
  isCurrent,
  viewing: isCurrent,
  selectedObject: null,
  objects,
});

const context: AgentContextSnapshot = {
  project: {
    id: "project-1",
    title: "Harness",
    type: "manga",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pageCount: 2,
  },
  selectedPageId: "page-2",
  currentPage: null,
  pages: [
    page("page-1", false, [
      {
        id: "text-1",
        objectType: "text",
        objectRef: "page-1:text:text-1",
        pageId: "page-1",
        pageName: "page-1",
        x: 10,
        y: 20,
        width: 100,
        height: 40,
        layerRef: "text:text-1",
        content: "Earlier page",
      },
    ]),
    page("page-2", true, [
      {
        id: "panel-1",
        objectType: "panel",
        objectRef: "page-2:panel:panel-1",
        pageId: "page-2",
        pageName: "page-2",
        panelRef: "page-2:panel-1",
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        layerRef: "panel:panel-1",
        hasImage: true,
      },
    ]),
  ],
  selection: null,
  multiSelection: [],
  activeTool: "select",
  zoom: 1,
  saveStatus: { target: null, lastSavedAt: null, hasUnsavedChanges: false },
  objects: [],
  selectedObject: null,
  imageAssets: [
    {
      src: "data:image/png;base64,BBBB",
      pageId: "page-2",
      pageName: "page-2",
      panelId: "panel-1",
      panelRef: "page-2:panel-1",
      sourceWidth: 640,
      sourceHeight: 480,
      viewBox: { x: 0, y: 0, width: 640, height: 480 },
      prompt: "",
      description: "",
    },
  ],
  commandManifest: [],
  canvasSnapshot: snapshot,
  selectionSnapshot: null,
};
context.currentPage = context.pages[1];
context.objects = context.currentPage.objects;

describe("agent harness", () => {
  it("starts with a lightweight page index and marks the current viewing page", () => {
    const harness = buildAgentHarness(context);
    const listPages = harness.initialToolResults.find((entry) => entry.toolName === "listPages");
    const pageReads = harness.initialToolResults.filter((entry) => entry.toolName === "readPage");

    expect(harness.mode).toBe("tool-harness");
    expect(harness.currentPageId).toBe("page-2");
    expect(harness.projectId).toBe("project-1");
    expect(harness.initialToolResults.map((entry) => entry.toolName)).toEqual([
      "readProjectSummary",
      "listPages",
      "inspectSelection",
    ]);
    expect(pageReads).toHaveLength(0);
    expect(listPages?.result).toEqual([
      expect.objectContaining({ id: "page-1", isCurrent: false, objectCount: 1 }),
      expect.objectContaining({ id: "page-2", isCurrent: true, objectCount: 1 }),
    ]);
  });

  it("lets the model search and read page resources on demand", async () => {
    const search = await executeAgentHarnessToolCall(context, {
      toolName: "searchProject",
      input: { query: "Earlier" },
    });
    expect(search.result).toMatchObject({
      query: "Earlier",
      returned: 1,
      matches: [expect.objectContaining({ pageId: "page-1", objectId: "text-1" })],
    });

    const readPage = await executeAgentHarnessToolCall(context, {
      toolName: "readPage",
      input: { pageId: "page-1" },
    });
    expect(readPage.result).toMatchObject({
      id: "page-1",
      objects: [expect.objectContaining({ id: "text-1", content: "Earlier page" })],
    });

    const readPages = await executeAgentHarnessToolCall(context, {
      toolName: "readPages",
      input: { pageIds: ["page-1", "page-2"] },
    });
    expect(readPages.result).toMatchObject({
      pageIds: ["page-1", "page-2"],
      truncated: false,
      pages: [
        expect.objectContaining({ id: "page-1" }),
        expect.objectContaining({ id: "page-2" }),
      ],
    });

    const oversizedPageIds = Array.from({ length: AGENT_MAX_BATCH_READ_PAGES + 2 }, (_, index) => `page-${index + 1}`);
    const oversizedRead = await executeAgentHarnessToolCall(context, {
      toolName: "readPages",
      input: { pageIds: oversizedPageIds },
    });
    expect(oversizedRead.result).toMatchObject({
      requestedPageIdCount: AGENT_MAX_BATCH_READ_PAGES + 2,
      maxPageIds: AGENT_MAX_BATCH_READ_PAGES,
      truncated: true,
      pageIds: oversizedPageIds.slice(0, AGENT_MAX_BATCH_READ_PAGES),
      skippedPageIds: oversizedPageIds.slice(AGENT_MAX_BATCH_READ_PAGES),
    });
  });

  it("publishes command-plan-only mutation policy", () => {
    const harness = buildAgentHarness(context);
    expect(harness.resourcePolicy).toMatchObject({
      allPagesReadable: true,
      assetsReadableOnDemand: true,
      documentsReadableOnDemand: true,
      documentsWritableOnDemand: true,
      projectMutationPath: "commandPlanOnly",
    });
    expect(harness.tools.find((entry) => entry.name === "proposeCommandPlan")).toMatchObject({
      mutatesProject: true,
      requiresConfirmation: true,
    });
    expect(harness.tools.find((entry) => entry.name === "listDocuments")).toMatchObject({
      mutatesProject: false,
      requiresConfirmation: false,
    });
    expect(harness.tools.find((entry) => entry.name === "writeDocument")).toMatchObject({
      mutatesProject: true,
      requiresConfirmation: false,
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["operationId"]),
      }),
    });
  });

  it("publishes low-cost render controls for multimodal inspection", () => {
    const harness = buildAgentHarness(context);
    expect(harness.tools.find((entry) => entry.name === "renderPage")?.inputSchema).toMatchObject({
      properties: {
        detail: { enum: ["preview", "detail"] },
        crop: {
          required: ["x", "y", "width", "height"],
        },
      },
    });
    expect(harness.tools.find((entry) => entry.name === "renderPages")?.inputSchema).toMatchObject({
      properties: {
        detail: { enum: ["preview", "detail"] },
      },
    });
    expect(harness.tools.find((entry) => entry.name === "renderPanel")?.inputSchema).toMatchObject({
      required: ["pageId", "panelId"],
      properties: {
        pageId: { type: "string" },
        panelId: { type: "string" },
        detail: { enum: ["preview", "detail"] },
      },
    });
  });

  it("returns structured document lookup failures instead of throwing", async () => {
    const manifest = {
      projectId: "project-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      roleSetupVersion: 1,
      documents: [
        {
          id: "小说家",
          title: "小说家",
          role: "novelist",
          status: "draft",
          path: "docs/roles/小说家.md",
          relatedPageIds: [],
          updatedAt: "2026-01-01T00:00:00.000Z",
          summary: "Metadoc for 小说家.",
        },
      ],
      roles: [],
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/__mangamaker__/agent/document?")) {
        return new Response(
          JSON.stringify({ error: "Agent document not found: novelist-log-p01-p06-20260509." }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("/__mangamaker__/agent/documents?")) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Unexpected URL: ${url}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const readDocument = await executeAgentHarnessToolCall(context, {
      toolName: "readDocument",
      input: { documentId: "novelist-log-p01-p06-20260509" },
    });

    expect(readDocument.result).toMatchObject({
      found: false,
      requestedDocumentId: "novelist-log-p01-p06-20260509",
      availableDocuments: [
        expect.objectContaining({
          id: "小说家",
          path: "docs/roles/小说家.md",
        }),
      ],
      guidance: expect.stringContaining("active role metadoc"),
    });
  });

  it("keeps the latest unique document result visible when budget noise accumulates", () => {
    const originalRead = {
      toolName: "readDocument",
      input: { documentId: "story" },
      result: { id: "story", content: "old", contentLength: 3 },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const refreshedRead = {
      ...originalRead,
      result: { id: "story", content: "new", contentLength: 3 },
      createdAt: "2026-01-01T00:01:00.000Z",
    };
    const noisyBudgetResults = Array.from({ length: 20 }, (_, index) => ({
      toolName: "toolBudget",
      input: {},
      result: { remainingToolCalls: 20 - index },
      createdAt: `2026-01-01T00:02:${String(index).padStart(2, "0")}.000Z`,
    }));
    const merged = mergeAgentToolResults([originalRead, ...noisyBudgetResults], [refreshedRead]);
    const selected = selectAgentDynamicToolResultsForPrompt(merged);

    expect(merged.filter((entry) => entry.toolName === "readDocument")).toHaveLength(1);
    expect(selected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "readDocument",
          result: expect.objectContaining({ content: "new" }),
        }),
      ]),
    );
  });

  it("identifies repeated tool calls and creates cached read results plus idempotent write skips", () => {
    const call = { toolName: "readDocument", input: { documentId: "story" } };
    const writeCall = {
      toolName: "writeDocument",
      input: { operationId: "op-1", id: "story", title: "Story", content: "new" },
    };
    const reusableRead = {
      toolName: "readDocument",
      input: { documentId: "story" },
      result: { id: "story", content: "body" },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const completed = collectCompletedAgentToolCallKeys([
      reusableRead,
      {
        toolName: "writeDocument",
        input: { operationId: "op-1", id: "story", title: "Story", content: "old" },
        result: { saved: true, operationId: "op-1" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const cached = createCachedAgentToolResult(call, reusableRead, "2026-01-01T00:00:01.000Z");
    const skippedWrite = createDuplicateToolCallSkippedResult(writeCall, "2026-01-01T00:00:02.000Z");
    const verifiedSkippedWrite = createDuplicateToolCallSkippedResult(
      {
        toolName: "writeDocument",
        input: { operationId: "op-1", id: "story", title: "Story", content: "old" },
      },
      "2026-01-01T00:00:03.000Z",
      {
        toolName: "writeDocument",
        input: { operationId: "op-1", id: "story", title: "Story", content: "old" },
        result: { saved: true, verified: true, operationId: "op-1" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    );

    expect(completed.has(createAgentToolCallKey(call))).toBe(true);
    expect(completed.has(createAgentToolCallKey(writeCall))).toBe(false);
    expect(
      completed.has(createAgentToolCallKey({
        toolName: "writeDocument",
        input: { operationId: "op-1", id: "story", title: "Story", content: "old" },
      })),
    ).toBe(true);
    expect(cached).toMatchObject({
      toolName: "readDocument",
      input: call.input,
      result: {
        id: "story",
        content: "body",
        cacheHit: true,
        cachedFromCreatedAt: reusableRead.createdAt,
      },
    });
    expect(skippedWrite).toMatchObject({
      toolName: "toolCallSkipped",
      result: {
        duplicate: true,
        alreadyApplied: false,
        operationId: "op-1",
        guidance: expect.stringContaining("Do not report this write as completed"),
      },
    });
    expect(verifiedSkippedWrite).toMatchObject({
      toolName: "toolCallSkipped",
      result: {
        duplicate: true,
        alreadyApplied: true,
        guidance: expect.stringContaining("verified document write"),
      },
    });
  });

  it("uses stable duplicate keys and reuses browser render results only for the same project state", () => {
    const renderCall = {
      toolName: "renderPages",
      input: { detail: "preview", pageIds: ["page-1", "page-2"] },
    };
    const sameRenderCallDifferentKeyOrder = {
      toolName: "renderPages",
      input: { pageIds: ["page-1", "page-2"], detail: "preview" },
    };
    const renderResult = {
      toolName: "renderPages",
      input: sameRenderCallDifferentKeyOrder.input,
      result: {
        projectUpdatedAt: context.project.updatedAt,
        pageIds: ["page-1", "page-2"],
        detail: "preview",
        results: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(createAgentToolCallKey(renderCall)).toBe(createAgentToolCallKey(sameRenderCallDifferentKeyOrder));
    expect(findReusableAgentToolResult([renderResult], renderCall, {
      projectUpdatedAt: context.project.updatedAt,
      currentPageId: "page-2",
    })).toBe(renderResult);
    expect(findReusableAgentToolResult([renderResult], renderCall, {
      projectUpdatedAt: "2026-01-01T00:00:01.000Z",
      currentPageId: "page-2",
    })).toBeNull();

    const cached = createCachedAgentToolResult(renderCall, renderResult, "2026-01-01T00:00:02.000Z");
    expect(cached).toMatchObject({
      toolName: "renderPages",
      input: renderCall.input,
      result: {
        cacheHit: true,
        cachedFromCreatedAt: renderResult.createdAt,
        projectUpdatedAt: context.project.updatedAt,
      },
    });
  });

  it("publishes a completed tool-call index in harness context", async () => {
    const readPages = await executeAgentHarnessToolCall(context, {
      toolName: "readPages",
      input: { pageIds: ["page-1", "page-2"] },
    });
    expect(readPages.result).toMatchObject({
      projectUpdatedAt: context.project.updatedAt,
    });

    const harness = buildAgentHarness(context, [readPages]);
    expect(harness.completedToolCallIndex).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "readPages",
          input: { pageIds: ["page-1", "page-2"] },
          projectUpdatedAt: context.project.updatedAt,
          reusableInCurrentProjectState: true,
          resultKeys: expect.arrayContaining(["pages", "projectUpdatedAt"]),
        }),
      ]),
    );

    expect(createCompletedAgentToolCallIndex([readPages], {
      projectUpdatedAt: "2026-01-01T00:00:01.000Z",
    })).toEqual([
      expect.objectContaining({
        toolName: "readPages",
        reusableInCurrentProjectState: false,
      }),
    ]);
  });

  it("removes harness diagnostic messages from persisted conversation context", () => {
    const messages = [
      {
        id: "m1",
        role: "assistant" as const,
        content: "Ready. I can inspect the current project, offer suggestions, and prepare bounded command plans.",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "m2",
        role: "assistant" as const,
        content:
          "I need to inspect the page.\n\nMangaMaker suppressed additional tool requests (readPages) because this run is in final-answer-only mode after repeated duplicate tool calls.",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "m3",
        role: "assistant" as const,
        content:
          "The model kept repeating identical tool requests after MangaMaker supplied and indexed those results. I stopped this run instead of looping.",
        createdAt: "2026-01-01T00:00:02.000Z",
      },
      {
        id: "m4",
        role: "user" as const,
        content: "Please update the metadoc.",
        createdAt: "2026-01-01T00:00:03.000Z",
      },
    ];

    expect(isAgentHarnessDiagnosticContent(messages[1].content)).toBe(true);
    expect(sanitizeAgentConversationMessages(messages).map((message) => message.id)).toEqual(["m1", "m4"]);
    expect(createAgentConversationFingerprint(messages)).toBe(
      createAgentConversationFingerprint(sanitizeAgentConversationMessages(messages)),
    );
  });

  it("keeps copied creator instructions but removes unverified assistant mutation claims", () => {
    const copiedCreatorInstruction =
      "\u5df2\u6839\u636e\u65b0\u6e32\u67d3\u56fe\u91cd\u65b0\u7406\u89e3\u7b2c10-15\u9875\u5185\u5bb9\uff0c\u5c06\u8fd9\u4e2a\u6539\u52a8\u5199\u8fdb\u6587\u6863\u3002";
    const unverifiedAssistantClaim =
      "\u5df2\u5c06\u7b2c9-15\u9875\u914d\u6587\u65b9\u6848\u5199\u5165\u5c0f\u8bf4\u5bb6 metadoc\u3002";
    const messages = [
      {
        id: "m1",
        role: "user" as const,
        content: copiedCreatorInstruction,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "m2",
        role: "assistant" as const,
        content: unverifiedAssistantClaim,
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ];

    expect(isAgentMutationCompletionClaim(unverifiedAssistantClaim)).toBe(true);
    expect(sanitizeAgentConversationMessages(messages).map((message) => message.id)).toEqual(["m1"]);
  });

  it("migrates stale tool-first system prompt instructions", () => {
    const migrated = migrateAgentSystemPrompt([
      "Custom creator instruction.",
      "Do not assume all resources were included up front. Decide which project details you need, then request tools such as searchProject, readPage, readPages, listImageAssets, renderPage, renderPages, or listCommandManifest.",
      "If you still need tool reads when the harness reports toolBudget.exhausted=true or remainingToolCalls=0, request the needed tools with reasons anyway; MangaMaker will pause for the creator to Continue or Stop. Do not invent final conclusions from incomplete evidence.",
    ].join("\n"));

    expect(migrated).toContain("Custom creator instruction.");
    expect(migrated).toContain("Request tools only for missing evidence");
    expect(migrated).toContain("stop requesting tools");
    expect(migrated).not.toContain("request the needed tools with reasons anyway");
  });
});
