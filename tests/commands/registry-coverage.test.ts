import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandRegistry } from "../../src/commands/registry";
import {
  createBlankProject,
  createDefaultPage,
  MAX_ZOOM,
  MIN_ZOOM,
} from "../../src/domain/defaults";
import { getPageWorkspace } from "../../src/domain/helpers";
import type { Panel } from "../../src/domain/schema";
import { createHarness, runCommand } from "./harness";

const getPanelImageRenderRect = (panel: Panel) => {
  if (!panel.image) {
    throw new Error("Expected panel image");
  }
  const sourceWidth = panel.image.sourceWidth ?? panel.image.viewBox.width;
  const sourceHeight = panel.image.sourceHeight ?? panel.image.viewBox.height;
  return {
    x: panel.x - (panel.image.viewBox.x / panel.image.viewBox.width) * panel.width,
    y: panel.y - (panel.image.viewBox.y / panel.image.viewBox.height) * panel.height,
    width: (sourceWidth / panel.image.viewBox.width) * panel.width,
    height: (sourceHeight / panel.image.viewBox.height) * panel.height,
  };
};

const {
  mockSaveLocalDraft,
  mockLoadLocalDraft,
  mockRenderPageToPngDataUrl,
  mockRenderProjectToJpgZipDataUrl,
  mockRenderProjectToPdfDataUrl,
} = vi.hoisted(() => ({
  mockSaveLocalDraft: vi.fn(() => "2026-03-15T08:30:00.000Z"),
  mockLoadLocalDraft: vi.fn(),
  mockRenderPageToPngDataUrl: vi.fn(async () => "data:image/png;base64,ZmFrZQ=="),
  mockRenderProjectToJpgZipDataUrl: vi.fn(async () => "data:application/zip;base64,ZmFrZQ=="),
  mockRenderProjectToPdfDataUrl: vi.fn(async () => "data:application/pdf;base64,ZmFrZQ=="),
}));

vi.mock("../../src/storage/localDraft", () => ({
  hasLocalDraft: () => false,
  saveLocalDraft: mockSaveLocalDraft,
  loadLocalDraft: mockLoadLocalDraft,
  clearLocalDraft: vi.fn(),
}));

vi.mock("../../src/export/render", () => ({
  renderPageToPngDataUrl: mockRenderPageToPngDataUrl,
  renderProjectToJpgZipDataUrl: mockRenderProjectToJpgZipDataUrl,
  renderProjectToPdfDataUrl: mockRenderProjectToPdfDataUrl,
}));

describe("commandRegistry coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadLocalDraft.mockReturnValue(null);
  });

  it("exposes the full public command surface used by GUI and automation", () => {
    expect(Object.keys(commandRegistry).sort()).toEqual(
      [
        "createProject",
        "setProjectType",
        "renameProject",
        "saveProject",
        "loadProject",
        "addPage",
        "setPageBackground",
        "duplicatePage",
        "removePage",
        "reorderPage",
        "moveLayer",
        "pasteClipboardItem",
        "selectPage",
        "setTool",
        "setLocale",
        "selectObject",
        "clearSelection",
        "setZoom",
        "undo",
        "redo",
        "createPanel",
        "movePanel",
        "resizePanel",
        "setPanelStyle",
        "setPanelDescription",
        "placeImageInPanel",
        "transformImageInPanel",
        "setPanelImageCrop",
        "enterPanelImageEdit",
        "exitPanelImageEdit",
        "setPanelPoints",
        "addPanelPoint",
        "removePanelPoint",
        "groupSelection",
        "ungroupSelection",
        "createText",
        "updateText",
        "createBubble",
        "updateBubble",
        "deleteObject",
        "exportPagePng",
        "exportProjectPdf",
        "exportProjectJpgZip",
        "selectObjects",
        "setBubbleInsertState",
      ].sort(),
    );
  });

  it("supports create, save, load, and locale-aware defaults", async () => {
    const harness = createHarness();
    const providedProject = {
      ...createBlankProject("Loaded from payload"),
      pages: [createDefaultPage(0)],
    };

    await runCommand(harness, "createProject", { title: "Saved Project", type: "cg" });
    expect(harness.readSession().project.type).toBe("cg");
    const cgPage = (await runCommand(harness, "addPage", {})) as { width: number; height: number };
    expect(cgPage).toMatchObject({
      width: 1200,
      height: 1600,
    });
    await runCommand(harness, "renameProject", { title: "Renamed Project" });
    expect(harness.readSession().project.title).toBe("Renamed Project");

    const saveResult = await runCommand(harness, "saveProject", {});
    expect(saveResult).toMatchObject({
      target: "localDraft",
      lastSavedAt: "2026-03-15T08:30:00.000Z",
    });

    await runCommand(harness, "loadProject", { project: providedProject });
    expect(harness.readSession().project.title).toBe("Loaded from payload");

    await runCommand(harness, "setLocale", { locale: "zh-CN" });
    const chinesePage = (await runCommand(harness, "addPage", {})) as { name: string };
    expect(chinesePage.name).toBe("第 2 页");

    await runCommand(harness, "setLocale", { locale: "en" });
    const englishPage = (await runCommand(harness, "addPage", {})) as { name: string };
    expect(englishPage.name).toBe("Page 3");

    const updatedPage = await runCommand(harness, "setPageBackground", {
      pageId: harness.readSession().project.pages[0].id,
      background: "#ccddee",
    });
    expect(updatedPage).toMatchObject({
      background: "#ccddee",
    });
  });

  it("covers page selection, zoom, and history state", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Pages" });
    const firstPage = (await runCommand(harness, "addPage", {
      name: "Opener",
    })) as { id: string };
    const secondPage = (await runCommand(harness, "addPage", {
      name: "Closer",
    })) as { id: string };

    await runCommand(harness, "duplicatePage", { pageId: firstPage.id });
    await runCommand(harness, "reorderPage", { fromIndex: 2, toIndex: 0 });
    expect(harness.readSession().project.pages.map((page) => page.name)).toEqual([
      "Closer",
      "Opener",
      "Opener Copy",
    ]);

    await runCommand(harness, "selectPage", { pageId: secondPage.id });
    expect(harness.readSession().selectedPageId).toBe(secondPage.id);

    await runCommand(harness, "setZoom", { zoom: 9 });
    expect(harness.readSession().zoom).toBe(MAX_ZOOM);
    await runCommand(harness, "setZoom", { zoom: 0.1 });
    expect(harness.readSession().zoom).toBe(MIN_ZOOM);

    harness.context.setHistory({
      past: [
        {
          project: structuredClone(harness.readSession().project),
          selectedPageId: secondPage.id,
          selection: null,
          panelImageEditing: null,
        },
      ],
      future: [],
    });

    await runCommand(harness, "removePage", { pageId: secondPage.id });
    await runCommand(harness, "undo", {});
    expect(harness.readSession().project.pages).toHaveLength(3);
    await runCommand(harness, "redo", {});
    expect(harness.readSession().project.pages).toHaveLength(2);
  });

  it("creates panels with snapping, polygon editing, and crop-based image placement", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Panels" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const panel = (await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: 13,
      y: 27,
      width: 73,
      height: 99,
    })) as { id: string; x: number; y: number; width: number; height: number };

    expect(panel).toMatchObject({
      x: 20,
      y: 20,
      width: 160,
      height: 160,
    });

    const movedPanel = await runCommand(harness, "movePanel", {
      pageId: page.id,
      panelId: panel.id,
      x: -40,
      y: 9999,
    });
    expect(movedPanel).toMatchObject({
      x: -40,
    });
    expect((movedPanel as { y: number }).y).toBeGreaterThan(1540);

    await runCommand(harness, "movePanel", {
      pageId: page.id,
      panelId: panel.id,
      x: 200,
      y: 240,
    });

    const image = await runCommand(harness, "placeImageInPanel", {
      pageId: page.id,
      panelId: panel.id,
      src: "data:image/png;base64,AAAA",
    });
    expect(image).toMatchObject({
      prompt: "",
      viewBox: {
        width: expect.any(Number),
        height: expect.any(Number),
      },
    });

    const cropped = await runCommand(harness, "setPanelImageCrop", {
      pageId: page.id,
      panelId: panel.id,
      viewBox: {
        x: 24,
        y: 16,
        width: 120,
        height: 120,
      },
    });
    expect(cropped).toMatchObject({
      viewBox: {
        x: 24,
        y: 16,
      },
    });

    const polygon = await runCommand(harness, "addPanelPoint", {
      pageId: page.id,
      panelId: panel.id,
    });
    expect((polygon as { points: Array<unknown> }).points).toHaveLength(5);

    const projectWithLargerSource = structuredClone(harness.readSession().project);
    const panelWithImage = projectWithLargerSource.pages[0].panels[0];
    if (!panelWithImage.image) {
      throw new Error("Expected panel image after placement");
    }
    panelWithImage.image.sourceWidth = 400;
    panelWithImage.image.sourceHeight = 300;
    harness.context.setProject(projectWithLargerSource);

    const renderRectBeforeReshape = getPanelImageRenderRect(
      harness.readSession().project.pages[0].panels[0],
    );

    const reshaped = await runCommand(harness, "setPanelPoints", {
      pageId: page.id,
      panelId: panel.id,
      points: [
        { x: -20, y: -20 },
        { x: 160, y: 0 },
        { x: 160, y: 160 },
        { x: 0, y: 160 },
      ],
    });
    expect((reshaped as { x: number }).x).toBeLessThan(200);
    expect((reshaped as { y: number }).y).toBeLessThan(240);
    const renderRectAfterReshape = getPanelImageRenderRect(reshaped as Panel);
    expect(renderRectAfterReshape.x).toBeCloseTo(renderRectBeforeReshape.x, 6);
    expect(renderRectAfterReshape.y).toBeCloseTo(renderRectBeforeReshape.y, 6);
    expect(renderRectAfterReshape.width).toBeCloseTo(renderRectBeforeReshape.width, 6);
    expect(renderRectAfterReshape.height).toBeCloseTo(renderRectBeforeReshape.height, 6);
  });

  it("updates styles, text boxes, text direction, and bubbles while keeping selection coherent", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Objects" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const panel = (await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: 60,
      y: 80,
      width: 320,
      height: 260,
    })) as { id: string };
    const text = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 123,
      y: 167,
      content: "Caption",
    })) as { id: string };
    const bubble = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 245,
      y: 285,
      width: 255,
      height: 145,
      text: "Speech",
    })) as { id: string };

    const styledPanel = await runCommand(harness, "setPanelStyle", {
      pageId: page.id,
      panelId: panel.id,
      fill: "#ffeeee",
      stroke: "#112233",
      strokeWidth: 6,
      cornerRadius: 18,
    });
    expect(styledPanel).toMatchObject({
      style: {
        fill: "#ffeeee",
        stroke: "#112233",
        strokeWidth: 6,
        cornerRadius: 18,
      },
    });

    const panelWithDescription = await runCommand(harness, "setPanelDescription", {
      pageId: page.id,
      panelId: panel.id,
      description: "Opening shot: establish location and mood",
    });
    expect(panelWithDescription).toMatchObject({
      description: "Opening shot: establish location and mood",
    });

    const updatedText = await runCommand(harness, "updateText", {
      pageId: page.id,
      textId: text.id,
      content: "Updated caption",
      x: 181,
      y: 199,
      width: 201,
      height: 281,
      fontSize: 42,
      fontFamily: "LXGW WenKai",
      color: "#334455",
      direction: "vertical",
    });
    expect(updatedText).toMatchObject({
      content: "Updated caption",
      x: 180,
      y: 200,
      width: 200,
      height: 280,
      fontSize: 42,
      fontFamily: "LXGW WenKai",
      color: "#334455",
      direction: "vertical",
    });

    const customSpikePositions = [
      { x: 120, y: 52 },
      { x: 160, y: 40 },
      { x: 202, y: 66 },
    ];

    const updatedBubble = await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      x: 280,
      y: 320,
      width: 301,
      height: 151,
      tailTip: { x: 1300, y: -60 },
      text: "Updated dialogue",
      fontSize: 30,
      bubbleType: "explosion",
      spikePositions: customSpikePositions,
    });
    expect(updatedBubble).toMatchObject({
      x: 280,
      y: 320,
      width: 300,
      height: 160,
      bubbleType: "explosion",
    });
    expect((updatedBubble as { tailTip: { x: number; y: number } }).tailTip.x).toBeGreaterThan(1200);
    expect((updatedBubble as { tailTip: { x: number; y: number } }).tailTip.y).toBeLessThan(0);
    expect((updatedBubble as { spikePositions: Array<{ x: number; y: number }> }).spikePositions).toEqual(
      customSpikePositions,
    );

    const movedBubbleWithoutTailUpdate = await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      x: 360,
      y: 380,
    });
    expect(
      (movedBubbleWithoutTailUpdate as { tailTip: { x: number; y: number } }).tailTip,
    ).toEqual((updatedBubble as { tailTip: { x: number; y: number } }).tailTip);

    const layerOrderBefore = [...harness.readSession().project.pages[0].layers];
    const movedLayer = await runCommand(harness, "moveLayer", {
      pageId: page.id,
      objectType: "panel",
      objectId: panel.id,
      direction: "up",
    });
    expect((movedLayer as { fromIndex: number; toIndex: number }).toIndex).toBe(
      (movedLayer as { fromIndex: number; toIndex: number }).fromIndex + 1,
    );
    expect(harness.readSession().project.pages[0].layers).not.toEqual(layerOrderBefore);

    const movedTextOutsidePage = await runCommand(harness, "updateText", {
      pageId: page.id,
      textId: text.id,
      x: -40,
      y: -60,
    });
    expect(movedTextOutsidePage).toMatchObject({
      x: -40,
      y: -60,
    });

    await runCommand(harness, "selectObject", {
      pageId: page.id,
      objectType: "text",
      objectId: text.id,
    });
    expect(harness.readSession().selection).toMatchObject({ objectType: "text" });

    await runCommand(harness, "deleteObject", {
      pageId: page.id,
      objectType: "text",
      objectId: text.id,
    });
    expect(harness.readSession().selection).toBeNull();
  });

  it("exports PNG, PDF, and JPG ZIP artifacts with safe names and session metadata", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "My Great Project!" });
    const page = (await runCommand(harness, "addPage", {
      name: "Page 1: Finale?",
    })) as { id: string };

    const pngArtifact = await runCommand(harness, "exportPagePng", { pageId: page.id });
    expect(mockRenderPageToPngDataUrl).toHaveBeenCalledTimes(1);
    expect(pngArtifact).toMatchObject({
      kind: "png",
      fileName: "page-1-finale.png",
      pageId: page.id,
    });

    const pdfArtifact = await runCommand(harness, "exportProjectPdf", {});
    expect(mockRenderProjectToPdfDataUrl).toHaveBeenCalledWith(harness.readSession().project.pages);
    expect(pdfArtifact).toMatchObject({
      kind: "pdf",
      fileName: "my-great-project.pdf",
      pageCount: 1,
    });

    const jpgZipArtifact = await runCommand(harness, "exportProjectJpgZip", {});
    expect(mockRenderProjectToJpgZipDataUrl).toHaveBeenCalledWith(
      harness.readSession().project.pages,
    );
    expect(jpgZipArtifact).toMatchObject({
      kind: "jpgZip",
      fileName: "my-great-project-jpg-pages.zip",
      pageCount: 1,
    });
  });

  it("throws clear errors on invalid identifiers and invalid panel image edit targets", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Failures" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const text = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 120,
      y: 160,
    })) as { id: string };
    const panel = (await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: 80,
      y: 80,
      width: 240,
      height: 240,
    })) as { id: string };

    await expect(
      runCommand(harness, "setPanelStyle", {
        pageId: page.id,
        panelId: "missing-panel",
        fill: "#fff000",
      }),
    ).rejects.toThrow("Panel not found: missing-panel");

    await expect(
      runCommand(harness, "enterPanelImageEdit", {
        pageId: page.id,
        panelId: panel.id,
      }),
    ).rejects.toThrow(`Panel image not found: ${panel.id}`);

    await expect(
      runCommand(harness, "updateText", {
        pageId: page.id,
        textId: "missing-text",
        content: "Nope",
      }),
    ).rejects.toThrow("Text not found: missing-text");

    await expect(
      runCommand(harness, "deleteObject", {
        pageId: page.id,
        objectType: "bubble",
        objectId: "missing-bubble",
      }),
    ).rejects.toThrow("Object not found: bubble:missing-bubble");

    await expect(
      runCommand(harness, "deleteObject", {
        pageId: page.id,
        objectType: "text",
        objectId: text.id,
      }),
    ).resolves.toMatchObject({
      objectType: "text",
      objectId: text.id,
    });
  });

  it("keeps movable objects inside the larger workspace instead of clipping them to the page", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Workspace" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const workspace = getPageWorkspace(harness.readSession().project.pages[0]);

    const panel = (await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: -400,
      y: -400,
      width: 320,
      height: 260,
    })) as { x: number; y: number };

    expect(panel.x).toBeGreaterThanOrEqual(workspace.x);
    expect(panel.y).toBeGreaterThanOrEqual(workspace.y);
    expect(panel.x).toBeLessThan(0);
    expect(panel.y).toBeLessThan(0);
  });
});
