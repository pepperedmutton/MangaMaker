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

const openWelcomeWithExistingProjects = async (page: Page) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await clearStoredProjectDrafts(page);
  await page.reload();
  await page.getByLabel("Project title").fill("Legacy Project");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Create your first page" }).click();
  await expect
    .poll(() => page.evaluate(() => window.mangaMaker?.project.get().pages.length))
    .toBe(1);
  await page.getByRole("button", { name: "Home" }).click();
  await expect(page.locator(".welcome-project-card").first()).toBeVisible();
};

test("legacy project can be renamed and home returns to welcome", async ({ page }) => {
  await openWelcomeWithExistingProjects(page);

  await page.locator(".welcome-project-card").first().click();
  await expect(page.locator(".left-sidebar")).toBeVisible();

  const originalTitle = await page
    .locator(".sidebar-project-title")
    .inputValue();
  const nextTitle = `${originalTitle || "Legacy Project"} Renamed`;

  await page.locator(".sidebar-project-title").fill(nextTitle);
  await page.locator(".ribbon-bar").click();

  await expect
    .poll(() =>
      page.evaluate(() => window.mangaMaker?.project.get().title ?? ""),
    )
    .toBe(nextTitle);

  await page.getByRole("button", { name: "Home" }).click();
  await expect(page.getByText("Existing projects")).toBeVisible();
  await expect(
    page.locator(".welcome-project-meta strong").filter({ hasText: nextTitle }),
  ).toHaveCount(1);
});
