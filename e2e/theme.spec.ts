import { expect, test } from "@playwright/test";

// The shared theme switch (@djmiskey/lab-tokens): a choice survives a reload,
// applied before the page draws.
test("a chosen theme survives a reload @readonly", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await theme()).toBe("light");
  const light = await bg();
  await page.getByRole("group", { name: "Colour theme" }).getByRole("button", { name: "Dark" }).click();
  expect(await theme()).toBe("dark");
  expect(await bg()).not.toBe(light);
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await theme()).toBe("dark");
});
