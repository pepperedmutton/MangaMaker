import { afterEach, describe, expect, it, vi } from "vitest";
import { listImageAssets } from "../../src/agent/context";
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
import { getPageDisplayName } from "../../src/domain/pageNaming";
import type { Project } from "../../src/domain/schema";

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
  it("uses the visible page order name for model-facing image assets", () => {
    const project: Project = {
      id: "project-page-names",
      title: "Page Names",
      type: "cg",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [
        {
          id: "page-a",
          name: "第 1 页",
          width: 1200,
          height: 1600,
          background: "#ffffff",
          panels: [],
          texts: [],
          bubbles: [],
          elements: [],
          groups: [],
          layers: [],
        },
        {
          id: "page-b",
          name: "第 8 页",
          width: 1200,
          height: 1600,
          background: "#ffffff",
          panels: [
            {
              id: "panel-b",
              x: 0,
              y: 0,
              width: 1200,
              height: 1600,
              rotation: 0,
              points: [
                { x: 0, y: 0 },
                { x: 1200, y: 0 },
                { x: 1200, y: 1600 },
                { x: 0, y: 1600 },
              ],
              style: { fill: "#ffffff", stroke: "#111111", strokeWidth: 2, cornerRadius: 0 },
              image: {
                src: "asset://page-b.png",
                prompt: "",
                sourceWidth: 1200,
                sourceHeight: 1600,
                viewBox: { x: 0, y: 0, width: 1200, height: 1600 },
              },
              description: "",
            },
          ],
          texts: [],
          bubbles: [],
          elements: [],
          groups: [],
          layers: ["panel:panel-b"],
        },
      ],
    };

    expect(getPageDisplayName("zh-CN", 1)).toBe("第 2 页");
    expect(listImageAssets(project, "zh-CN")).toEqual([
      expect.objectContaining({
        pageId: "page-b",
        pageName: "第 2 页",
        panelId: "panel-b",
      }),
    ]);
  });

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

  it("preloads the project Prime Directive when supplied", () => {
    const harness = buildAgentHarness(context, [], {
      primeDirective: {
        id: "prime-directive",
        title: "Prime Directive",
        status: "draft",
        path: "docs/PrimeDirective.md",
        relatedPageIds: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        summary: "Project form and all-Agent rules.",
        content: "# Prime Directive\n\n## Project Form\n\nIllustrated light novel.",
      },
    });

    expect(harness.initialToolResults[0]).toMatchObject({
      toolName: "readPrimeDirective",
      input: { documentId: "prime-directive" },
      result: {
        document: {
          id: "prime-directive",
          path: "docs/PrimeDirective.md",
          content: expect.stringContaining("Illustrated light novel"),
        },
        priority: expect.stringContaining("Project-level directive"),
      },
    });
    expect(harness.resourcePolicy).toMatchObject({
      primeDirectiveDocumentId: "prime-directive",
      primeDirectivePreloaded: true,
    });
    expect(
      harness.completedToolCallIndex?.some((entry) => entry.toolName === "readPrimeDirective"),
    ).toBe(true);
  });

  it("restricts text-only document models away from visual/page tools while pinning metadoc context", async () => {
    const harness = buildAgentHarness(context, [], {
      modelCapability: "metadoc",
      activeMetadocId: "assistant-metadoc",
      activeRoleWorkingDirectory: "docs/work/assistant",
    });

    expect(harness.initialToolResults.map((entry) => entry.toolName)).toEqual(["metadocOnlyPolicy"]);
    expect(harness.resourcePolicy).toMatchObject({
      modelCapability: "metadoc",
      metadocOnly: true,
      activeMetadocId: "assistant-metadoc",
      activeRoleWorkingDirectory: "docs/work/assistant",
      roleMetadocPurpose: "role-prompt-definition-only",
      pinnedContext: ["systemPrompt", "readPrimeDirective", "readActiveRoleMetadoc"],
      allPagesReadable: false,
      assetsReadableOnDemand: false,
      documentsReadableOnDemand: true,
      documentsCreatableByAgent: false,
    });
    expect(harness.tools.map((entry) => entry.name)).toEqual([
      "listDocuments",
      "listRoles",
      "readDocument",
      "searchDocuments",
      "writeDocument",
      "validateDocumentAgainstProject",
      "readDocumentLines",
      "appendDocument",
      "deleteDocument",
      "replaceDocumentSection",
      "replaceDocumentText",
      "editDocumentLines",
    ]);

    const blockedPageRead = await executeAgentHarnessToolCall(
      context,
      { toolName: "readPage", input: { pageId: "page-1" } },
      {
        modelCapability: "metadoc",
        activeMetadocId: "assistant-metadoc",
        activeRoleWorkingDirectory: "docs/work/assistant",
      },
    );
    expect(blockedPageRead).toMatchObject({
      toolName: "readPage",
      result: {
        blocked: true,
        activeMetadocId: "assistant-metadoc",
        activeRoleWorkingDirectory: "docs/work/assistant",
        reason: expect.stringContaining("text-only document"),
      },
    });
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

  it("publishes document-only mutation policy", () => {
    const harness = buildAgentHarness(context);
    expect(harness.resourcePolicy).toMatchObject({
      allPagesReadable: true,
      assetsReadableOnDemand: true,
      documentsReadableOnDemand: true,
      documentsWritableOnDemand: true,
      documentsCreatableByAgent: false,
      projectMutationPath: "documentOnly",
    });
    expect(harness.tools.find((entry) => entry.name === "listCommandManifest")).toBeUndefined();
    expect(harness.tools.find((entry) => entry.name === "proposeCommandPlan")).toBeUndefined();
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
    expect(harness.tools.find((entry) => entry.name === "appendDocument")).toMatchObject({
      mutatesProject: true,
      requiresConfirmation: false,
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["operationId", "documentId", "content"]),
      }),
    });
    expect(harness.tools.find((entry) => entry.name === "deleteDocument")).toMatchObject({
      mutatesProject: true,
      requiresConfirmation: false,
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["operationId", "documentId"]),
      }),
    });
    expect(harness.tools.find((entry) => entry.name === "replaceDocumentSection")).toMatchObject({
      mutatesProject: true,
      requiresConfirmation: false,
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["operationId", "documentId", "heading", "content"]),
      }),
    });
    expect(harness.tools.find((entry) => entry.name === "replaceDocumentText")).toMatchObject({
      mutatesProject: true,
      requiresConfirmation: false,
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["operationId", "documentId", "oldText", "newText"]),
      }),
    });
    expect(harness.tools.find((entry) => entry.name === "readDocumentLines")).toMatchObject({
      mutatesProject: false,
      requiresConfirmation: false,
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["documentId"]),
      }),
    });
    expect(harness.tools.find((entry) => entry.name === "editDocumentLines")).toMatchObject({
      mutatesProject: true,
      requiresConfirmation: false,
      inputSchema: expect.objectContaining({
        required: expect.arrayContaining(["operationId", "documentId", "operations"]),
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
      guidance: expect.stringContaining("active role working directory"),
    });
  });

  it("allows reading any Markdown document but writes only inside the active role working directory", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const storyDocument = {
      id: "story",
      title: "Story",
      role: "producer",
      status: "draft" as const,
      path: "docs/story.md",
      relatedPageIds: [],
      updatedAt: now,
      summary: "Source story document.",
      content: "# Story\n\nOld source line.\n",
    };
    const workingDocument = {
      id: "work-note",
      title: "Work Note",
      role: "assistant",
      status: "draft" as const,
      path: "docs/work/assistant/notes.md",
      relatedPageIds: [],
      updatedAt: now,
      summary: "Assistant working output.",
      content: "# Notes\n\nOld note.\n",
    };
    const documents = [
      {
        id: storyDocument.id,
        title: storyDocument.title,
        role: storyDocument.role,
        status: storyDocument.status,
        path: storyDocument.path,
        relatedPageIds: storyDocument.relatedPageIds,
        updatedAt: storyDocument.updatedAt,
        summary: storyDocument.summary,
      },
      {
        id: workingDocument.id,
        title: workingDocument.title,
        role: workingDocument.role,
        status: workingDocument.status,
        path: workingDocument.path,
        relatedPageIds: workingDocument.relatedPageIds,
        updatedAt: workingDocument.updatedAt,
        summary: workingDocument.summary,
      },
    ];
    const writes: Array<Record<string, unknown>> = [];
    const deletes: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/__mangamaker__/agent/document?") && init?.method === "DELETE") {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const documentId = params.get("documentId") ?? "";
        deletes.push(documentId);
        return new Response(JSON.stringify({
          projectId: "project-1",
          updatedAt: "2026-01-01T00:00:02.000Z",
          roleSetupVersion: 1,
          documents: documents.filter((entry) => entry.id !== documentId),
          roles: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/__mangamaker__/agent/documents?")) {
        return new Response(JSON.stringify({
          projectId: "project-1",
          updatedAt: now,
          roleSetupVersion: 1,
          documents,
          roles: [],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/__mangamaker__/agent/document?")) {
        const params = new URLSearchParams(url.split("?")[1] ?? "");
        const documentId = params.get("documentId");
        if (documentId === "story" || documentId === storyDocument.path) {
          return new Response(JSON.stringify(storyDocument), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (documentId === "work-note" || documentId === workingDocument.path) {
          return new Response(JSON.stringify(workingDocument), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: `Agent document not found: ${documentId}` }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/__mangamaker__/agent/document" && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as {
          projectId?: string;
          document?: Record<string, unknown>;
        };
        writes.push(body.document ?? {});
        const document = body.document ?? {};
        return new Response(JSON.stringify({
          id: String(document.id),
          title: String(document.title ?? document.id),
          role: typeof document.role === "string" ? document.role : "assistant",
          status: typeof document.status === "string" ? document.status : "draft",
          path: String(document.path),
          relatedPageIds: Array.isArray(document.relatedPageIds) ? document.relatedPageIds : [],
          updatedAt: "2026-01-01T00:00:01.000Z",
          summary: typeof document.summary === "string" ? document.summary : "",
          content: String(document.content ?? ""),
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Unexpected URL: ${url}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const readOutside = await executeAgentHarnessToolCall(context, {
      toolName: "readDocument",
      input: { documentId: "story" },
    }, {
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(readOutside.result).toMatchObject({
      id: "story",
      path: "docs/story.md",
      content: expect.stringContaining("Old source line"),
    });

    const blockedOutsideWrite = await executeAgentHarnessToolCall(context, {
      toolName: "replaceDocumentText",
      input: {
        operationId: "replace-outside",
        documentId: "story",
        oldText: "Old source line.",
        newText: "New source line.",
      },
    }, {
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(blockedOutsideWrite.result).toMatchObject({
      saved: false,
      verified: false,
      blocked: true,
      scope: "activeRoleWorkingDirectoryOnly",
      requestedDocumentId: "story",
      activeRoleWorkingDirectory: "docs/work/assistant",
      reason: expect.stringContaining("outside the active role working directory"),
    });
    expect(writes).toHaveLength(0);

    const workingDirWrite = await executeAgentHarnessToolCall(context, {
      toolName: "replaceDocumentText",
      input: {
        operationId: "replace-working-note",
        documentId: "work-note",
        oldText: "Old note.",
        newText: "New note.",
      },
    }, {
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(workingDirWrite.result).toMatchObject({
      saved: true,
      verified: true,
      document: {
        id: "work-note",
        path: "docs/work/assistant/notes.md",
      },
      changed: true,
      edit: {
        type: "replaceText",
        replacements: 1,
      },
    });
    expect(writes[0]).toMatchObject({
      id: "work-note",
      path: "docs/work/assistant/notes.md",
      content: expect.stringContaining("New note."),
    });

    const noChangeFullWrite = await executeAgentHarnessToolCall(context, {
      toolName: "writeDocument",
      input: {
        operationId: "write-same-working-doc",
        id: "work-note",
        title: "Work Note",
        role: "assistant",
        status: "draft",
        content: workingDocument.content,
      },
    }, {
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(noChangeFullWrite.result).toMatchObject({
      saved: true,
      verified: true,
      changed: false,
      alreadyApplied: false,
      reason: expect.stringContaining("No document content changed"),
    });
    expect(writes[1]).toMatchObject({
      id: "work-note",
      path: "docs/work/assistant/notes.md",
      content: workingDocument.content,
    });

    const newWorkingDirDocument = await executeAgentHarnessToolCall(context, {
      toolName: "writeDocument",
      input: {
        operationId: "write-new-working-doc",
        id: "new-note",
        title: "New Note",
        role: "assistant",
        status: "draft",
        summary: "Created inside the active role working directory.",
        content: "# New Note\n\nCreated in scope.\n",
      },
    }, {
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(newWorkingDirDocument.result).toMatchObject({
      saved: false,
      verified: false,
      blocked: true,
      scope: "activeRoleWorkingDirectoryOnly",
      requestedDocumentId: "new-note",
      reason: expect.stringContaining("not allowed to create Markdown documents"),
    });
    expect(writes).toHaveLength(2);

    const blockedNewOutsideDocument = await executeAgentHarnessToolCall(context, {
      toolName: "writeDocument",
      input: {
        operationId: "write-new-outside-doc",
        id: "new-outside",
        title: "New Outside",
        role: "assistant",
        status: "draft",
        path: "docs/roles/New Outside.md",
        content: "# New Outside\n\nBlocked.\n",
      },
    }, {
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(blockedNewOutsideDocument.result).toMatchObject({
      saved: false,
      verified: false,
      blocked: true,
      scope: "activeRoleWorkingDirectoryOnly",
      requestedDocumentId: "new-outside",
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(writes).toHaveLength(2);

    const workingDirDelete = await executeAgentHarnessToolCall(context, {
      toolName: "deleteDocument",
      input: {
        operationId: "delete-working-note",
        documentId: "work-note",
      },
    }, {
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(workingDirDelete.result).toMatchObject({
      saved: true,
      verified: true,
      deleted: true,
      changed: true,
      document: {
        id: "work-note",
        path: "docs/work/assistant/notes.md",
      },
    });
    expect(deletes).toEqual(["work-note"]);

    const blockedOutsideDelete = await executeAgentHarnessToolCall(context, {
      toolName: "deleteDocument",
      input: {
        operationId: "delete-story",
        documentId: "story",
      },
    }, {
      activeRoleWorkingDirectory: "docs/work/assistant",
    });
    expect(blockedOutsideDelete.result).toMatchObject({
      saved: false,
      verified: false,
      blocked: true,
      scope: "activeRoleWorkingDirectoryOnly",
      requestedDocumentId: "story",
    });
    expect(deletes).toEqual(["work-note"]);
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

  it("keeps pinned Prime Directive and active role metadoc visible when ordinary tool results accumulate", () => {
    const pinnedPrimeDirective = {
      toolName: "readPrimeDirective",
      input: { documentId: "prime-directive" },
      result: { document: { id: "prime-directive", content: "project rules" } },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const pinnedMetadoc = {
      toolName: "readActiveRoleMetadoc",
      input: { documentId: "assistant-metadoc" },
      result: { document: { id: "assistant-metadoc", content: "role rules" } },
      createdAt: "2026-01-01T00:00:01.000Z",
    };
    const ordinaryReads = Array.from({ length: 30 }, (_, index) => ({
      toolName: "readDocument",
      input: { documentId: `doc-${index + 1}` },
      result: { id: `doc-${index + 1}`, content: `body-${index + 1}` },
      createdAt: `2026-01-01T00:01:${String(index).padStart(2, "0")}.000Z`,
    }));

    const selected = selectAgentDynamicToolResultsForPrompt([
      pinnedPrimeDirective,
      pinnedMetadoc,
      ...ordinaryReads,
    ], {
      recentLimit: 4,
      preservedResultLimit: 4,
    });

    expect(selected.map((entry) => entry.toolName)).toEqual(
      expect.arrayContaining(["readPrimeDirective", "readActiveRoleMetadoc"]),
    );
  });

  it("identifies repeated tool calls and creates cached read results plus idempotent write skips", () => {
    const call = { toolName: "readDocument", input: { documentId: "story" } };
    const writeCall = {
      toolName: "writeDocument",
      input: { operationId: "op-1", id: "story", title: "Story", content: "new" },
    };
    const appendCall = {
      toolName: "appendDocument",
      input: { operationId: "append-1", documentId: "story", content: "new note" },
    };
    const repeatedAppendCallWithFreshOperation = {
      toolName: "appendDocument",
      input: { operationId: "append-2", documentId: "story", content: "new note" },
    };
    const noChangeWriteCall = {
      toolName: "writeDocument",
      input: { operationId: "op-no-change", id: "story", title: "Story", content: "body" },
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
        result: { saved: true, verified: true, changed: true, operationId: "op-1" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        toolName: "appendDocument",
        input: { operationId: "append-1", documentId: "story", content: "new note" },
        result: { saved: true, verified: true, changed: true, operationId: "append-1" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        toolName: "writeDocument",
        input: noChangeWriteCall.input,
        result: { saved: true, verified: true, changed: false, alreadyApplied: false, operationId: "op-no-change" },
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
        result: { saved: true, verified: true, changed: true, operationId: "op-1" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    );
    const noChangeSkippedWrite = createDuplicateToolCallSkippedResult(
      noChangeWriteCall,
      "2026-01-01T00:00:04.000Z",
      {
        toolName: "writeDocument",
        input: noChangeWriteCall.input,
        result: { saved: true, verified: true, changed: false, alreadyApplied: false, operationId: "op-no-change" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    );

    expect(completed.has(createAgentToolCallKey(call))).toBe(true);
    expect(completed.has(createAgentToolCallKey(writeCall))).toBe(false);
    expect(completed.has(createAgentToolCallKey(appendCall))).toBe(true);
    expect(completed.has(createAgentToolCallKey(repeatedAppendCallWithFreshOperation))).toBe(true);
    expect(completed.has(createAgentToolCallKey(noChangeWriteCall))).toBe(false);
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
    expect(noChangeSkippedWrite).toMatchObject({
      toolName: "toolCallSkipped",
      result: {
        duplicate: true,
        alreadyApplied: false,
        guidance: expect.stringContaining("Do not report this write as completed"),
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

  it("does not reuse document reads after a later document mutation changed that document", () => {
    const readCall = { toolName: "readDocument", input: { documentId: "story" } };
    const staleRead = {
      toolName: "readDocument",
      input: { documentId: "story" },
      result: { id: "story", content: "old", updatedAt: "2026-01-01T00:00:00.000Z" },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const mutation = {
      toolName: "editDocumentLines",
      input: {
        operationId: "edit-lines",
        documentId: "story",
        operations: [{ type: "delete", startLine: 1, endLine: 2 }],
      },
      result: {
        saved: true,
        verified: true,
        changed: true,
        document: { id: "story", updatedAt: "2026-01-01T00:00:01.000Z" },
      },
      createdAt: "2026-01-01T00:00:01.000Z",
    };

    expect(findReusableAgentToolResult([staleRead, mutation], readCall)).toBeNull();
    expect(createCompletedAgentToolCallIndex([staleRead, mutation])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "readDocument",
          reusableInCurrentProjectState: false,
        }),
      ]),
    );
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
        content: "Ready. I can inspect the current project, offer suggestions, and update project documents.",
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

  it("keeps assistant replies that wait for creator input instead of claiming a write", () => {
    const waitingReply =
      "已收到约束。后续输出将避免使用指定句式。请提供需要修改的文本内容，我将按照要求进行调整。";
    const messages = [
      {
        id: "m1",
        role: "assistant" as const,
        content: waitingReply,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    expect(isAgentMutationCompletionClaim(waitingReply)).toBe(false);
    expect(sanitizeAgentConversationMessages(messages).map((message) => message.id)).toEqual(["m1"]);
  });

  it("migrates stale tool-first system prompt instructions", () => {
    const migrated = migrateAgentSystemPrompt([
      "Custom creator instruction.",
      "Do not assume all resources were included up front. Decide which project details you need, then request tools such as searchProject, readPage, readPages, listImageAssets, renderPage, or renderPages.",
      "If you still need tool reads when the harness reports toolBudget.exhausted=true or remainingToolCalls=0, request the needed tools with reasons anyway; MangaMaker will pause for the creator to Continue or Stop. Do not invent final conclusions from incomplete evidence.",
    ].join("\n"));

    expect(migrated).toContain("Custom creator instruction.");
    expect(migrated).toContain("Request tools only for missing evidence");
    expect(migrated).toContain("stop requesting tools");
    expect(migrated).not.toContain("request the needed tools with reasons anyway");
  });
});
