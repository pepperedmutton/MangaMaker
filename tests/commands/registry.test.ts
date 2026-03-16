import { describe, expect, it } from "vitest";
import { createHarness, runCommand } from "./harness";

describe("commandRegistry", () => {
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
      fontFamily: "Microsoft YaHei",
      fontSize: 42,
      color: "#334455",
    });

    expect(updatedText).toMatchObject({
      width: 200,
      height: 280,
      direction: "vertical",
      fontFamily: "Microsoft YaHei",
      fontSize: 42,
      color: "#334455",
    });

    const bubble = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 240,
      y: 280,
      width: 260,
      height: 150,
    })) as { id: string };

    await runCommand(harness, "updateBubble", {
      pageId: page.id,
      bubbleId: bubble.id,
      text: "Updated dialogue",
      fontSize: 28,
    });
    await runCommand(harness, "deleteObject", {
      pageId: page.id,
      objectType: "text",
      objectId: text.id,
    });

    expect(harness.readSession().project.pages[0].texts).toHaveLength(0);
    expect(harness.readSession().project.pages[0].bubbles[0].text).toBe("Updated dialogue");
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
});
