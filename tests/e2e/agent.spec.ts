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
        // Keep clearing the rest of the isolated E2E drafts.
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

const createProjectAndFirstPage = async (page: Page, title: string) => {
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Create your first page" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages.length))
    .toBe(1);
};

const askAgent = async (page: Page, prompt: string) => {
  await page.getByLabel("Agent prompt").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
};

test("agent opens, reports test config, validates plans, and executes through commands", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Agent Workflow");
  const contextFixture = await page.evaluate(async () => {
    const project = window.mangaMaker!.project.get();
    const firstPageId = project.pages[0].id;
    const secondPage = (await window.mangaMaker!.commands.execute("addPage", {
      name: "Reference page",
    })) as { id: string };
    await window.mangaMaker!.commands.execute("createText", {
      pageId: secondPage.id,
      x: 80,
      y: 120,
      content: "Reference note",
    });
    await window.mangaMaker!.commands.execute("selectPage", { pageId: firstPageId });
    return { firstPageId, secondPageId: secondPage.id };
  });

  const config = await page.evaluate(async () => {
    const response = await fetch("/__mangamaker__/agent/config");
    return response.json();
  });
  expect(config).toMatchObject({
    enabled: true,
    provider: "test",
    testMode: true,
    visionEnabled: true,
  });
  const models = await page.evaluate(async () => {
    const response = await fetch("/__mangamaker__/agent/models");
    return response.json();
  });
  expect(models).toEqual([
    expect.objectContaining({
      id: "moonshotai/kimi-k2.6",
      inputModalities: expect.arrayContaining(["image"]),
      outputModalities: expect.arrayContaining(["text"]),
    }),
  ]);

  await page.locator(".ribbon-bar").getByRole("button", { name: "Agent" }).click();
  await expect(page.getByLabel("Agent sidebar")).toBeVisible();
  await expect(page.getByLabel("Agent configuration status")).toContainText("Test mode");
  await expect(page.getByLabel("Agent context summary")).toContainText("Agent Workflow");
  await expect
    .poll(async () =>
      page.evaluate(async ({ secondPageId }) => {
        const response = await fetch("/__mangamaker__/agent/debug");
        const debug = await response.json();
        return {
          mounted: debug.mounted,
          projectTitle: debug.context?.projectTitle,
          pageCount: debug.context?.pageCount,
          totalObjectCount: debug.context?.totalObjectCount,
          currentPageId: debug.context?.currentPageId,
          referencePageObjectCount: debug.context?.pages?.find(
            (entry: { id: string }) => entry.id === secondPageId,
          )?.objectCount,
          hasDataUrl: Boolean(debug.context?.canvasSnapshot?.available),
        };
      }, { secondPageId: contextFixture.secondPageId }),
    )
    .toEqual({
      mounted: true,
      projectTitle: "Agent Workflow",
      pageCount: 2,
      totalObjectCount: 1,
      currentPageId: contextFixture.firstPageId,
      referencePageObjectCount: 1,
      hasDataUrl: true,
    });
  await expect
    .poll(() =>
      page.evaluate(() => window.mangaMaker?.agent.getDebugSnapshot()?.context.projectTitle ?? null),
    )
    .toBe("Agent Workflow");

  const createTextManifest = await page.evaluate(() =>
    window.mangaMaker?.commands.describe().find((command) => command.id === "createText"),
  );
  expect(createTextManifest).toMatchObject({
    id: "createText",
    label: "Create Text",
    recordHistory: true,
    mutatesProject: true,
    dangerLevel: "normal",
  });
  expect(createTextManifest?.inputJsonSchema).toBeTruthy();
  expect(createTextManifest?.guiEquivalent).toContain("Text");

  await askAgent(page, "What is the title and page count?");
  await expect(page.getByLabel("Agent messages")).toContainText("Agent Workflow");
  await expect(page.getByLabel("Agent messages")).toContainText("2 pages");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/history?projectId=${encodeURIComponent(projectId)}`);
        if (!response.ok) {
          throw new Error(`Failed to read Agent history: ${response.status}`);
        }
        const history = (await response.json()) as {
          storagePath?: string;
          messages?: Array<{ role: string; content: string }>;
        } | null;
        return {
          storagePath: history?.storagePath ?? null,
          hasPrompt: Boolean(
            history?.messages?.some((message) => message.content.includes("What is the title")),
          ),
        };
      }),
    )
    .toEqual({
      storagePath: expect.stringContaining("agent-chat.json"),
      hasPrompt: true,
    });
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch("/__mangamaker__/agent/debug");
        const debug = await response.json();
        return {
          busy: debug.busy,
          activeToolCall: debug.activeToolCall?.label ?? null,
          lastToolStatus: debug.toolLogs?.[0]?.status ?? null,
          includesReadContextSuccess: Boolean(
            debug.toolLogs?.some((entry: { label: string; status: string }) => entry.label === "readContext" && entry.status === "success"),
          ),
        };
      }),
    )
    .toEqual({
      busy: false,
      activeToolCall: null,
      lastToolStatus: "success",
      includesReadContextSuccess: true,
    });

  await page.getByRole("button", { name: "Inspector" }).click();
  await page.locator(".ribbon-bar").getByRole("button", { name: "Agent" }).click();
  await expect(page.getByLabel("Agent messages")).toContainText("What is the title and page count?");
  await expect(page.getByLabel("Agent chat history status")).toContainText("Saved for this project until deleted.");
  await page.getByRole("button", { name: "Delete chat" }).click();
  await expect(page.getByLabel("Agent messages")).not.toContainText("What is the title and page count?");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/history?projectId=${encodeURIComponent(projectId)}`);
        return response.json();
      }),
    )
    .toBeNull();
  await page.getByRole("button", { name: "Inspector" }).click();
  await page.locator(".ribbon-bar").getByRole("button", { name: "Agent" }).click();
  await expect(page.getByLabel("Agent messages")).not.toContainText("What is the title and page count?");

  await askAgent(page, "Use screenshot tool to inspect the current page render.");
  await expect(page.getByLabel("Agent messages")).toContainText("I inspected 1 rendered page screenshot");
  await expect(page.getByLabel("Agent tool log")).toContainText("renderPage");
  await expect(page.getByLabel("Agent tool log")).toContainText("success");

  await askAgent(page, "Read a few pages / several pages and summarize them.");
  await expect(page.getByLabel("Agent messages")).toContainText("rendered sample");
  await expect(page.getByLabel("Agent tool log")).toContainText("renderPages");

  await askAgent(page, "Create a panel");
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels.length))
    .toBe(1);

  await page.keyboard.press("Control+KeyZ");
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels.length))
    .toBe(0);
  await page.keyboard.press("Control+KeyY");
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.panels.length))
    .toBe(1);

  await askAgent(page, "Add text: Hello");
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages[0]?.texts[0]?.content))
    .toBe("Hello");

  await askAgent(page, "Set text stroke red width 4");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const text = window.mangaMaker?.project.get().pages[0]?.texts[0];
        return text ? { strokeColor: text.strokeColor, strokeWidth: text.strokeWidth } : null;
      }),
    )
    .toEqual({ strokeColor: "#ff0000", strokeWidth: 4 });

  const pageCountBeforeDeletePlan = await page.evaluate(
    () => window.mangaMaker?.project.get().pages.length ?? 0,
  );
  await askAgent(page, "Delete current page");
  await expect(page.getByLabel("Pending command plan")).toContainText("Needs confirmation");
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages.length ?? 0))
    .toBe(pageCountBeforeDeletePlan);

  await page.getByRole("button", { name: "Confirm" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages.length ?? 0))
    .toBe(pageCountBeforeDeletePlan - 1);
});

test("agent message copy writes selected plain text only", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Agent Copy");

  await page.locator(".ribbon-bar").getByRole("button", { name: "Agent" }).click();
  await expect(page.getByLabel("Agent messages")).toContainText("Ready");
  await page.evaluate(() => {
    const paragraph = document.querySelector(".agent-message p");
    if (!paragraph?.firstChild) {
      throw new Error("Agent message paragraph not found");
    }
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Control+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Ready");
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).not.toContain("data:image");
});

test("agent warns when a response did not use visual input", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Vision Warning");
  await page.locator(".ribbon-bar").getByRole("button", { name: "Agent" }).click();

  await askAgent(page, "vision warning");

  await expect(page.getByLabel("Agent configuration status")).toContainText("canvas image was not used");
  await expect(page.getByLabel("Agent messages")).toContainText("without visual input");
});

test("agent answers from gathered context when the tool budget is exhausted", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Tool Budget");
  await page.locator(".ribbon-bar").getByRole("button", { name: "Agent" }).click();

  await askAgent(page, "tool budget loop");

  await expect(page.getByLabel("Agent messages")).toContainText("tool budget");
  await expect(page.getByLabel("Agent messages")).not.toContainText("more tool calls than the current safety limit");
  await expect(page.getByLabel("Agent configuration status")).toContainText("Tool budget reached");
});

test("agent disables chat when configuration is unavailable", async ({ page }) => {
  await page.route("**/__mangamaker__/agent/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: false,
        provider: "unavailable",
        model: null,
        apiKeyConfigured: false,
        testMode: false,
        visionEnabled: false,
        reason: "OPENROUTER_API_KEY is not configured.",
      }),
    });
  });

  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Unconfigured Agent");
  await page.locator(".ribbon-bar").getByRole("button", { name: "Agent" }).click();

  await expect(page.getByLabel("Agent configuration status")).toContainText("OPENROUTER_API_KEY");
  await expect(page.getByLabel("Agent prompt")).toBeDisabled();
});
