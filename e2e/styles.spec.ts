import { expect, test } from "@playwright/test";

// The comparison page, sending each question all three ways for real.

const column = (page: import("@playwright/test").Page, style: string) => page.locator(`[data-style="${style}"]`);

test("the dashboard: three REST requests, one batched tRPC request, one GraphQL query @readonly", async ({ page }) => {
  await page.goto("/styles");
  await page.getByRole("button", { name: "A dashboard: two boards and the newest tasks" }).click();
  await expect(column(page, "REST").getByTestId("totals")).toContainText("3 requests");
  await expect(column(page, "tRPC").getByTestId("totals")).toContainText("1 request ");
  await expect(column(page, "tRPC")).toContainText("GET /api/trpc/scores.top,scores.top,tasks.newest?batch=1");
  await expect(column(page, "GraphQL").getByTestId("totals")).toContainText("1 request ");
});

test("GraphQL's answer is the smallest: only the fields asked for @readonly", async ({ page }) => {
  await page.goto("/styles");
  await page.getByRole("button", { name: "Top 3 on Runner" }).click();
  const bytes = async (style: string) => Number((await column(page, style).getByTestId("totals").innerText()).match(/([\d,]+) bytes/)![1].replace(/,/g, ""));
  await expect(column(page, "GraphQL").getByTestId("totals")).toContainText("bytes");
  expect(await bytes("GraphQL")).toBeLessThan(await bytes("REST"));
});

test("a mistake: 422, 400 and 400, each in its own error shape @readonly", async ({ page }) => {
  await page.goto("/styles");
  await page.getByRole("button", { name: "A mistake: a game that doesn't exist" }).click();
  await expect(column(page, "REST")).toContainText("422 GET /api/scores?game=pong");
  await expect(column(page, "REST")).toContainText("problems/validation");
  await expect(column(page, "tRPC")).toContainText("400 GET /api/trpc/scores.top");
  await expect(column(page, "tRPC")).toContainText("BAD_REQUEST");
  await expect(column(page, "GraphQL")).toContainText("400 POST /api/graphql");
  await expect(column(page, "GraphQL")).toContainText("pong");
});
