import { expect, test, type Page } from "@playwright/test";

const clearDraftAndOpen = async (page: Page) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
};

const createProjectAndFirstPage = async (page: Page, title: string) => {
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Create your first page" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages.length))
    .toBe(1);
};

const getCanvasBox = async (page: Page) => {
  const stage = page.locator(".canvas-wrap .konvajs-content");
  const box = await stage.boundingBox();
  if (!box) {
    throw new Error("Canvas not available");
  }
  return box;
};

const getRenderedPageMetrics = async (page: Page) =>
  page.evaluate(() => {
    const currentPage = window.mangaMaker?.project.get().pages[0];
    const zoom = window.mangaMaker?.session.get().zoom ?? 1;
    const stage = document.querySelector(".canvas-wrap .konvajs-content") as HTMLDivElement | null;
    const canvas = document.querySelector(".canvas-wrap canvas") as HTMLCanvasElement | null;
    if (!currentPage || !canvas || !stage) {
      return null;
    }

    const rect = stage.getBoundingClientRect();
    const workspaceScaleFactor = 1 / Math.sqrt(0.25);
    const workspaceWidth = currentPage.width * workspaceScaleFactor;
    const workspaceHeight = currentPage.height * workspaceScaleFactor;
    const workspaceScale = Math.min(rect.width / workspaceWidth, rect.height / workspaceHeight, 1);
    const scale = workspaceScale * zoom;
    const workspaceOriginX = (rect.width - workspaceWidth * workspaceScale) * 0.5;
    const workspaceOriginY = (rect.height - workspaceHeight * workspaceScale) * 0.5;
    const pageOriginX = workspaceOriginX + workspaceWidth * workspaceScale * 0.5 - currentPage.width * scale * 0.5;
    const pageOriginY =
      workspaceOriginY + workspaceHeight * workspaceScale * 0.5 - currentPage.height * scale * 0.5;

    return {
      workspaceX: workspaceOriginX,
      workspaceY: workspaceOriginY,
      workspaceWidth: workspaceWidth * workspaceScale,
      workspaceHeight: workspaceHeight * workspaceScale,
      pageX: pageOriginX,
      pageY: pageOriginY,
      pageWidth: currentPage.width * scale,
      pageHeight: currentPage.height * scale,
      stageWidth: rect.width,
      stageHeight: rect.height,
    };
  });

const installCanvasContextMenuProbe = async (page: Page) => {
  await page.evaluate(() => {
    const wrap = document.querySelector(".canvas-wrap");
    (window as Window & { __canvasContextMenuPrevented?: boolean | null }).__canvasContextMenuPrevented = null;
    wrap?.addEventListener("contextmenu", (event) => {
      window.setTimeout(() => {
        (
          window as Window & { __canvasContextMenuPrevented?: boolean | null }
        ).__canvasContextMenuPrevented = event.defaultPrevented;
      }, 0);
    });
  });
};

const dragZoomSlider = async (page: Page, ratio: number) => {
  const slider = page.getByLabel("Zoom");
  const box = await slider.boundingBox();
  if (!box) {
    throw new Error("Zoom slider not available");
  }

  const currentRatio = await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    return (value - min) / (max - min);
  });
  const x = box.x + box.width * ratio;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * currentRatio, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
};

const setColorInput = async (page: Page, label: string, color: string) => {
  await page.getByLabel(label).evaluate((element, value) => {
    const input = element as HTMLInputElement;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, color);
};

const getPanelCanvasPoint = async (
  page: Page,
  options: {
    panelIndex?: number;
    xRatio?: number;
    yRatio?: number;
    xOffset?: number;
    yOffset?: number;
  } = {},
) => {
  const result = await page.evaluate(
    ({ panelIndex, xRatio, yRatio, xOffset, yOffset }) => {
      const currentPage = window.mangaMaker?.project.get().pages[0];
      const zoom = window.mangaMaker?.session.get().zoom ?? 1;
      const stage = document.querySelector(".canvas-wrap .konvajs-content") as HTMLDivElement | null;
      const panel = currentPage?.panels[panelIndex ?? 0];
      if (!currentPage || !panel || !stage) {
        return null;
      }

      const rect = stage.getBoundingClientRect();
      const workspaceScaleFactor = 1 / Math.sqrt(0.25);
      const workspaceWidth = currentPage.width * workspaceScaleFactor;
      const workspaceHeight = currentPage.height * workspaceScaleFactor;
      const workspaceScale = Math.min(rect.width / workspaceWidth, rect.height / workspaceHeight, 1);
      const scale = workspaceScale * zoom;
      const workspaceOriginX = (rect.width - workspaceWidth * workspaceScale) * 0.5;
      const workspaceOriginY = (rect.height - workspaceHeight * workspaceScale) * 0.5;
      const pageOriginX =
        workspaceOriginX + workspaceWidth * workspaceScale * 0.5 - currentPage.width * scale * 0.5;
      const pageOriginY =
        workspaceOriginY + workspaceHeight * workspaceScale * 0.5 - currentPage.height * scale * 0.5;
      const point = {
        x: panel.x + panel.width * (xRatio ?? 0.5) + (xOffset ?? 0),
        y: panel.y + panel.height * (yRatio ?? 0.5) + (yOffset ?? 0),
      };

      return {
        x: pageOriginX + point.x * scale,
        y: pageOriginY + point.y * scale,
      };
    },
    {
      panelIndex: options.panelIndex ?? 0,
      xRatio: options.xRatio ?? 0.5,
      yRatio: options.yRatio ?? 0.5,
      xOffset: options.xOffset ?? 0,
      yOffset: options.yOffset ?? 0,
    },
  );

  if (!result) {
    throw new Error("Panel coordinates not available");
  }

  return result;
};

const getSelectedPanelPreviewSamplePoint = async (page: Page, panelIndex = 0) => {
  const result = await page.evaluate(({ panelIndex: currentPanelIndex }) => {
    const currentPage = window.mangaMaker?.project.get().pages[0];
    const panel = currentPage?.panels[currentPanelIndex];
    if (!panel?.image) {
      return null;
    }

    const clampBetween = (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max);

    const { viewBox } = panel.image;
    const sourceWidth = panel.image.sourceWidth ?? viewBox.width;
    const sourceHeight = panel.image.sourceHeight ?? viewBox.height;
    const previewLeft = panel.x - (viewBox.x / viewBox.width) * panel.width;
    const previewTop = panel.y - (viewBox.y / viewBox.height) * panel.height;
    const previewRight = previewLeft + (sourceWidth / viewBox.width) * panel.width;
    const previewBottom = previewTop + (sourceHeight / viewBox.height) * panel.height;
    const renderWidth = previewRight - previewLeft;
    const renderHeight = previewBottom - previewTop;
    const sourceSamples = [
      { x: 265, y: 140 },
      { x: 110, y: 110 },
    ];

    for (const sample of sourceSamples) {
      const x = previewLeft + (sample.x / sourceWidth) * renderWidth;
      const y = previewTop + (sample.y / sourceHeight) * renderHeight;
      const outsidePanel =
        x < panel.x - 12 ||
        x > panel.x + panel.width + 12 ||
        y < panel.y - 12 ||
        y > panel.y + panel.height + 12;
      if (outsidePanel) {
        return { x, y };
      }
    }

    const previewCenterX = clampBetween(
      panel.x + panel.width * 0.5,
      previewLeft + 12,
      previewRight - 12,
    );
    const previewCenterY = clampBetween(
      panel.y + panel.height * 0.5,
      previewTop + 12,
      previewBottom - 12,
    );

    if (previewLeft < panel.x - 12) {
      return {
        x: panel.x - Math.min(24, (panel.x - previewLeft) * 0.5),
        y: previewCenterY,
      };
    }

    if (previewRight > panel.x + panel.width + 12) {
      return {
        x: panel.x + panel.width + Math.min(24, (previewRight - panel.x - panel.width) * 0.5),
        y: previewCenterY,
      };
    }

    if (previewTop < panel.y - 12) {
      return {
        x: previewCenterX,
        y: panel.y - Math.min(24, (panel.y - previewTop) * 0.5),
      };
    }

    if (previewBottom > panel.y + panel.height + 12) {
      return {
        x: previewCenterX,
        y:
          panel.y +
          panel.height +
          Math.min(24, (previewBottom - panel.y - panel.height) * 0.5),
      };
    }

    return null;
  }, { panelIndex });

  if (!result) {
    throw new Error("Preview sample point not available");
  }

  return result;
};

const readCanvasPixelAtPagePoint = async (
  page: Page,
  point: { x: number; y: number },
) => {
  const pixel = await page.evaluate(({ pagePoint }) => {
    const currentPage = window.mangaMaker?.project.get().pages[0];
    const zoom = window.mangaMaker?.session.get().zoom ?? 1;
    const stage = document.querySelector(".canvas-wrap .konvajs-content") as HTMLDivElement | null;
    const canvas = document.querySelector(".canvas-wrap canvas") as HTMLCanvasElement | null;
    if (!currentPage || !canvas || !stage) {
      return null;
    }

    const rect = stage.getBoundingClientRect();
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    const workspaceScaleFactor = 1 / Math.sqrt(0.25);
    const workspaceWidth = currentPage.width * workspaceScaleFactor;
    const workspaceHeight = currentPage.height * workspaceScaleFactor;
    const workspaceScale = Math.min(rect.width / workspaceWidth, rect.height / workspaceHeight, 1);
    const scale = workspaceScale * zoom;
    const workspaceOriginX = (rect.width - workspaceWidth * workspaceScale) * 0.5;
    const workspaceOriginY = (rect.height - workspaceHeight * workspaceScale) * 0.5;
    const pageOriginX = workspaceOriginX + workspaceWidth * workspaceScale * 0.5 - currentPage.width * scale * 0.5;
    const pageOriginY =
      workspaceOriginY + workspaceHeight * workspaceScale * 0.5 - currentPage.height * scale * 0.5;
    const canvasX = pageOriginX + pagePoint.x * scale;
    const canvasY = pageOriginY + pagePoint.y * scale;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return Array.from(
      context.getImageData(canvasX * scaleX, canvasY * scaleY, 1, 1).data,
    );
  }, { pagePoint: point });

  if (!pixel) {
    throw new Error("Canvas pixel not available");
  }

  return pixel;
};

const getMaxBlueBiasAtPagePoints = async (
  page: Page,
  points: Array<{ x: number; y: number }>,
) => {
  const pixels = await Promise.all(points.map((point) => readCanvasPixelAtPagePoint(page, point)));
  return Math.max(...pixels.map((pixel) => pixel[2] - pixel[0]));
};

const getSelectedPageId = async (page: Page) =>
  page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.id ?? null);

const waitForSelection = async (
  page: Page,
  objectType: "panel" | "text" | "bubble",
) => {
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().selection?.objectType))
    .toBe(objectType);
};

const createPanelViaApi = async (
  page: Page,
  rect: { x: number; y: number; width: number; height: number } = {
    x: 120,
    y: 120,
    width: 240,
    height: 760,
  },
) => {
  const pageId = await getSelectedPageId(page);
  await page.evaluate(
    ({ pageId: currentPageId, rect: currentRect }) =>
      window.mangaMaker?.commands.execute("createPanel", {
        pageId: currentPageId,
        ...currentRect,
      }),
    { pageId, rect },
  );
  await waitForSelection(page, "panel");
};

const createTextViaApi = async (page: Page, point = { x: 200, y: 200 }) => {
  const pageId = await getSelectedPageId(page);
  await page.evaluate(
    ({ pageId: currentPageId, point: currentPoint }) =>
      window.mangaMaker?.commands.execute("createText", {
        pageId: currentPageId,
        x: currentPoint.x,
        y: currentPoint.y,
      }),
    { pageId, point },
  );
  await waitForSelection(page, "text");
};

const createBubbleViaApi = async (
  page: Page,
  rect: { x: number; y: number; width: number; height: number } = {
    x: 280,
    y: 240,
    width: 260,
    height: 150,
  },
) => {
  const pageId = await getSelectedPageId(page);
  await page.evaluate(
    ({ pageId: currentPageId, rect: currentRect }) =>
      window.mangaMaker?.commands.execute("createBubble", {
        pageId: currentPageId,
        ...currentRect,
      }),
    { pageId, rect },
  );
  await waitForSelection(page, "bubble");
};

test("first-run flow creates a project, a page, and visible next-step guidance", async ({
  page,
}) => {
  await clearDraftAndOpen(page);

  await expect(page.getByText("Turn AI images into a comic page.")).toBeVisible();
  await createProjectAndFirstPage(page, "First Run Test");

  await expect(page.locator(".left-sidebar")).toContainText("First Run Test");
  await expect(page.locator(".onboarding-banner")).toHaveCount(0);
  await expect(page.locator(".right-sidebar")).toContainText(
    "Choose the Panel tool, then drag on the canvas.",
  );
  await expect(page.getByRole("button", { name: "Add page" })).toBeVisible();
});

test("selected panels reveal the bound source image and allow direct wheel/drag crop editing", async ({
  page,
}) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Panel Crop Workflow");

  await createPanelViaApi(page);

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page
    .locator(".right-sidebar")
    .getByRole("button", { name: "Import Image" })
    .click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("tests/fixtures/sample-image.svg");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
        return panel?.image
          ? {
              sourceWidth: panel.image.sourceWidth,
              sourceHeight: panel.image.sourceHeight,
              viewBox: panel.image.viewBox,
            }
          : null;
      }),
    )
    .toBeTruthy();

  const cropState = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel?.image
      ? {
          sourceWidth: panel.image.sourceWidth,
          sourceHeight: panel.image.sourceHeight,
          viewBox: panel.image.viewBox,
        }
      : null;
  });

  expect(cropState?.viewBox.width).toBeLessThan(cropState?.sourceWidth ?? 0);
  await expect(page.locator(".right-sidebar")).toContainText(
    "While this panel is selected, the full source image stays visible.",
  );

  const panelCenter = await getPanelCanvasPoint(page);
  const canvasBox = await getCanvasBox(page);
  const panelCenterPagePoint = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel
      ? {
          x: panel.x + panel.width * 0.5,
          y: panel.y + panel.height * 0.5,
        }
      : null;
  });
  if (!panelCenterPagePoint) {
    throw new Error("Panel center point not available");
  }
  const panelPositionBeforeImageDrag = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel ? { x: panel.x, y: panel.y } : null;
  });
  const panelPixelBeforeImageDrag = await readCanvasPixelAtPagePoint(page, panelCenterPagePoint);

  await page.mouse.move(canvasBox.x + panelCenter.x, canvasBox.y + panelCenter.y);
  await page.mouse.wheel(0, -420);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.mangaMaker?.project.get().pages[0]?.panels[0]?.image?.viewBox.width ?? null,
        ),
      { timeout: 3000 },
    )
    .toBeLessThan(cropState?.viewBox.width ?? 0);

  const zoomedViewBox = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel?.image?.viewBox ?? null;
  });
  expect(zoomedViewBox).not.toBeNull();

  // Dragging the selected panel with image should pan the image crop (not move the panel)
  const viewBoxBeforeDrag = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel?.image?.viewBox ?? null;
  });
  expect(viewBoxBeforeDrag).not.toBeNull();

  await page.mouse.move(canvasBox.x + panelCenter.x, canvasBox.y + panelCenter.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + panelCenter.x + 60, canvasBox.y + panelCenter.y + 24, {
    steps: 8,
  });
  await page.mouse.up();

  // Verify the panel position did NOT change (panel stays in place)
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
          return panel ? { x: panel.x, y: panel.y } : null;
        }),
      { timeout: 3000 },
    )
    .toEqual(panelPositionBeforeImageDrag);

  // Verify the image viewBox changed (crop was panned)
  const viewBoxAfterDrag = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel?.image?.viewBox ?? null;
  });
  expect(viewBoxAfterDrag).not.toEqual(viewBoxBeforeDrag);

  const previewSamplePoint = await getSelectedPanelPreviewSamplePoint(page);
  await expect
    .poll(async () => {
      const pixel = await readCanvasPixelAtPagePoint(page, previewSamplePoint);
      return pixel[0] + pixel[1] + pixel[2];
    })
    .toBeLessThan(745);

  await page.evaluate(() => window.mangaMaker?.commands.execute("clearSelection", {}));
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().selection))
    .toBeNull();
});

test("polygon panels support adding and removing vertices through the inspector", async ({
  page,
}) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Polygon Workflow");

  await createPanelViaApi(page, { x: 120, y: 120, width: 360, height: 320 });

  await page.locator(".right-sidebar").getByRole("button", { name: "Add vertex" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels[0]?.points.length))
    .toBe(5);

  await page.locator(".right-sidebar .vertex-remove").first().click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels[0]?.points.length))
    .toBe(4);
});

test("double-clicking a panel still leaves it selected", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Panel Double Click");

  await createPanelViaApi(page, { x: 140, y: 160, width: 320, height: 280 });
  const panelId = await page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels[0]?.id ?? null);
  if (!panelId) {
    throw new Error("Panel id not available");
  }

  await page.evaluate(() => window.mangaMaker?.commands.execute("clearSelection", {}));
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().selection))
    .toBeNull();

  const panelCenter = await getPanelCanvasPoint(page);
  const canvasBox = await getCanvasBox(page);
  await page.mouse.dblclick(canvasBox.x + panelCenter.x, canvasBox.y + panelCenter.y);

  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().selection))
    .toEqual({
      pageId: expect.any(String),
      objectType: "panel",
      objectId: panelId,
    });
});

test("a selected image panel can still be moved without changing zoom layout", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Move Selected Image Panel");
  await createPanelViaApi(page, { x: 160, y: 180, width: 320, height: 280 });

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.locator(".right-sidebar").getByRole("button", { name: "Import Image" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles("tests/fixtures/sample-image.svg");

  await expect
    .poll(() => page.evaluate(() => Boolean(window.mangaMaker?.project.get().pages[0]?.panels[0]?.image)))
    .toBe(true);

  const stageBefore = await getCanvasBox(page);
  const panelBefore = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel ? { x: panel.x, y: panel.y } : null;
  });
  const zoomBefore = await page.evaluate(() => window.mangaMaker?.session.get().zoom);
  const panelEdge = await getPanelCanvasPoint(page, { xRatio: 0.5, yRatio: 0 });
  await page.mouse.move(stageBefore.x + panelEdge.x, stageBefore.y + panelEdge.y);
  await page.mouse.down();
  await page.mouse.move(stageBefore.x + panelEdge.x + 50, stageBefore.y + panelEdge.y + 30, {
    steps: 8,
  });
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
        return panel ? { x: panel.x, y: panel.y } : null;
      }),
    )
    .not.toEqual(panelBefore);

  const panelAfter = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel ? { x: panel.x, y: panel.y } : null;
  });
  expect((panelAfter?.x ?? 0) > (panelBefore?.x ?? 0)).toBe(true);
  expect((panelAfter?.y ?? 0) > (panelBefore?.y ?? 0)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels[0]?.y))
    .toBeGreaterThan(panelBefore!.y);

  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().zoom))
    .toBe(zoomBefore);
});

test("pasting an image creates a new panel or replaces an existing one depending on pointer position", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Image Paste Flow");

  // Mocking the paste event requires injecting a clipboard event with a file.
  // Playwright doesn't have a direct `page.keyboard.press('Control+V')` with file natively easy
  // without relying on OS clipboards, so we will dispatch a simulated paste event via evaluate.
  await page.evaluate(async () => {
    const canvasWrap = document.querySelector(".canvas-wrap");
    if (!canvasWrap) return;

    // Fetch our sample image and create a File object
    const response = await fetch("/tests/fixtures/sample-image.svg");
    const blob = await response.blob();
    const file = new File([blob], "sample-image.svg", { type: "image/svg+xml" });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Simulate pointer move to empty space
    const pointerEvent = new PointerEvent("pointermove", {
      clientX: canvasWrap.getBoundingClientRect().left + 150,
      clientY: canvasWrap.getBoundingClientRect().top + 150,
      bubbles: true,
    });
    window.dispatchEvent(pointerEvent);

    const pasteEvent = new ClipboardEvent("paste", {
      clipboardData: dataTransfer,
      bubbles: true,
    });
    window.dispatchEvent(pasteEvent);
  });

  // Verify a new panel was created from pasting on empty space
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels.length))
    .toBe(1);

  // Wait for the image command to finish binding the image
  await expect
    .poll(() => page.evaluate(() => Boolean(window.mangaMaker?.project.get().pages[0]?.panels[0]?.image)))
    .toBe(true);

  // Now create a manual panel elsewhere and paste over it
  await createPanelViaApi(page, { x: 400, y: 400, width: 200, height: 200 });

  await page.evaluate(async () => {
    const canvasWrap = document.querySelector(".canvas-wrap");
    if (!canvasWrap) return;

    const response = await fetch("/tests/fixtures/sample-image.svg");
    const blob = await response.blob();
    const file = new File([blob], "sample-image.svg", { type: "image/svg+xml" });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    // Position over the second panel
    const pointerEvent = new PointerEvent("pointermove", {
      clientX: canvasWrap.getBoundingClientRect().left + 500,
      clientY: canvasWrap.getBoundingClientRect().top + 500,
      bubbles: true,
    });
    window.dispatchEvent(pointerEvent);

    const pasteEvent = new ClipboardEvent("paste", {
      clipboardData: dataTransfer,
      bubbles: true,
    });
    window.dispatchEvent(pasteEvent);
  });

  // Verify the panel count is still 2, meaning it didn't create a third panel
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels.length))
    .toBe(2);

  // Verify the second panel now has an image
  await expect
    .poll(() => page.evaluate(() => Boolean(window.mangaMaker?.project.get().pages[0]?.panels[1]?.image)))
    .toBe(true);
});

test("right-clicking a panel opens a custom context menu and suppresses the browser menu", async ({
  page,
}) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Panel Context Menu");
  await createPanelViaApi(page, { x: 140, y: 160, width: 320, height: 280 });
  await installCanvasContextMenuProbe(page);

  const panelCenter = await getPanelCanvasPoint(page);
  const canvasBox = await getCanvasBox(page);
  await page.mouse.click(canvasBox.x + panelCenter.x, canvasBox.y + panelCenter.y, {
    button: "right",
  });

  await expect(page.getByRole("menu", { name: "Panel Actions" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Import Image" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Add Vertex" })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as Window & { __canvasContextMenuPrevented?: boolean | null }
            ).__canvasContextMenuPrevented ?? null,
        ),
    )
    .toBe(true);

  await page.getByRole("menuitem", { name: "Add Vertex" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels[0]?.points.length))
    .toBe(5);
  await expect(page.getByRole("menu", { name: "Panel Actions" })).toBeHidden();
});

test("a selected panel can be dragged to a new position", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Drag Selected Panel");
  await createPanelViaApi(page, { x: 200, y: 220, width: 300, height: 260 });

  // Select the panel via API to ensure it's selected
  const panelId = await page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels[0]?.id);
  await page.evaluate(
    ({ pid }) => window.mangaMaker?.commands.execute("selectObject", { pageId: window.mangaMaker?.project.get().pages[0]?.id, objectType: "panel", objectId: pid }),
    { pid: panelId },
  );
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().selection?.objectType))
    .toBe("panel");

  const panelBefore = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel ? { x: panel.x, y: panel.y } : null;
  });

  // Drag the selected panel to a new position
  const panelCenter = await getPanelCanvasPoint(page);
  const canvasBox = await getCanvasBox(page);
  await page.mouse.move(canvasBox.x + panelCenter.x, canvasBox.y + panelCenter.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + panelCenter.x + 80, canvasBox.y + panelCenter.y + 60, {
    steps: 8,
  });
  await page.mouse.up();

  // Verify the panel moved
  await expect
    .poll(() =>
      page.evaluate(() => {
        const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
        return panel ? { x: panel.x, y: panel.y } : null;
      }),
    )
    .not.toEqual(panelBefore);

  const panelAfter = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel ? { x: panel.x, y: panel.y } : null;
  });
  expect((panelAfter?.x ?? 0) - (panelBefore?.x ?? 0)).toBeGreaterThan(70);
  expect((panelAfter?.y ?? 0) - (panelBefore?.y ?? 0)).toBeGreaterThan(50);
});

test("text boxes support home-tab font controls and vertical text direction", async ({
  page,
}) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Text Workflow");

  await createTextViaApi(page);

  await page.locator(".right-sidebar textarea").fill("Vertical test");

  const fontCount = await page.locator(".ribbon-font-select option").count();
  expect(fontCount).toBeGreaterThan(10);

  const nextFont = await page.locator(".ribbon-font-select").evaluate((element) => {
    const select = element as HTMLSelectElement;
    return select.options[Math.min(1, select.options.length - 1)].value;
  });

  await page.locator(".ribbon-font-select").selectOption(nextFont);
  await page.locator(".ribbon-font-size").fill("48");
  await page.locator(".ribbon-bar").getByRole("button", { name: "Vertical" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const text = window.mangaMaker?.project.get().pages[0]?.texts[0];
        return text
          ? {
              fontFamily: text.fontFamily,
              fontSize: text.fontSize,
              direction: text.direction,
              content: text.content,
            }
          : null;
      }),
    )
    .toEqual({
      fontFamily: nextFont,
      fontSize: 48,
      direction: "vertical",
      content: "Vertical test",
    });
});

test("the page boundary overlay appears when a selected panel crosses the page edge", async ({
  page,
}) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Boundary Overlay Workflow");

  // Create panel near page edge
  await createPanelViaApi(page, { x: 80, y: 220, width: 160, height: 160 });

  const canvasBox = await getCanvasBox(page);
  const dragStart = await getPanelCanvasPoint(page, {
    xRatio: 0.5,
    yRatio: 0.35,
  });

  // Drag panel to cross page boundary
  await page.mouse.move(canvasBox.x + dragStart.x, canvasBox.y + dragStart.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + dragStart.x - 200, canvasBox.y + dragStart.y, {
    steps: 10,
  });
  await page.mouse.up();

  // Verify panel moved outside page bounds
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels[0]?.x ?? null))
    .toBeLessThan(0);

  await page.evaluate(() => window.mangaMaker?.commands.execute("clearSelection", {}));
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().selection))
    .toBeNull();
});

test("bubble creation and page/project export stay available from the GUI", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Export Workflow");

  await createBubbleViaApi(page);
  await page.locator(".right-sidebar textarea").fill("Bubble dialogue");

  await page.locator(".ribbon-bar").getByRole("button", { name: "Export Page" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().lastExport?.kind))
    .toBe("png");

  await page.evaluate(() => window.mangaMaker?.commands.execute("clearSelection", {}));
  await page
    .locator(".right-sidebar")
    .getByRole("button", { name: "Export project PDF" })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().lastExport?.kind))
    .toBe("pdf");
});

test("canvas defaults to a fit-to-view display and major GUI actions keep command parity", async ({
  page,
}) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Canvas Fit Workflow");

  const layout = await page.evaluate(() => {
    const wrap = document.querySelector(".canvas-wrap") as HTMLDivElement | null;
    const stage = document.querySelector(".canvas-wrap .konvajs-content") as HTMLDivElement | null;
    if (!wrap || !stage) {
      return null;
    }
    return {
      wrapClientWidth: wrap.clientWidth,
      wrapClientHeight: wrap.clientHeight,
      wrapScrollWidth: wrap.scrollWidth,
      wrapScrollHeight: wrap.scrollHeight,
      canvasWidth: stage.getBoundingClientRect().width,
      canvasHeight: stage.getBoundingClientRect().height,
    };
  });

  expect(layout).not.toBeNull();
  expect(layout?.canvasWidth).toBeLessThanOrEqual(layout?.wrapClientWidth ?? 0);
  expect(layout?.canvasHeight).toBeLessThanOrEqual(layout?.wrapClientHeight ?? 0);
  expect(layout?.wrapScrollWidth).toBeLessThanOrEqual(layout?.wrapClientWidth ?? 0);
  expect(layout?.wrapScrollHeight).toBeLessThanOrEqual(layout?.wrapClientHeight ?? 0);

  await createPanelViaApi(page, { x: -60, y: -80, width: 240, height: 240 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
        return panel ? { x: panel.x, y: panel.y } : null;
      }),
    )
    .toEqual({
      x: -60,
      y: -80,
    });

  const defaultCanvas = await getCanvasBox(page);
  const defaultPageMetrics = await getRenderedPageMetrics(page);
  await dragZoomSlider(page, 0.22);
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().zoom))
    .toBeLessThan(0.7);
  await expect(page.locator(".ribbon-zoom-value")).not.toHaveText("100%");

  const zoomedCanvas = await getCanvasBox(page);
  const zoomedPageMetrics = await getRenderedPageMetrics(page);
  // Canvas size may change due to workspace scaling, but should remain reasonable
  expect(zoomedCanvas.width).toBeGreaterThan(0);
  expect(zoomedCanvas.height).toBeGreaterThan(0);
  // Page content should be smaller when zoomed out
  expect(zoomedPageMetrics?.pageWidth ?? 0).toBeLessThan(defaultPageMetrics?.pageWidth ?? 0);
  expect(zoomedPageMetrics?.pageHeight ?? 0).toBeLessThan(defaultPageMetrics?.pageHeight ?? 0);

  await page.evaluate(() => window.mangaMaker?.commands.execute("setZoom", { zoom: 1.02 }));
  const aboveBaselineMetrics = await getRenderedPageMetrics(page);
  expect(aboveBaselineMetrics?.stageWidth).toBeCloseTo(defaultPageMetrics?.stageWidth ?? 0, 1);
  expect(aboveBaselineMetrics?.pageWidth ?? 0).toBeGreaterThan(defaultPageMetrics?.pageWidth ?? 0);
  expect(aboveBaselineMetrics?.workspaceWidth).toBeCloseTo(defaultPageMetrics?.workspaceWidth ?? 0, 1);
  expect(aboveBaselineMetrics?.workspaceHeight).toBeCloseTo(
    defaultPageMetrics?.workspaceHeight ?? 0,
    1,
  );
  expect((aboveBaselineMetrics?.pageWidth ?? 0) / (defaultPageMetrics?.pageWidth ?? 1)).toBeLessThan(
    1.05,
  );

  await page.evaluate(() => window.mangaMaker?.commands.execute("setZoom", { zoom: 1.8 }));
  const highZoomMetrics = await getRenderedPageMetrics(page);
  expect(highZoomMetrics?.workspaceWidth ?? Infinity).toBeLessThanOrEqual(
    (highZoomMetrics?.stageWidth ?? 0) + 1,
  );
  expect(highZoomMetrics?.workspaceHeight ?? Infinity).toBeLessThanOrEqual(
    (highZoomMetrics?.stageHeight ?? 0) + 1,
  );

  const commands = await page.evaluate(() => window.mangaMaker?.commands.list());
  expect(commands).toEqual(
    expect.arrayContaining([
      "addPage",
      "setPageBackground",
      "setPanelImageCrop",
      "addPanelPoint",
      "updateText",
      "exportProjectPdf",
    ]),
  );

  await setColorInput(page, "Page Background", "#ccddee");
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.background))
    .toBe("#ccddee");

  await page.evaluate(() => window.mangaMaker?.commands.execute("addPage", {}));
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages.length))
    .toBe(2);
});

test("local draft recovery restores the saved project after reset", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Draft Recovery");

  await expect
    .poll(() =>
      page.evaluate(() => Boolean(window.localStorage.getItem("mangamaker:draft:v2"))),
    )
    .toBe(true);

  await page.evaluate(() => window.mangaMaker?.project.reset());
  await page.reload();

  await expect(page.getByRole("button", { name: "Restore saved draft" })).toBeVisible();
  await page.getByRole("button", { name: "Restore saved draft" }).click();
  await expect(page.locator(".left-sidebar")).toContainText("Draft Recovery");
  await expect(page.getByRole("button", { name: "Page 1" })).toBeVisible();
});

test("interface copy switches cleanly between English and Chinese", async ({ page }) => {
  await clearDraftAndOpen(page);

  await expect(page.getByText("Turn AI images into a comic page.")).toBeVisible();
  await page.locator(".ribbon-locale").getByRole("button", { name: "中文" }).click();
  await expect(page.getByText("把 AI 图片整理成漫画页面。")).toBeVisible();

  await page.getByLabel("项目标题").fill("双语流程");
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("button", { name: "创建第一页" }).click();
  await expect(page.getByRole("button", { name: "添加页面" })).toBeVisible();
  await expect(page.locator(".onboarding-banner")).toHaveCount(0);
  await expect(page.locator(".right-sidebar")).toContainText("选择“分镜”工具，然后在画布上拖拽。");

  await page.locator(".ribbon-locale").getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Add page" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().locale))
    .toBe("en");
});
