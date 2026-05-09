import { describe, expect, it } from "vitest";
import { clampBubbleTailBaseLocalPoint, getPageWorkspace } from "../../src/domain/helpers";
import type { Bubble } from "../../src/domain/schema";
import { createHarness, runCommand } from "./harness";

describe("commandRegistry", () => {
  it("keeps one-unit precision for canvas object moves", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Fine Moves" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const panel = (await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: 60,
      y: 80,
      width: 240,
      height: 220,
    })) as { id: string };
    const text = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 120,
      y: 160,
      content: "Fine move",
    })) as { id: string };
    const element = (await runCommand(harness, "createElement", {
      pageId: page.id,
      x: 180,
      y: 220,
      width: 260,
      height: 180,
      src: "/elements/artwords-bam.svg",
      title: "BAM!",
    })) as { id: string };
    const bubble = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 240,
      y: 280,
      width: 260,
      height: 150,
    })) as Bubble;

    const movedPanel = await runCommand(harness, "movePanel", {
      pageId: page.id,
      panelId: panel.id,
      x: 123,
      y: 157,
    });
    const movedText = await runCommand(harness, "updateText", {
      pageId: page.id,
      textId: text.id,
      x: 213,
      y: 277,
    });
    const movedElement = await runCommand(harness, "updateElement", {
      pageId: page.id,
      elementId: element.id,
      x: 337,
      y: 419,
    });
    const movedBubble = (await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      x: 391,
      y: 463,
    })) as Bubble;

    expect(movedPanel).toMatchObject({ x: 123, y: 157 });
    expect(movedText).toMatchObject({ x: 213, y: 277 });
    expect(movedElement).toMatchObject({ x: 337, y: 419 });
    expect(movedBubble).toMatchObject({ x: 391, y: 463 });
    expect(movedBubble.tailTip.x - bubble.tailTip.x).toBeCloseTo(391 - bubble.x, 6);
    expect(movedBubble.tailTip.y - bubble.tailTip.y).toBeCloseTo(463 - bubble.y, 6);
  });

  it("supports the core page workflow for creation, duplication, reorder, and removal", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Pages" });
    const firstPage = (await runCommand(harness, "addPage", {})) as { id: string };
    await runCommand(harness, "duplicatePage", { pageId: firstPage.id });
    await runCommand(harness, "reorderPage", { fromIndex: 1, toIndex: 0 });

    expect(harness.readSession().project.pages).toHaveLength(2);

    await runCommand(harness, "removePage", {
      pageId: harness.readSession().project.pages[0].id,
    });

    expect(harness.readSession().project.pages).toHaveLength(1);
  });

  it("inserts a page directly below the target page when insertAfterPageId is provided", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Insert Below" });
    const firstPage = (await runCommand(harness, "addPage", { name: "First" })) as { id: string };
    const secondPage = (await runCommand(harness, "addPage", { name: "Second" })) as { id: string };
    const insertedPage = (await runCommand(harness, "addPage", {
      name: "Inserted",
      insertAfterPageId: firstPage.id,
    })) as { id: string };

    const pageOrder = harness.readSession().project.pages.map((page) => page.id);
    expect(pageOrder).toEqual([firstPage.id, insertedPage.id, secondPage.id]);
    expect(harness.readSession().selectedPageId).toBe(insertedPage.id);
  });

  it("treats panel images as crop-based panel-bound sources", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Panels" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const panel = (await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: 60,
      y: 80,
      width: 420,
      height: 360,
    })) as { id: string; width: number; height: number };

    const placed = await runCommand(harness, "placeImageInPanel", {
      pageId: page.id,
      panelId: panel.id,
      src: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Q2ZTRmZiIvPjwvc3ZnPg==",
    });

    expect(placed).toMatchObject({
      prompt: "",
      src: expect.stringContaining("data:image/svg+xml"),
      sourceWidth: panel.width,
      sourceHeight: panel.height,
    });
    expect((placed as { viewBox: { width: number; height: number } }).viewBox.width).toBeGreaterThan(
      0,
    );

    await runCommand(harness, "enterPanelImageEdit", {
      pageId: page.id,
      panelId: panel.id,
    });
    expect(harness.readSession().panelImageEditing).toEqual({
      pageId: page.id,
      panelId: panel.id,
    });

    const cropped = await runCommand(harness, "setPanelImageCrop", {
      pageId: page.id,
      panelId: panel.id,
      viewBox: {
        x: 24,
        y: 16,
        width: 220,
        height: 180,
      },
    });

    expect((cropped as { viewBox: { x: number; y: number; width: number; height: number } }).viewBox.x).toBeGreaterThanOrEqual(0);
    expect((cropped as { viewBox: { x: number; y: number; width: number; height: number } }).viewBox.y).toBeGreaterThanOrEqual(0);
    expect(
      (cropped as { viewBox: { width: number; height: number } }).viewBox.width /
        (cropped as { viewBox: { width: number; height: number } }).viewBox.height,
    ).toBeCloseTo(panel.width / panel.height, 2);

    const transformed = await runCommand(harness, "transformImageInPanel", {
      pageId: page.id,
      panelId: panel.id,
      x: 30,
      y: 40,
      scaleX: 1.5,
      scaleY: 1.5,
    });
    
    expect(transformed).toMatchObject({
      transform: {
        x: 30,
        y: 40,
        scaleX: 1.5,
        scaleY: 1.5,
      }
    });

    await runCommand(harness, "exitPanelImageEdit", {});
    expect(harness.readSession().panelImageEditing).toBeNull();
  });

  it("supports polygon panels, text box sizing, text direction, and bubbles", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Objects" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const panel = (await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: 80,
      y: 100,
      width: 320,
      height: 260,
    })) as { id: string; points: Array<{ x: number; y: number }> };

    const withExtraPoint = (await runCommand(harness, "addPanelPoint", {
      pageId: page.id,
      panelId: panel.id,
    })) as { points: Array<{ x: number; y: number }> };
    expect(withExtraPoint.points.length).toBe(5);

    const reshaped = (await runCommand(harness, "setPanelPoints", {
      pageId: page.id,
      panelId: panel.id,
      points: [
        { x: 0, y: 0 },
        { x: 320, y: 0 },
        { x: 260, y: 180 },
        { x: 40, y: 260 },
      ],
    })) as { points: Array<{ x: number; y: number }> };
    expect(reshaped.points).toHaveLength(4);

    const describedPanel = await runCommand(harness, "setPanelDescription", {
      pageId: page.id,
      panelId: panel.id,
      description: "Panel note for story pacing",
    });
    expect(describedPanel).toMatchObject({
      description: "Panel note for story pacing",
    });

    const text = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 120,
      y: 160,
      content: "Caption",
    })) as { id: string };
    const updatedText = await runCommand(harness, "updateText", {
      pageId: page.id,
      textId: text.id,
      width: 200,
      height: 280,
      direction: "vertical",
      fontFamily: "Source Han Sans",
      fontSize: 42,
      color: "#334455",
    });

    expect(updatedText).toMatchObject({
      width: 200,
      height: 280,
      direction: "vertical",
      fontFamily: "Source Han Sans",
      fontSize: 42,
      color: "#334455",
    });

    const element = (await runCommand(harness, "createElement", {
      pageId: page.id,
      x: 180,
      y: 220,
      width: 260,
      height: 180,
      src: "/elements/artwords-bam.svg",
      title: "BAM!",
      category: "artWords",
    })) as { id: string };
    const updatedElement = await runCommand(harness, "updateElement", {
      pageId: page.id,
      elementId: element.id,
      x: 220,
      y: 260,
      width: 300,
      height: 220,
      rotation: 15,
      opacity: 0.75,
    });
    expect(updatedElement).toMatchObject({
      x: 220,
      y: 260,
      width: 300,
      height: 220,
      rotation: 15,
      opacity: 0.75,
      src: "/elements/artwords-bam.svg",
    });
    expect(harness.readSession().project.pages[0].layers).toContain(`element:${element.id}`);

    const bubble = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 240,
      y: 280,
      width: 260,
      height: 150,
    })) as Bubble;

    const movedBubble = (await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      x: bubble.x + 40,
      y: bubble.y + 30,
    })) as Bubble;
    expect(movedBubble.tailTip.x - bubble.tailTip.x).toBeCloseTo(
      movedBubble.x - bubble.x,
      6,
    );
    expect(movedBubble.tailTip.y - bubble.tailTip.y).toBeCloseTo(
      movedBubble.y - bubble.y,
      6,
    );

    const tailHiddenBubble = (await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      showTail: false,
    })) as { showTail: boolean };
    expect(tailHiddenBubble.showTail).toBe(false);
    const translucentBubble = (await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      opacity: 0.42,
    })) as { opacity: number };
    expect(translucentBubble.opacity).toBeCloseTo(0.42, 2);
    const requestedTailBase = {
      x: 60,
      y: 40,
    };
    const anchoredBubble = (await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      tailBase: requestedTailBase,
    })) as Bubble;
    const expectedTailBase = clampBubbleTailBaseLocalPoint(
      anchoredBubble,
      requestedTailBase,
    );
    expect(anchoredBubble.tailBase.x).toBeCloseTo(expectedTailBase.x, 6);
    expect(anchoredBubble.tailBase.y).toBeCloseTo(expectedTailBase.y, 6);

    const resizedBubble = (await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      width: 520,
      height: 300,
    })) as Bubble;
    expect(resizedBubble.tailBase.x).toBeCloseTo(
      (anchoredBubble.tailBase.x * resizedBubble.width) / anchoredBubble.width,
      6,
    );
    expect(resizedBubble.tailBase.y).toBeCloseTo(
      (anchoredBubble.tailBase.y * resizedBubble.height) / anchoredBubble.height,
      6,
    );

    await runCommand(harness, "deleteObject", {
      pageId: page.id,
      objectType: "text",
      objectId: text.id,
    });

    const movedLayer = await runCommand(harness, "moveLayer", {
      pageId: page.id,
      objectType: "bubble",
      objectId: bubble.id,
      direction: "down",
    });
    expect(movedLayer).toMatchObject({
      fromIndex: 2,
      toIndex: 1,
    });

    expect(harness.readSession().project.pages[0].texts).toHaveLength(0);
    expect(harness.readSession().project.pages[0].bubbles[0].showTail).toBe(false);
    expect(harness.readSession().project.pages[0].bubbles[0].opacity).toBeCloseTo(0.42, 2);
  });

  it("reuses updated text typography and box size as defaults for the next inserted text", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Text Defaults" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const firstText = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 100,
      y: 140,
      content: "First",
    })) as { id: string };

    await runCommand(harness, "updateText", {
      pageId: page.id,
      textId: firstText.id,
      width: 520,
      height: 260,
      fontFamily: "LXGW WenKai",
      fontSize: 48,
      fontWeight: 700,
    });

    const secondText = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 260,
      y: 300,
      content: "Second",
    })) as {
      id: string;
      width: number;
      height: number;
      fontFamily: string;
      fontSize: number;
      fontWeight: number;
    };

    expect(secondText).toMatchObject({
      width: 520,
      height: 260,
      fontFamily: "LXGW WenKai",
      fontSize: 48,
      fontWeight: 700,
    });

  });

  it("centers text alignment by default for vertical text and when switching from legacy left alignment", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Vertical Center" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const text = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 120,
      y: 160,
      content: "Vertical",
    })) as { id: string; textAlign: string };

    expect(text.textAlign).toBe("center");

    await runCommand(harness, "updateText", {
      pageId: page.id,
      textId: text.id,
      textAlign: "left",
    });
    const switched = (await runCommand(harness, "updateText", {
      pageId: page.id,
      textId: text.id,
      direction: "vertical",
    })) as { textAlign: string };

    expect(switched.textAlign).toBe("center");
  });

  it("keeps bubble shape updates separate from global text defaults", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Bubble Shape Defaults" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const bubble = (await runCommand(harness, "createBubble", {
      pageId: page.id,
    })) as { id: string };
    const defaultsBefore = harness.readSession().textInsertDefaults;

    await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      bubbleType: "cloud",
      strokeWidth: 5,
      backgroundColor: "#ffeeaa",
    });

    expect(harness.readSession().textInsertDefaults).toEqual(defaultsBefore);
    const nextText = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 220,
      y: 260,
      content: "Text defaults stay independent",
    })) as {
      id: string;
      fontFamily: string;
      fontSize: number;
      fontWeight: number;
    };

    expect(nextText).toMatchObject({
      fontFamily: defaultsBefore.fontFamily,
      fontSize: defaultsBefore.fontSize,
      fontWeight: defaultsBefore.fontWeight,
    });
  });

  it("creates centered bubbles when coordinates are omitted", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Centered Bubble" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const bubble = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      bubbleType: "diamond",
    })) as { id: string; x: number; y: number; width: number; height: number };
    const pageState = harness.readSession().project.pages.find((entry) => entry.id === page.id);

    expect(pageState).toBeTruthy();
    const workspace = getPageWorkspace(pageState!);
    const workspaceCenterX = workspace.x + workspace.width * 0.5;
    const workspaceCenterY = workspace.y + workspace.height * 0.5;
    const bubbleCenterX = bubble.x + bubble.width * 0.5;
    const bubbleCenterY = bubble.y + bubble.height * 0.5;

    expect(Math.abs(bubbleCenterX - workspaceCenterX)).toBeLessThanOrEqual(12);
    expect(Math.abs(bubbleCenterY - workspaceCenterY)).toBeLessThanOrEqual(12);
  });

  it("pastes copied page and object payloads as new entities", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Clipboard Paste" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const panel = (await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: 80,
      y: 120,
      width: 320,
      height: 260,
    })) as { id: string; description: string };

    await runCommand(harness, "setPanelDescription", {
      pageId: page.id,
      panelId: panel.id,
      description: "Clipboard image panel",
    });
    await runCommand(harness, "placeImageInPanel", {
      pageId: page.id,
      panelId: panel.id,
      src: "data:image/png;base64,AAAA",
    });
    const sourcePanel = harness.readSession().project.pages[0].panels[0];
    if (!sourcePanel.image) {
      throw new Error("Expected source panel image");
    }

    const pastedPanel = await runCommand(harness, "pasteClipboardItem", {
      pageId: page.id,
      item: {
        kind: "panel",
        panel: sourcePanel,
      },
    });
    expect(pastedPanel).toMatchObject({
      kind: "panel",
      pageId: page.id,
    });
    expect(harness.readSession().project.pages[0].panels).toHaveLength(2);
    expect(harness.readSession().project.pages[0].panels[1].description).toBe(
      "Clipboard image panel",
    );
    expect(harness.readSession().project.pages[0].panels[1].image?.src).toContain("data:image/png");

    const pastedPage = await runCommand(harness, "pasteClipboardItem", {
      item: {
        kind: "page",
        page: harness.readSession().project.pages[0],
      },
    });
    expect(pastedPage).toMatchObject({
      kind: "page",
    });
    expect(harness.readSession().project.pages).toHaveLength(2);
    expect(harness.readSession().selectedPageId).toBe(
      (pastedPage as { pageId: string }).pageId,
    );
  });

  it("creates clipboard envelopes through the command API", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Clipboard Envelope" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const text = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 120,
      y: 160,
      content: "Copy me",
    })) as { id: string };

    await runCommand(harness, "selectObject", {
      pageId: page.id,
      objectType: "text",
      objectId: text.id,
    });
    const textEnvelope = await runCommand(harness, "createClipboardEnvelope", {});
    expect(textEnvelope).toMatchObject({
      signature: "mangamaker-clipboard/v1",
      sourceProjectId: harness.readSession().project.id,
      item: {
        kind: "text",
        text: {
          content: "Copy me",
        },
      },
    });

    await runCommand(harness, "clearSelection", {});
    const pageEnvelope = await runCommand(harness, "createClipboardEnvelope", {});
    expect(pageEnvelope).toMatchObject({
      item: {
        kind: "page",
        page: {
          id: page.id,
        },
      },
    });
  });

  it("uses the same history model for undo and redo", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "History" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };

    harness.context.setHistory({
      past: [
        {
          project: structuredClone(harness.readSession().project),
          selectedPageId: harness.readSession().selectedPageId,
          selection: null,
          multiSelection: [],
          panelImageEditing: null,
        },
      ],
      future: [],
    });

    await runCommand(harness, "createPanel", {
      pageId: page.id,
      x: 80,
      y: 100,
      width: 320,
      height: 260,
    });

    await runCommand(harness, "undo", {});
    expect(harness.readHistory().future.length).toBeGreaterThan(0);

    await runCommand(harness, "redo", {});
    expect(harness.readHistory().past.length).toBeGreaterThan(0);
  });

  it("allows undo after immediate delete operations", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Delete Undo" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const text = (await runCommand(harness, "createText", {
      pageId: page.id,
      x: 140,
      y: 180,
      content: "Undo me",
    })) as { id: string };

    harness.context.setHistory({
      past: [
        {
          project: structuredClone(harness.readSession().project),
          selectedPageId: harness.readSession().selectedPageId,
          selection: harness.readSession().selection,
          multiSelection: harness.readSession().multiSelection,
          panelImageEditing: harness.readSession().panelImageEditing,
        },
      ],
      future: [],
    });

    await runCommand(harness, "deleteObject", {
      pageId: page.id,
      objectType: "text",
      objectId: text.id,
    });
    expect(harness.readSession().project.pages[0].texts).toHaveLength(0);

    await runCommand(harness, "undo", {});
    expect(harness.readSession().project.pages[0].texts).toHaveLength(1);
    expect(harness.readSession().project.pages[0].texts[0].id).toBe(text.id);
  });
});
