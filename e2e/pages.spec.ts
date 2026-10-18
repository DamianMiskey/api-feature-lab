import { expect, test } from "@playwright/test";
import { overflow, PAGES, watchErrors } from "./helpers";

// Every page, on desktop and on a phone: it loads, nothing throws or gets
// blocked by the CSP, and nothing is wider than the screen.
for (const path of PAGES) {
  test(`${path} loads cleanly @readonly`, async ({ page }) => {
    const errors = watchErrors(page);
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    // Open every <details> (OpenAPI operations, code) so wide content counts.
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => d.setAttribute("open", "")));
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
    expect(await overflow(page), "page is wider than the screen").toBeLessThanOrEqual(0);
  });
}
