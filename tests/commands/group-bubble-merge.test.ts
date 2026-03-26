import { describe, expect, it } from "vitest";
import { createHarness, runCommand } from "./harness";

describe("groupSelection bubble merge", () => {
  it("merges overlapping selected bubbles into a single bubble", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Merge Overlap" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const bubbleA = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      keepTool: true,
    })) as { id: string };
    const bubbleB = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 220,
      y: 120,
      width: 200,
      height: 150,
      keepTool: true,
    })) as { id: string };

    await runCommand(harness, "selectObjects", {
      pageId: page.id,
      objects: [
        { objectType: "bubble", objectId: bubbleA.id },
        { objectType: "bubble", objectId: bubbleB.id },
      ],
    });
    await runCommand(harness, "groupSelection", {
      pageId: page.id,
    });

    const pageState = harness.readSession().project.pages.find((entry) => entry.id === page.id);
    expect(pageState).toBeTruthy();
    expect(pageState?.bubbles).toHaveLength(1);
    expect(pageState?.groups ?? []).toHaveLength(0);
    expect(pageState?.layers.some((layer) => layer === `bubble:${bubbleA.id}`)).toBe(false);
    expect(pageState?.layers.some((layer) => layer === `bubble:${bubbleB.id}`)).toBe(false);
    const mergedBubble = pageState?.bubbles[0];
    expect(mergedBubble).toMatchObject({
      x: 100,
      y: 100,
      width: 320,
      height: 240,
      bubbleType: "custom",
      showTail: false,
    });
    expect((mergedBubble?.customPoints ?? []).length).toBeGreaterThan(10);
    expect(harness.readSession().multiSelection).toHaveLength(1);
    expect(harness.readSession().multiSelection[0]).toMatchObject({
      pageId: page.id,
      objectType: "bubble",
      objectId: mergedBubble?.id,
    });
  });

  it("keeps non-overlapping bubbles as separate members in a normal group", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Keep Separate" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const bubbleA = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 80,
      y: 80,
      width: 180,
      height: 120,
      keepTool: true,
    })) as { id: string };
    const bubbleB = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 520,
      y: 420,
      width: 180,
      height: 120,
      keepTool: true,
    })) as { id: string };

    await runCommand(harness, "selectObjects", {
      pageId: page.id,
      objects: [
        { objectType: "bubble", objectId: bubbleA.id },
        { objectType: "bubble", objectId: bubbleB.id },
      ],
    });
    await runCommand(harness, "groupSelection", {
      pageId: page.id,
    });

    const pageState = harness.readSession().project.pages.find((entry) => entry.id === page.id);
    expect(pageState).toBeTruthy();
    expect(pageState?.bubbles.map((bubble) => bubble.id).sort()).toEqual(
      [bubbleA.id, bubbleB.id].sort(),
    );
    expect(pageState?.groups).toHaveLength(1);
    expect(pageState?.groups[0]?.members.map((member) => `${member.objectType}:${member.objectId}`).sort()).toEqual(
      [`bubble:${bubbleA.id}`, `bubble:${bubbleB.id}`].sort(),
    );
  });

  it("creates intersection-driven custom handles when preset and custom bubbles are merged", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Preset + Custom Merge Handles" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };

    const presetBubble = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 120,
      y: 120,
      width: 240,
      height: 180,
      bubbleType: "round",
      keepTool: true,
    })) as { id: string };

    const customBubble = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 250,
      y: 160,
      width: 220,
      height: 180,
      bubbleType: "custom",
      customPoints: [
        { x: 18, y: 20 },
        { x: 190, y: 12 },
        { x: 208, y: 76 },
        { x: 176, y: 158 },
        { x: 42, y: 170 },
        { x: 8, y: 94 },
      ],
      keepTool: true,
    })) as { id: string };

    await runCommand(harness, "selectObjects", {
      pageId: page.id,
      objects: [
        { objectType: "bubble", objectId: presetBubble.id },
        { objectType: "bubble", objectId: customBubble.id },
      ],
    });
    await runCommand(harness, "groupSelection", {
      pageId: page.id,
    });

    const pageState = harness.readSession().project.pages.find((entry) => entry.id === page.id);
    expect(pageState).toBeTruthy();
    expect(pageState?.bubbles).toHaveLength(1);
    const mergedBubble = pageState?.bubbles[0];
    expect(mergedBubble?.bubbleType).toBe("custom");
    expect((mergedBubble?.customHandleProfile?.movableIndices ?? []).length).toBeGreaterThanOrEqual(7);
    expect(mergedBubble?.customHandleProfile?.lockedIndices ?? []).toHaveLength(0);
    for (const index of mergedBubble?.customHandleProfile?.movableIndices ?? []) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan((mergedBubble?.customPoints ?? []).length);
    }
    for (const index of mergedBubble?.customHandleProfile?.lockedIndices ?? []) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan((mergedBubble?.customPoints ?? []).length);
    }
  });
});
