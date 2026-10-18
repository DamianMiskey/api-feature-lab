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

test("caching page: 304 for an unchanged task, 412 for a stale ETag", async ({ page }) => {
  await page.goto("/caching");
  await sendPreset(page, "Create");
  await expect(status(page)).toContainText("201");
  await sendPreset(page, "Get");
  await expect(status(page)).toContainText("200");
  await sendPreset(page, "Get, if changed");
  await expect(status(page)).toContainText("304");
  await sendPreset(page, "Save, if unchanged");
  await expect(status(page)).toContainText("200");
  await sendPreset(page, "Save with an old ETag");
  await expect(status(page)).toContainText("412");
});

test("pagination page: the comparison shows offset repeating a row", async ({ page }) => {
  await page.goto("/pagination");
  await page.getByRole("button", { name: "Run the comparison" }).click();
  const offset = page.locator("div").filter({ has: page.getByRole("heading", { name: "?offset=" }) }).last();
  const cursor = page.locator("div").filter({ has: page.getByRole("heading", { name: "?cursor=" }) }).last();
  await expect(offset.getByText("(again!)")).toHaveCount(1);
  await expect(cursor.getByText("(again!)")).toHaveCount(0);
  // And by hand: the cursor from page 1 fetches page 2.
  await sendPreset(page, "First page");
  await expect(page.locator("dt", { hasText: /^link$/ })).toBeVisible();
  await sendPreset(page, "Next page");
  await expect(status(page)).toContainText("200");
});

test("versioning page: two shapes of one task, and a deprecated version", async ({ page }) => {
  await page.goto("/versioning");
  await sendPreset(page, "Create");
  await sendPreset(page, "Version 2 by header");
  await expect(page.locator("pre").filter({ hasText: '"status": "open"' })).toBeVisible();
  await sendPreset(page, "Unknown version");
  await expect(status(page)).toContainText("400");
  await sendPreset(page, "Deprecated v0");
  await expect(page.locator("dt", { hasText: /^sunset$/ })).toBeVisible();
});
