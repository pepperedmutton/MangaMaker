import { expect, test, type Page } from "@playwright/test";

const openWelcomeWithExistingProjects = async (page: Page) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
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
