import { expect, test } from "@playwright/test";

// The Portability page asks this deployment and the Workers one. Locally
// there's no Worker, so its requests are answered by the local server
// instead (same app, same database); against production the real pair runs.

const WORKERS = "https://api-cf.djmiskey.com";

test("ask both, and a score written here is readable there", async ({ page, baseURL }) => {
  await page.route(`${WORKERS}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(WORKERS, baseURL!) });
    await route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
  });
  await page.goto("/portability");
  await page.getByRole("button", { name: "Ask both" }).click();
  await expect(page.getByTestId("same-data")).toContainText("exactly the same", { timeout: 20_000 });
  await expect(page.locator('[data-target="Cloudflare Workers"]')).toContainText("to the database");
  await page.getByRole("button", { name: "Write on Vercel, read on Workers" }).click();
  await expect(page.getByTestId("cross-write")).toContainText("already lists it");
});

test("the real pair: Vercel and Cloudflare Workers, one database @deployed", async ({ page }) => {
  await page.goto("/portability");
  await page.getByRole("button", { name: "Ask both" }).click();
  await expect(page.getByTestId("same-data")).toContainText("exactly the same", { timeout: 30_000 });
  await expect(page.locator('[data-target="Vercel"]')).toContainText("vercel");
  await expect(page.locator('[data-target="Cloudflare Workers"]')).toContainText("cloudflare-workers");
  await expect(page.locator('[data-target="Cloudflare Workers"]')).toContainText("Cloudflare-Workers");
  await page.getByRole("button", { name: "Write on Vercel, read on Workers" }).click();
  await expect(page.getByTestId("cross-write")).toContainText("already lists it", { timeout: 20_000 });
});
