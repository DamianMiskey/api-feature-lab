import { expect, type Page, test } from "@playwright/test";

// The request explorer, driven like a visitor would. These write tasks, so
// they only run locally and in CI.

const status = (page: Page) => page.locator("[aria-live=polite] strong").first();

async function sendPreset(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "Send" }).click();
}

test("REST page: create, then use the new id", async ({ page }) => {
  await page.goto("/rest");
  await sendPreset(page, "Create");
  await expect(status(page)).toContainText("201");
  await expect(page.locator("dt", { hasText: /^location$/ })).toBeVisible();
  await sendPreset(page, "Mark done");
  await expect(status(page)).toContainText("200");
  await expect(page.locator("pre").filter({ hasText: '"done": true' })).toBeVisible();
  await sendPreset(page, "Delete");
  await expect(status(page)).toContainText("204");
  await sendPreset(page, "Delete");
  await expect(status(page)).toContainText("404");
});

test("errors page: each broken request gets the right status", async ({ page }) => {
  await page.goto("/errors");
  for (const [label, code] of [["Two bad fields", "422"], ["Typo in a field", "422"], ["Not JSON", "400"], ["Bad id", "422"], ["Missing task", "404"], ["No such route", "404"]]) {
    await sendPreset(page, label);
    await expect(status(page), label).toContainText(code);
  }
});
