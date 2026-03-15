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
  const canvas = page.locator(".canvas-wrap canvas").first();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Canvas not available");
  }
  return box;
};

const setZoomSlider = async (page: Page, zoom: number) => {
  await page.getByLabel("Zoom").evaluate((element, value) => {
    const input = element as HTMLInputElement;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, zoom);
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
      const panel = currentPage?.panels[panelIndex ?? 0];
      const canvas = document.querySelector(".canvas-wrap canvas") as HTMLCanvasElement | null;
      if (!currentPage || !panel || !canvas) {
        return null;
      }

      const rect = canvas.getBoundingClientRect();
      const workspaceScaleFactor = 1 / Math.sqrt(0.8);
      const workspaceWidth = currentPage.width * workspaceScaleFactor;
      const workspaceHeight = currentPage.height * workspaceScaleFactor;
      const offsetX = (workspaceWidth - currentPage.width) * 0.5;
      const offsetY = (workspaceHeight - currentPage.height) * 0.5;
      const point = {
        x: panel.x + panel.width * (xRatio ?? 0.5) + (xOffset ?? 0),
        y: panel.y + panel.height * (yRatio ?? 0.5) + (yOffset ?? 0),
      };

      return {
        x: (offsetX + point.x) * (rect.width / workspaceWidth),
        y: (offsetY + point.y) * (rect.height / workspaceHeight),
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
      { x: 110, y: 110 },
      { x: 265, y: 140 },
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
    const canvas = document.querySelector(".canvas-wrap canvas") as HTMLCanvasElement | null;
    if (!currentPage || !canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    const workspaceScaleFactor = 1 / Math.sqrt(0.8);
    const workspaceWidth = currentPage.width * workspaceScaleFactor;
    const workspaceHeight = currentPage.height * workspaceScaleFactor;
    const offsetX = (workspaceWidth - currentPage.width) * 0.5;
    const offsetY = (workspaceHeight - currentPage.height) * 0.5;
    const canvasX = (offsetX + pagePoint.x) * (rect.width / workspaceWidth);
    const canvasY = (offsetY + pagePoint.y) * (rect.height / workspaceHeight);
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
  await expect(page.locator(".onboarding-banner")).toContainText("Add a panel");
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

  const previewSamplePoint = await getSelectedPanelPreviewSamplePoint(page);
  const selectedPreviewPixel = await readCanvasPixelAtPagePoint(page, previewSamplePoint);
  const panelCenter = await getPanelCanvasPoint(page);
  const canvasBox = await getCanvasBox(page);
  const panelPositionBeforeImageDrag = await page.evaluate(() => {
    const panel = window.mangaMaker?.project.get().pages[0]?.panels[0];
    return panel ? { x: panel.x, y: panel.y } : null;
  });

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

  await page.mouse.move(canvasBox.x + panelCenter.x, canvasBox.y + panelCenter.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + panelCenter.x + 60, canvasBox.y + panelCenter.y + 24, {
    steps: 8,
  });
  await page.mouse.up();

  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.mangaMaker?.project.get().pages[0]?.panels[0]?.image?.viewBox.x ?? null,
        ),
      { timeout: 3000 },
    )
    .toBeLessThan(zoomedViewBox?.x ?? Infinity);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.mangaMaker?.project.get().pages[0]?.panels[0]?.image?.viewBox.y ?? null,
        ),
      { timeout: 3000 },
    )
    .toBeLessThan(zoomedViewBox?.y ?? Infinity);
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

  await page.evaluate(() => window.mangaMaker?.commands.execute("clearSelection", {}));
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().selection))
    .toBeNull();

  const unselectedPreviewPixel = await readCanvasPixelAtPagePoint(page, previewSamplePoint);
  const pixelDifference = selectedPreviewPixel.reduce(
    (total, channel, index) => total + Math.abs(channel - unselectedPreviewPixel[index]),
    0,
  );
  expect(pixelDifference).toBeGreaterThan(40);
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
    const canvas = document.querySelector(".canvas-wrap canvas") as HTMLCanvasElement | null;
    if (!wrap || !canvas) {
      return null;
    }
    return {
      wrapClientWidth: wrap.clientWidth,
      wrapClientHeight: wrap.clientHeight,
      wrapScrollWidth: wrap.scrollWidth,
      wrapScrollHeight: wrap.scrollHeight,
      canvasWidth: canvas.getBoundingClientRect().width,
      canvasHeight: canvas.getBoundingClientRect().height,
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
  await setZoomSlider(page, 0.62);
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().zoom))
    .toBe(0.62);
  await expect(page.locator(".ribbon-zoom-value")).toHaveText("62%");

  const zoomedCanvas = await getCanvasBox(page);
  expect(zoomedCanvas.width).toBeLessThan(defaultCanvas.width);
  expect(zoomedCanvas.height).toBeLessThan(defaultCanvas.height);

  const commands = await page.evaluate(() => window.mangaMaker?.commands.list());
  expect(commands).toEqual(
    expect.arrayContaining([
      "addPage",
      "setPanelImageCrop",
      "addPanelPoint",
      "updateText",
      "exportProjectPdf",
    ]),
  );

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
  await expect(page.locator(".onboarding-banner")).toContainText("添加分镜");

  await page.locator(".ribbon-locale").getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Add page" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.session.get().locale))
    .toBe("en");
});
