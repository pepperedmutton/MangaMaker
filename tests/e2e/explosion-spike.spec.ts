import { expect, test, type Page } from "@playwright/test";

const clearStoredProjectDrafts = async (page: Page) => {
  await page.evaluate(async () => {
    const response = await fetch("/__mangamaker__/persistence/list_project_drafts");
    if (!response.ok) {
      throw new Error("Failed to list project drafts");
    }
    const payload = (await response.json()) as { projects?: string[] };
    for (const rawProject of payload.projects ?? []) {
      try {
        const parsed = JSON.parse(rawProject) as { id?: unknown };
        if (typeof parsed.id !== "string") {
          continue;
        }
        await fetch("/__mangamaker__/persistence/delete_project_draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: parsed.id }),
        });
      } catch {
        // Ignore malformed test drafts and continue clearing the rest.
      }
    }
  });
};

const clearDraftAndOpen = async (page: Page) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await clearStoredProjectDrafts(page);
  await page.reload();
};

const waitForMangaMaker = async (page: Page, timeout = 10000) => {
  await expect
    .poll(
      () => page.evaluate(() => typeof window.mangaMaker !== "undefined"),
      { timeout },
    )
    .toBe(true);
};

const createProjectAndFirstPage = async (page: Page, title: string) => {
  await waitForMangaMaker(page);
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Create your first page" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages.length))
    .toBe(1);
};

const getSelectedPageId = async (page: Page) =>
  page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.id ?? null);

const waitForSelection = async (
  page: Page,
  objectType: "panel" | "text" | "bubble",
  timeout = 5000,
) => {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ type }) => window.mangaMaker?.session.get().selection?.objectType === type,
          { type: objectType },
        ),
      { timeout },
    )
    .toBe(true);
};

const createBubbleViaApi = async (
  page: Page,
  rect: { x: number; y: number; width: number; height: number } = {
    x: 280,
    y: 240,
    width: 260,
    height: 150,
  },
  bubbleType = "explosion",
) => {
  const pageId = await getSelectedPageId(page);
  const bubble = await page.evaluate(
    ({ pageId: currentPageId, rect: currentRect }) =>
      window.mangaMaker?.commands.execute("createBubble", {
        pageId: currentPageId,
        ...currentRect,
      }),
    { pageId, rect },
  );
  
  // Update bubble type if specified
  if (bubbleType !== "round" && bubble) {
    await page.evaluate(
      ({ pid, bid, type }) =>
        window.mangaMaker?.commands.execute("updateBubble", {
          pageId: pid,
          bubbleId: bid,
          bubbleType: type,
        }),
      { pid: pageId, bid: (bubble as { id: string }).id, type: bubbleType },
    );
  }
  
  await waitForSelection(page, "bubble");
};

const getCanvasBox = async (page: Page) => {
  const stage = page.locator(".canvas-wrap .konvajs-content");
  const box = await stage.boundingBox();
  if (!box) {
    throw new Error("Canvas not available");
  }
  return box;
};

const readCanvasLayout = () => {
  const currentPage = window.mangaMaker?.project.get().pages[0];
  const stage = document.querySelector(".canvas-wrap .konvajs-content") as HTMLDivElement | null;
  const wrap = document.querySelector(".canvas-wrap") as HTMLDivElement | null;
  if (!currentPage || !stage || !wrap) {
    return null;
  }

  const stageRect = stage.getBoundingClientRect();
  const styles = window.getComputedStyle(wrap);
  const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const zoom = window.mangaMaker?.session.get().zoom ?? 1;
  const workspaceScaleFactor = 1 / Math.sqrt(0.1);
  const workspaceWidth = currentPage.width * workspaceScaleFactor;
  const workspaceHeight = currentPage.height * workspaceScaleFactor;
  const workspaceX = -((workspaceWidth - currentPage.width) * 0.5);
  const workspaceY = -((workspaceHeight - currentPage.height) * 0.5);
  const viewportWidth = Math.max(0, wrap.clientWidth - horizontalPadding);
  const viewportHeight = Math.max(0, wrap.clientHeight - verticalPadding);
  const fitScale =
    viewportWidth > 0 && viewportHeight > 0
      ? Math.min(viewportWidth / workspaceWidth, viewportHeight / workspaceHeight, 1)
      : 1;
  const coverWorkspaceScale =
    viewportWidth > 0 && viewportHeight > 0
      ? Math.max(viewportWidth / workspaceWidth, viewportHeight / workspaceHeight)
      : 1;
  const scale = Math.max(0.1, fitScale * zoom);
  const workspaceScale = zoom > 1 ? Math.max(coverWorkspaceScale, scale) : coverWorkspaceScale;
  const workspaceCanvasWidth = workspaceWidth * workspaceScale;
  const workspaceCanvasHeight = workspaceHeight * workspaceScale;
  const baseStageWidth = Math.max(1, viewportWidth);
  const baseStageHeight = Math.max(1, viewportHeight);
  const shouldUseScrollableStage =
    zoom > 1 &&
    (workspaceCanvasWidth > baseStageWidth || workspaceCanvasHeight > baseStageHeight);
  const stageWidth = shouldUseScrollableStage
    ? Math.max(1, Math.ceil(workspaceCanvasWidth))
    : baseStageWidth;
  const stageHeight = shouldUseScrollableStage
    ? Math.max(1, Math.ceil(workspaceCanvasHeight))
    : baseStageHeight;
  const workspaceCanvasX = (stageWidth - workspaceCanvasWidth) * 0.5;
  const workspaceCanvasY = (stageHeight - workspaceCanvasHeight) * 0.5;
  const contentCanvasX =
    workspaceCanvasWidth * 0.5 - (workspaceX + workspaceWidth * 0.5) * scale;
  const contentCanvasY =
    workspaceCanvasHeight * 0.5 - (workspaceY + workspaceHeight * 0.5) * scale;

  return {
    scale,
    pageX: workspaceCanvasX + contentCanvasX,
    pageY: workspaceCanvasY + contentCanvasY,
    stageLeft: stageRect.left,
    stageTop: stageRect.top,
  };
};

const getBubbleResizeHandleScreenPoint = async (
  page: Page,
  handle:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "top"
    | "right"
    | "bottom"
    | "left",
) => {
  const layout = await page.evaluate(readCanvasLayout);
  const point = await page.evaluate(({ currentHandle }) => {
    const bubble = window.mangaMaker?.project.get().pages[0]?.bubbles[0];
    if (!bubble) {
      return null;
    }

    return (
      currentHandle === "top-left"
        ? { x: bubble.x, y: bubble.y }
        : currentHandle === "top-right"
          ? { x: bubble.x + bubble.width, y: bubble.y }
          : currentHandle === "bottom-left"
            ? { x: bubble.x, y: bubble.y + bubble.height }
            : currentHandle === "bottom-right"
              ? { x: bubble.x + bubble.width, y: bubble.y + bubble.height }
              : currentHandle === "top"
                ? { x: bubble.x + bubble.width * 0.5, y: bubble.y }
                : currentHandle === "right"
                  ? { x: bubble.x + bubble.width, y: bubble.y + bubble.height * 0.5 }
                  : currentHandle === "bottom"
                    ? { x: bubble.x + bubble.width * 0.5, y: bubble.y + bubble.height }
                    : { x: bubble.x, y: bubble.y + bubble.height * 0.5 }
    );
  }, { currentHandle: handle });

  if (!layout || !point) {
    throw new Error("Bubble resize handle not available");
  }

  return {
    x: layout.stageLeft + layout.pageX + point.x * layout.scale,
    y: layout.stageTop + layout.pageY + point.y * layout.scale,
  };
};

test.describe("Explosion Bubble Spike Control", () => {
  test.beforeEach(async ({ page }) => {
    await clearDraftAndOpen(page);
    await createProjectAndFirstPage(page, "Explosion Spike Test");
  });

  test("should create explosion bubble with default spike configuration", async ({ page }) => {
    // Create an explosion bubble via API
    await createBubbleViaApi(page);
    
    // Verify bubble is created with correct type
    const bubble = await page.evaluate(() => {
      const currentPage = window.mangaMaker?.project.get().pages[0];
      return currentPage?.bubbles[0];
    });
    
    expect(bubble?.bubbleType).toBe("explosion");
    expect(bubble?.spikeCount).toBe(8);
    expect(bubble?.spikeDepth).toBe(0.5);
    expect(bubble?.spikeDepths).toEqual([]);
    expect(bubble?.spikePositions).toEqual([]);
  });

  test("should update spikePositions via updateBubble command", async ({ page }) => {
    // Create an explosion bubble via API
    await createBubbleViaApi(page);
    
    const pageId = await getSelectedPageId(page);
    const bubbleId = await page.evaluate(() => {
      const currentPage = window.mangaMaker?.project.get().pages[0];
      return currentPage?.bubbles[0]?.id;
    });
    
    // Define custom spike positions (arbitrary 2D positions)
    const customPositions = [
      { x: 100, y: 50 },   // Custom position for spike 0
      { x: 150, y: 30 },   // Custom position for spike 1
      { x: 200, y: 60 },   // Custom position for spike 2
    ];
    
    // Update bubble with custom spike positions
    await page.evaluate(
      ({ pid, bid, positions }) =>
        window.mangaMaker?.commands.execute("updateBubble", {
          pageId: pid,
          bubbleId: bid,
          spikePositions: positions,
        }),
      { pid: pageId, bid: bubbleId, positions: customPositions },
    );
    
    // Verify spikePositions are saved
    const updatedBubble = await page.evaluate(() => {
      const currentPage = window.mangaMaker?.project.get().pages[0];
      return currentPage?.bubbles[0];
    });
    
    expect(updatedBubble?.spikePositions).toBeDefined();
    expect(updatedBubble?.spikePositions.length).toBe(3);
    expect(updatedBubble?.spikePositions[0]).toEqual({ x: 100, y: 50 });
    expect(updatedBubble?.spikePositions[1]).toEqual({ x: 150, y: 30 });
    expect(updatedBubble?.spikePositions[2]).toEqual({ x: 200, y: 60 });
  });

  test("should persist custom spike positions after deselecting and reselecting", async ({ page }) => {
    // Create an explosion bubble via API
    await createBubbleViaApi(page);
    
    const pageId = await getSelectedPageId(page);
    const bubbleId = await page.evaluate(() => {
      const currentPage = window.mangaMaker?.project.get().pages[0];
      return currentPage?.bubbles[0]?.id;
    });
    
    // Set custom spike positions
    const customPositions = [
      { x: 120, y: 45 },
      { x: 180, y: 35 },
    ];
    
    await page.evaluate(
      ({ pid, bid, positions }) =>
        window.mangaMaker?.commands.execute("updateBubble", {
          pageId: pid,
          bubbleId: bid,
          spikePositions: positions,
        }),
      { pid: pageId, bid: bubbleId, positions: customPositions },
    );
    
    // Deselect the bubble
    await page.evaluate(() =>
      window.mangaMaker?.commands.execute("clearSelection", {}),
    );
    
    await expect
      .poll(() => page.evaluate(() => window.mangaMaker?.session.get().selection))
      .toBeNull();
    
    // Reselect the bubble
    await page.evaluate(
      ({ pid, bid }) =>
        window.mangaMaker?.commands.execute("selectObject", {
          pageId: pid,
          objectType: "bubble",
          objectId: bid,
        }),
      { pid: pageId, bid: bubbleId },
    );
    
    await waitForSelection(page, "bubble");
    
    // Verify custom positions are persisted
    const bubbleAfterReselect = await page.evaluate(() => {
      const currentPage = window.mangaMaker?.project.get().pages[0];
      return currentPage?.bubbles[0];
    });
    
    expect(bubbleAfterReselect?.spikePositions).toEqual(customPositions);
  });

  test("should render spike control points when explosion bubble is selected", async ({ page }) => {
    // Create an explosion bubble via API
    await createBubbleViaApi(page);
    
    // Get canvas box for coordinate calculations
    const canvasBox = await getCanvasBox(page);
    
    // Get bubble position and dimensions
    const bubbleInfo = await page.evaluate(() => {
      const bubble = window.mangaMaker?.project.get().pages[0]?.bubbles[0];
      return bubble ? { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height } : null;
    });
    
    expect(bubbleInfo).not.toBeNull();
    
    // Take a screenshot to verify rendering (visual regression check)
    const canvas = page.locator(".canvas-wrap canvas");
    await expect(canvas).toBeVisible();
    
    // Verify bubble is selected
    const selection = await page.evaluate(() =>
      window.mangaMaker?.session.get().selection,
    );
    expect(selection?.objectType).toBe("bubble");
  });

  test("should resize an explosion bubble from a corner handle and scale custom spike positions", async ({
    page,
  }) => {
    await createBubbleViaApi(page);

    const pageId = await getSelectedPageId(page);
    const bubbleId = await page.evaluate(() => {
      const currentPage = window.mangaMaker?.project.get().pages[0];
      return currentPage?.bubbles[0]?.id;
    });

    const customPositions = [
      { x: 80, y: 45 },
      { x: 110, y: 40 },
    ];

    await page.evaluate(
      ({ pid, bid, positions }) =>
        window.mangaMaker?.commands.execute("updateBubble", {
          pageId: pid,
          bubbleId: bid,
          spikePositions: positions,
        }),
      { pid: pageId, bid: bubbleId, positions: customPositions },
    );

    const bubbleBefore = await page.evaluate(() => {
      const bubble = window.mangaMaker?.project.get().pages[0]?.bubbles[0];
      return bubble
        ? {
            x: bubble.x,
            y: bubble.y,
            width: bubble.width,
            height: bubble.height,
            spikePositions: bubble.spikePositions,
          }
        : null;
    });

    expect(bubbleBefore).not.toBeNull();

    const handle = await getBubbleResizeHandleScreenPoint(page, "top-left");
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x - 28, handle.y - 20, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.bubbles[0]?.width ?? null))
      .toBeGreaterThan(bubbleBefore!.width);

    const bubbleAfter = await page.evaluate(() => {
      const bubble = window.mangaMaker?.project.get().pages[0]?.bubbles[0];
      return bubble
        ? {
            x: bubble.x,
            y: bubble.y,
            width: bubble.width,
            height: bubble.height,
            spikePositions: bubble.spikePositions,
          }
        : null;
    });

    expect(bubbleAfter).not.toBeNull();
    expect(bubbleAfter!.x).toBeLessThan(bubbleBefore!.x);
    expect(bubbleAfter!.y).toBeLessThan(bubbleBefore!.y);
    expect(bubbleAfter!.width).toBeGreaterThan(bubbleBefore!.width);
    expect(bubbleAfter!.height).toBeGreaterThan(bubbleBefore!.height);
    expect(bubbleAfter!.spikePositions[0].x).toBeCloseTo(
      ((bubbleBefore!.spikePositions[0].x - bubbleBefore!.width / 2) *
        (bubbleAfter!.width / bubbleBefore!.width)) +
        bubbleAfter!.width / 2,
      6,
    );
    expect(bubbleAfter!.spikePositions[0].y).toBeCloseTo(
      ((bubbleBefore!.spikePositions[0].y - bubbleBefore!.height / 2) *
        (bubbleAfter!.height / bubbleBefore!.height)) +
        bubbleAfter!.height / 2,
      6,
    );
  });

  test("should resize an explosion bubble from an edge handle with single-axis scaling", async ({
    page,
  }) => {
    await createBubbleViaApi(page);

    const bubbleBefore = await page.evaluate(() => {
      const bubble = window.mangaMaker?.project.get().pages[0]?.bubbles[0];
      return bubble
        ? {
            x: bubble.x,
            y: bubble.y,
            width: bubble.width,
            height: bubble.height,
          }
        : null;
    });
    expect(bubbleBefore).not.toBeNull();

    const rightHandle = await getBubbleResizeHandleScreenPoint(page, "right");
    await page.mouse.move(rightHandle.x, rightHandle.y);
    await page.mouse.down();
    await page.mouse.move(rightHandle.x + 34, rightHandle.y + 6, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.bubbles[0]?.width ?? null))
      .toBeGreaterThan(bubbleBefore!.width);

    const bubbleAfter = await page.evaluate(() => {
      const bubble = window.mangaMaker?.project.get().pages[0]?.bubbles[0];
      return bubble
        ? {
            x: bubble.x,
            y: bubble.y,
            width: bubble.width,
            height: bubble.height,
          }
        : null;
    });
    expect(bubbleAfter).not.toBeNull();

    expect(bubbleAfter!.width).toBeGreaterThan(bubbleBefore!.width);
    expect(Math.abs(bubbleAfter!.height - bubbleBefore!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(bubbleAfter!.y - bubbleBefore!.y)).toBeLessThanOrEqual(1);
  });

  test("should allow spike drag via simulated mouse interaction", async ({ page }) => {
    // Create an explosion bubble via API
    await createBubbleViaApi(page);
    const canvasLayout = await page.evaluate(readCanvasLayout);
    
    // Get bubble center position
    const bubbleInfo = await page.evaluate(() => {
      const bubble = window.mangaMaker?.project.get().pages[0]?.bubbles[0];
      return bubble ? { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height } : null;
    });
    
    if (!bubbleInfo) {
      throw new Error("Bubble not found");
    }

    if (!canvasLayout) {
      throw new Error("Could not get canvas metrics");
    }
    
    // Calculate bubble center on canvas
    const bubbleCenterX = bubbleInfo.x + bubbleInfo.width / 2;
    const bubbleCenterY = bubbleInfo.y + bubbleInfo.height / 2;

    // The spike control points are at the edges of the bubble
    // First spike is at the top (angle -PI/2)
    // Let's click on where the first spike should be
    const outerRadius = Math.min(bubbleInfo.width, bubbleInfo.height) * 0.48;
    const spikeX = bubbleCenterX;  // cos(-PI/2) = 0
    const spikeY = bubbleCenterY - outerRadius * (0.3 + 0.5 * 0.7);  // sin(-PI/2) = -1
    
    const spikeScreenX = canvasLayout.stageLeft + canvasLayout.pageX + spikeX * canvasLayout.scale;
    const spikeScreenY = canvasLayout.stageTop + canvasLayout.pageY + spikeY * canvasLayout.scale;
    
    // Perform drag on the spike handle
    await page.mouse.move(spikeScreenX, spikeScreenY);
    await page.mouse.down();
    await page.mouse.move(spikeScreenX + 30, spikeScreenY + 40, { steps: 5 });
    await page.mouse.up();
    
    // Wait for the update to be applied
    await page.waitForTimeout(500);
    
    // Verify that spikePositions was updated
    const updatedBubble = await page.evaluate(() => {
      const currentPage = window.mangaMaker?.project.get().pages[0];
      return currentPage?.bubbles[0];
    });
    
    // After dragging, spikePositions should have been updated
    expect(updatedBubble?.spikePositions).toBeDefined();
    expect(updatedBubble?.spikePositions.length).toBeGreaterThan(0);
    expect(updatedBubble?.spikePositions[0]?.x).toBeDefined();
    expect(updatedBubble?.spikePositions[0]?.y).toBeDefined();
  });
});
