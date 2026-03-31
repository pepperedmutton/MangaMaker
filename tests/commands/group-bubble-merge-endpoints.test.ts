import { describe, expect, it } from "vitest";
import { createHarness, runCommand } from "./harness";

describe("groupSelection bubble merge endpoints", () => {
  it("keeps merged bubble endpoint handles available for two preset bubbles", async () => {
    const harness = createHarness();

    await runCommand(harness, "createProject", { title: "Merge Endpoints" });
    const page = (await runCommand(harness, "addPage", {})) as { id: string };
    const bubbleA = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 120,
      y: 120,
      width: 220,
      height: 150,
      bubbleType: "round",
      keepTool: true,
    })) as { id: string };
    const bubbleB = (await runCommand(harness, "createBubble", {
      pageId: page.id,
      x: 250,
      y: 135,
      width: 220,
      height: 150,
      bubbleType: "round",
      keepTool: true,
    })) as { id: string };

    await runCommand(harness, "selectObjects", {
      pageId: page.id,
      objects: [
        { objectType: "bubble", objectId: bubbleA.id },
        { objectType: "bubble", objectId: bubbleB.id },
      ],
    });
    await runCommand(harness, "groupSelection", { pageId: page.id });

    const pageState = harness.readSession().project.pages.find((entry) => entry.id === page.id);
    expect(pageState?.bubbles).toHaveLength(1);
    const mergedBubble = pageState?.bubbles[0];
    expect(mergedBubble?.bubbleType).toBe("custom");

    const movableIndices = mergedBubble?.customHandleProfile?.movableIndices ?? [];
    expect(movableIndices.length).toBeGreaterThanOrEqual(2);
    for (const index of movableIndices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan((mergedBubble?.customPoints ?? []).length);
    }
  });
});
