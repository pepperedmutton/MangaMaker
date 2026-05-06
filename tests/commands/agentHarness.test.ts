import { describe, expect, it } from "vitest";
import { buildAgentHarness, executeAgentHarnessToolCall } from "../../src/agent/harness";
import type { AgentCanvasSnapshot, AgentContextSnapshot, AgentPageContextSummary } from "../../src/agent/types";

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
      pages: [
        expect.objectContaining({ id: "page-1" }),
        expect.objectContaining({ id: "page-2" }),
      ],
    });
  });

  it("publishes command-plan-only mutation policy", () => {
    const harness = buildAgentHarness(context);
    expect(harness.resourcePolicy).toMatchObject({
      allPagesReadable: true,
      assetsReadableOnDemand: true,
      projectMutationPath: "commandPlanOnly",
    });
    expect(harness.tools.find((entry) => entry.name === "proposeCommandPlan")).toMatchObject({
      mutatesProject: true,
      requiresConfirmation: true,
    });
  });
});
