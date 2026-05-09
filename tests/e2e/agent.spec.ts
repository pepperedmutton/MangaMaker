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

const rightSidebarModeToggle = (page: Page) => page.locator('[aria-label="Right sidebar mode"]');

const openAgent = async (page: Page) => {
  await rightSidebarModeToggle(page).getByRole("button", { name: "Agent" }).click();
};

const openInspector = async (page: Page) => {
  await rightSidebarModeToggle(page).getByRole("button", { name: "Inspector" }).click();
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
  const documents = await page.evaluate(async () => {
    const projectId = window.mangaMaker!.project.get().id;
    const response = await fetch(`/__mangamaker__/agent/documents?projectId=${encodeURIComponent(projectId)}`);
    return response.json();
  });
  expect(documents.documents).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "production-plan", path: "docs/production/production-plan.md" })]),
  );
  expect(documents.roles).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "producer", metadocId: "production-plan" })]),
  );

  await page.locator(".ribbon-bar").getByRole("button", { name: "Docs" }).click();
  await expect(page.getByLabel("Project document workspace")).toContainText("Project document files");
  await expect(page.locator(".left-sidebar")).not.toContainText("Project documents");
  await expect(page.getByLabel("Project document files")).toContainText("production-plan.md");
  await page.getByLabel("Project document files").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New document" }).click();
  await expect(page.getByRole("dialog", { name: "New Markdown document" })).toBeVisible();
  await page.getByLabel("New document title").fill("Scene Notes");
  await page.locator("#new-document-role").selectOption("scriptDesigner");
  await page.locator("#new-document-path").fill("docs/script/scene-notes.md");
  await page.getByRole("dialog", { name: "New Markdown document" }).getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Rendered Markdown document")).toContainText("Scene Notes");
  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.getByLabel("Project document files")).toContainText("scene-notes.md");
  await page.getByLabel("Project document files").getByRole("button", { name: /scene-notes\.md/i }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename document" }).click();
  await expect(page.getByRole("dialog", { name: "Rename Markdown document" })).toBeVisible();
  await page.getByLabel("Rename document path").fill("docs/script/renamed-scene-notes.md");
  await page.getByRole("dialog", { name: "Rename Markdown document" }).getByRole("button", { name: "Rename" }).click();
  await expect(page.getByLabel("Rendered Markdown document")).toContainText("Scene Notes");
  await page.getByRole("button", { name: "Files" }).click();
  await expect(page.getByLabel("Project document files")).toContainText("renamed-scene-notes.md");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/document?projectId=${encodeURIComponent(projectId)}&documentId=scene-notes`);
        const document = (await response.json()) as { path?: string };
        return document.path ?? "";
      }),
    )
    .toBe("docs/script/renamed-scene-notes.md");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(
          `/__mangamaker__/agent/document?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent("renamed-scene-notes.md")}`,
        );
        if (!response.ok) {
          return null;
        }
        const document = (await response.json()) as { id?: string; path?: string };
        return { id: document.id, path: document.path };
      }),
    )
    .toEqual({ id: "scene-notes", path: "docs/script/renamed-scene-notes.md" });
  const roleCreateResult = await page.evaluate(async () => {
    const projectId = window.mangaMaker!.project.get().id;
    const createResponse = await fetch("/__mangamaker__/agent/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        role: {
          id: "scene-supervisor",
          name: "Scene Supervisor",
          title: "Scene metadoc test role",
          metadocId: "scene-notes",
        },
      }),
    });
    if (!createResponse.ok) {
      throw new Error(await createResponse.text());
    }
    const created = (await createResponse.json()) as { roles?: Array<{ id: string; metadocId: string }> };
    return created.roles?.some((role) => role.id === "scene-supervisor" && role.metadocId === "scene-notes") ?? false;
  });
  expect(roleCreateResult).toBe(true);
  const roleDeleteResult = await page.evaluate(async () => {
    const projectId = window.mangaMaker!.project.get().id;
    const response = await fetch(`/__mangamaker__/agent/role?projectId=${encodeURIComponent(projectId)}&roleId=scene-supervisor`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const manifest = (await response.json()) as {
      documents?: Array<{ id: string }>;
      roles?: Array<{ id: string }>;
    };
    return {
      roleDeleted: !(manifest.roles?.some((role) => role.id === "scene-supervisor") ?? false),
      metadocKept: manifest.documents?.some((document) => document.id === "scene-notes") ?? false,
    };
  });
  expect(roleDeleteResult).toEqual({ roleDeleted: true, metadocKept: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Project document files").getByRole("button", { name: /renamed-scene-notes\.md/i }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete document" }).click();
  await expect(page.getByLabel("Project document files")).not.toContainText("renamed-scene-notes.md");
  await page.getByLabel("Project document files").getByRole("button", { name: /production-plan\.md/i }).click();
  await expect(page.getByLabel("Rendered Markdown document")).toContainText("Production Plan");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Markdown document editor").fill("# Production Plan\n\n## E2E\n\nDocument mode is durable.\n");
  await page.getByLabel("Project document workspace").getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Rendered Markdown document")).toContainText("Document mode is durable.");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/document?projectId=${encodeURIComponent(projectId)}&documentId=production-plan`);
        const document = (await response.json()) as { content?: string };
        return document.content ?? "";
      }),
    )
    .toContain("Document mode is durable.");
  await page.getByRole("button", { name: "Files" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Project document files").getByRole("button", { name: /production-plan\.md/i }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete document" }).click();
  await expect(page.getByLabel("Project document files")).not.toContainText("production-plan.md");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/documents?projectId=${encodeURIComponent(projectId)}`);
        const manifest = (await response.json()) as {
          documents?: Array<{ id: string }>;
          roles?: Array<{ id: string; metadocId: string }>;
        };
        return {
          documentRecreated: manifest.documents?.some((document) => document.id === "production-plan") ?? false,
          producerRoleKept: manifest.roles?.some((role) => role.id === "producer" || role.metadocId === "production-plan") ?? false,
        };
      }),
    )
    .toEqual({ documentRecreated: false, producerRoleKept: false });
  await page.locator(".ribbon-bar").getByRole("button", { name: "Comic" }).click();

  await expect(page.locator(".ribbon-bar").getByRole("button", { name: "Agent" })).toHaveCount(0);
  await expect(rightSidebarModeToggle(page)).toBeVisible();
  await openAgent(page);
  await expect(page.getByLabel("Agent sidebar")).toBeVisible();
  await expect(page.getByLabel("Agent role")).toContainText("Assistant");
  await expect(page.getByLabel("Agent role")).toContainText("Metadoc");
  await expect(page.getByLabel("Agent configuration status")).toContainText("Test mode");
  await expect(page.getByLabel("Agent context summary")).toHaveCount(0);
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
        const [tracesResponse, debugResponse] = await Promise.all([
          fetch("/__mangamaker__/agent/traces?limit=5"),
          fetch("/__mangamaker__/agent/debug"),
        ]);
        const tracesPayload = await tracesResponse.json();
        const debug = await debugResponse.json();
        const latestTrace = tracesPayload.traces?.[0];
        return {
          serverTraceStatus: latestTrace?.status ?? null,
          serverTraceProvider: latestTrace?.provider ?? null,
          hasServerReceived: Boolean(
            latestTrace?.events?.some((entry: { phase?: string }) => entry.phase === "server_received"),
          ),
          hasServerResponseReady: Boolean(
            latestTrace?.events?.some((entry: { phase?: string }) => entry.phase === "server_response_ready"),
          ),
          debugHasTrace: Boolean(
            debug.requestTraces?.some((entry: { requestId?: string }) => entry.requestId === latestTrace?.requestId),
          ),
        };
      }),
    )
    .toEqual({
      serverTraceStatus: "success",
      serverTraceProvider: "test",
      hasServerReceived: true,
      hasServerResponseReady: true,
      debugHasTrace: true,
    });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const debugResponse = await fetch("/__mangamaker__/agent/debug");
        const debug = await debugResponse.json();
        const runId = debug.activeRun?.id;
        const projectId = window.mangaMaker!.project.get().id;
        if (!runId) {
          return null;
        }
        const runResponse = await fetch(
          `/__mangamaker__/agent/runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(projectId)}`,
        );
        const run = await runResponse.json();
        return {
          status: run.status,
          latestMessage: run.latestResponse?.message ?? "",
          hasModelRequest: Boolean(run.steps?.some((step: { kind?: string }) => step.kind === "model_request")),
        };
      }),
    )
    .toEqual({
      status: "completed",
      latestMessage: expect.stringContaining("Agent Workflow"),
      hasModelRequest: true,
    });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/conversation-context?projectId=${encodeURIComponent(projectId)}&roleId=assistant`);
        if (!response.ok) {
          throw new Error(`Failed to read Agent conversation context: ${response.status}`);
        }
        const context = (await response.json()) as {
          roleId?: string;
          storagePath?: string;
          messages?: Array<{ role: string; content: string }>;
        } | null;
        return {
          roleId: context?.roleId ?? null,
          storagePath: context?.storagePath ?? null,
          hasPrompt: Boolean(
            context?.messages?.some((message) => message.content.includes("What is the title")),
          ),
        };
      }),
    )
    .toEqual({
      roleId: "assistant",
      storagePath: expect.stringContaining("agent-conversation-context.json"),
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

  await openInspector(page);
  await openAgent(page);
  await expect(page.getByLabel("Agent messages")).toContainText("What is the title and page count?");
  const agentConfig = page.locator('details[aria-label="Agent manual config"]');
  if (!(await agentConfig.evaluate((details: HTMLDetailsElement) => details.open))) {
    await page.getByText("Agent Config", { exact: true }).click();
  }
  await expect(page.getByLabel("Agent conversation context editor")).toContainText("Conversation Context");
  await page.getByRole("button", { name: "Clear context" }).click();
  await expect(page.getByLabel("Agent messages")).not.toContainText("What is the title and page count?");
  await expect(page.getByLabel("Agent messages")).not.toContainText("conversationContext");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/conversation-context?projectId=${encodeURIComponent(projectId)}&roleId=assistant`);
        return response.json();
      }),
    )
    .toBeNull();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const response = await fetch("/__mangamaker__/agent/debug");
        const debug = await response.json();
        return Boolean(
          debug.toolLogs?.some((entry: { label: string }) => entry.label === "conversationContext"),
        );
      }),
    )
    .toBe(false);
  await openInspector(page);
  await openAgent(page);
  await expect(page.getByLabel("Agent messages")).not.toContainText("What is the title and page count?");

  await askAgent(page, "Use screenshot tool to inspect the current page render.");
  await expect(page.getByLabel("Agent messages")).toContainText("I inspected 1 rendered page screenshot");
  await expect(page.getByLabel("Agent messages")).toContainText("renderPage");
  await expect(page.getByLabel("Agent messages")).toContainText("success");
  await expect(page.getByLabel("Agent tool log")).toHaveCount(0);

  await askAgent(page, "Read a few pages / several pages and summarize them.");
  await expect(page.getByLabel("Agent messages")).toContainText("rendered sample");
  await expect(page.getByLabel("Agent messages")).toContainText("renderPages");

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

  await openAgent(page);
  await expect(page.getByLabel("Agent messages")).toContainText("Ready");
  await expect(page.getByLabel("Agent configuration status")).toContainText("Test mode");
  await expect(page.getByLabel("Agent context summary")).toHaveCount(0);
  const selectedText = await page.evaluate(() => {
    const paragraph = document.querySelector(".agent-message-assistant p");
    if (!paragraph?.firstChild) {
      throw new Error("Agent message paragraph not found");
    }
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selected = selection?.toString() ?? "";
    document.execCommand("copy");
    return selected;
  });
  expect(selectedText).toBe("Ready");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Ready");
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).not.toContain("data:image");
});

test("agent config edits system prompt and conversation context", async ({ page }) => {
  let capturedSystemPrompt = "";
  let capturedMessages: Array<{ role: string; content: string }> = [];
  await page.route("**/__mangamaker__/agent/runs", async (route) => {
    const payload = route.request().postDataJSON() as {
      systemPrompt?: string;
      messages?: Array<{ role: string; content: string }>;
      agentContext?: { project?: { id?: string } };
      activeRoleId?: string;
    };
    capturedSystemPrompt = payload.systemPrompt ?? "";
    capturedMessages = payload.messages ?? [];
    const now = new Date().toISOString();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        id: "agent-run-e2e-config",
        projectId: payload.agentContext?.project?.id ?? "project-e2e",
        roleId: payload.activeRoleId ?? "assistant",
        status: "completed",
        createdAt: now,
        updatedAt: now,
        modelTurnIndex: 1,
        steps: [],
        trace: [],
        pendingToolCalls: [],
        latestResponse: {
          message: "Config payload received",
          pendingCommandPlan: null,
        },
      }),
    });
  });

  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Agent Config UI");
  await openAgent(page);
  await expect(page.getByLabel("Agent sidebar")).toBeVisible();

  await page.getByText("Agent Config", { exact: true }).click();
  await page.getByLabel("Agent system prompt").fill("Custom system prompt for E2E.");
  await page.getByLabel("Context message 1 content").fill("Edited assistant context.");
  await expect(page.getByLabel("Agent messages")).toContainText("Edited assistant context.");

  await askAgent(page, "Send config payload");
  await expect(page.getByLabel("Agent messages")).toContainText("Config payload received");
  expect(capturedSystemPrompt).toBe("Custom system prompt for E2E.");
  expect(capturedMessages).toEqual([
    { role: "assistant", content: "Edited assistant context." },
    { role: "user", content: "Send config payload" },
  ]);
});

test("agent conversation context switches with the active role", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Role Sessions");
  await openAgent(page);
  await expect(page.getByLabel("Agent sidebar")).toBeVisible();

  await page.getByText("Agent Config", { exact: true }).click();
  await page.getByLabel("Context message 1 content").fill("Assistant session note.");
  await expect(page.getByLabel("Agent messages")).toContainText("Assistant session note.");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/conversation-context?projectId=${encodeURIComponent(projectId)}&roleId=assistant`);
        const context = (await response.json()) as { messages?: Array<{ content: string }> } | null;
        return Boolean(context?.messages?.some((message) => message.content.includes("Assistant session note.")));
      }),
    )
    .toBe(true);

  await page.getByLabel("Active role").selectOption("producer");
  await expect(page.getByLabel("Agent messages")).not.toContainText("Assistant session note.");
  await expect(page.getByRole("button", { name: "Clear context" })).toBeEnabled();
  await page.getByLabel("Context message 1 content").fill("Producer session note.");
  await expect(page.getByLabel("Agent messages")).toContainText("Producer session note.");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/conversation-context?projectId=${encodeURIComponent(projectId)}&roleId=producer`);
        const context = (await response.json()) as { roleId?: string; messages?: Array<{ content: string }> } | null;
        return {
          roleId: context?.roleId ?? null,
          hasProducerNote: Boolean(context?.messages?.some((message) => message.content.includes("Producer session note."))),
        };
      }),
    )
    .toEqual({
      roleId: "producer",
      hasProducerNote: true,
    });

  await page.getByLabel("Active role").selectOption("assistant");
  await expect(page.getByLabel("Agent messages")).toContainText("Assistant session note.");
  await expect(page.getByLabel("Agent messages")).not.toContainText("Producer session note.");
  await page.getByRole("button", { name: "Clear context" }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const [assistantResponse, producerResponse] = await Promise.all([
          fetch(`/__mangamaker__/agent/conversation-context?projectId=${encodeURIComponent(projectId)}&roleId=assistant`),
          fetch(`/__mangamaker__/agent/conversation-context?projectId=${encodeURIComponent(projectId)}&roleId=producer`),
        ]);
        const assistantContext = await assistantResponse.json();
        const producerContext = (await producerResponse.json()) as { messages?: Array<{ content: string }> } | null;
        return {
          assistantCleared: assistantContext === null,
          producerStillPresent: Boolean(
            producerContext?.messages?.some((message) => message.content.includes("Producer session note.")),
          ),
        };
      }),
    )
    .toEqual({
      assistantCleared: true,
      producerStillPresent: true,
    });
});

test("agent warns when a response did not use visual input", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Vision Warning");
  await openAgent(page);

  await askAgent(page, "vision warning");

  await expect(page.getByLabel("Agent configuration status")).toContainText("canvas image was not used");
  await expect(page.getByLabel("Agent messages")).toContainText("without visual input");
});

test("agent pauses with continue and stop controls when the tool budget is exhausted", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Tool Budget");
  await openAgent(page);

  await askAgent(page, "tool budget loop");

  await expect(page.getByLabel("Agent messages")).toContainText("Tool budget reached");
  await expect(page.getByLabel("Agent messages")).toContainText("paused instead of answering from incomplete evidence");
  await expect(page.getByLabel("Agent messages")).not.toContainText("more tool calls than the current safety limit");
  await expect(page.getByLabel("Agent messages")).not.toContainText("answering from the pages and resources already inspected");
  await expect(page.getByLabel("Paused Agent run")).toContainText("Pending tool requests");
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByLabel("Paused Agent run")).toHaveCount(0);
});

test("agent document write completes after tool result without leaking document body into logs", async ({ page }) => {
  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Document Write");
  await openAgent(page);

  await askAgent(page, "write document");

  await expect(page.getByLabel("Agent messages")).toContainText("I updated the durable Markdown document.");
  await expect(page.getByLabel("Agent messages")).toContainText("writeDocument");
  await expect(page.getByLabel("Agent messages")).toContainText("contentLength=");
  await expect(page.getByLabel("Agent messages")).not.toContainText("The test Agent can write durable Markdown documents.");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const projectId = window.mangaMaker!.project.get().id;
        const response = await fetch(`/__mangamaker__/agent/document?projectId=${encodeURIComponent(projectId)}&documentId=production-plan`);
        if (!response.ok) {
          return null;
        }
        const document = (await response.json()) as { content?: string };
        return document.content?.includes("The test Agent can write durable Markdown documents.") ?? false;
      }),
    )
    .toBe(true);
});

test("agent clears pending tool status when a metadoc read fails", async ({ page }) => {
  await page.route("**/__mangamaker__/agent/document?**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.searchParams.get("documentId") === "assistant-metadoc") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "simulated metadoc failure" }),
      });
      return;
    }
    await route.continue();
  });

  await clearDraftAndOpen(page);
  await createProjectAndFirstPage(page, "Metadoc Failure");
  await openAgent(page);

  await askAgent(page, "Trigger metadoc read failure");

  await expect(page.getByLabel("Agent messages")).toContainText("simulated metadoc failure");
  await expect(page.locator(".agent-tool-status").filter({ hasText: "pending" })).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch("/__mangamaker__/agent/debug");
        const debug = await response.json();
        return {
          busy: debug.busy,
          activeToolCall: debug.activeToolCall?.label ?? null,
          pendingCount: debug.toolLogs?.filter(
            (entry: { status: string }) => entry.status === "pending",
          ).length ?? 0,
        };
      }),
    )
    .toEqual({
      busy: false,
      activeToolCall: null,
      pendingCount: 0,
    });
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
  await openAgent(page);

  await expect(page.getByLabel("Agent configuration status")).toContainText("OPENROUTER_API_KEY");
  await expect(page.getByLabel("Agent prompt")).toBeDisabled();
});
