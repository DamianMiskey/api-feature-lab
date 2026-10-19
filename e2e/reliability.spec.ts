import { expect, test } from "@playwright/test";

// Phase 4's pages, driven like a visitor would, plus the cross-origin call the
// Motion lab's games make. The page tests post scores, so they run locally and
// in CI only; the read-only checks also run against a deployment.

test("idempotency page: the retry is replayed, a reused key is refused", async ({ page }) => {
  await page.goto("/idempotency");
  await page.getByRole("button", { name: "Submit a score, then retry it" }).click();
  const shots = page.locator("ol li");
  await expect(shots).toHaveCount(3);
  await expect(shots.nth(0)).toContainText("201");
  await expect(shots.nth(1)).toContainText("Idempotent-Replayed: true");
  await expect(shots.nth(2)).toContainText("422");
  const id = (s: string) => s.match(/score ([0-9a-f-]{36})/)?.[1];
  expect(id(await shots.nth(1).innerText())).toBe(id(await shots.nth(0).innerText()));
});

test("webhooks page: refused once, retried, delivered; forgeries rejected", async ({ page }) => {
  await page.goto("/webhooks");
  await page.getByLabel("The inbox refuses each message").selectOption("1");
  await page.getByRole("button", { name: "Create an inbox" }).click();
  await expect(page.getByText(/^whsec_/)).toBeVisible();
  await page.getByRole("button", { name: "Send a ping" }).click();
  const delivery = page.locator("ol li").filter({ hasText: "ping" }).first();
  await expect(delivery).toContainText("pending");
  await expect(delivery).toContainText("#1");
  await expect(delivery).toContainText("503");
  // The retry comes due after 2 seconds; the page's polling runs it.
  await expect(delivery).toContainText("delivered", { timeout: 15_000 });
  await expect(delivery).toContainText(/#2 .*200/);
  await page.getByRole("button", { name: "Send a forged message" }).click();
  await expect(page.getByText("Forged message refused")).toBeVisible();
});

test("streaming page: a posted score arrives over the open stream", async ({ page }) => {
  await page.goto("/streaming");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("(the board as it is)")).toBeVisible();
  await page.getByRole("button", { name: "Post a random score" }).click();
  await expect(page.getByText("(a new score)")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Disconnect" }).click();
});

test.describe("leaderboards, read-only @readonly", () => {
  test("each game's board answers in the documented shape", async ({ request }) => {
    for (const game of ["toppler", "marble", "stacker", "runner"]) {
      const res = await request.get(`/api/scores?game=${game}`);
      expect(res.ok(), game).toBe(true);
      expect(await res.json()).toMatchObject({ game, entries: expect.any(Array) });
    }
  });

  test("the Motion lab may call it cross-origin, other sites may not", async ({ request }) => {
    const preflight = await request.fetch("/api/scores", {
      method: "OPTIONS",
      headers: { origin: "https://motion.djmiskey.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type,idempotency-key" },
    });
    expect(preflight.status()).toBe(204);
    expect(preflight.headers()["access-control-allow-origin"]).toBe("https://motion.djmiskey.com");
    const other = await request.get("/api/scores?game=runner", { headers: { origin: "https://evil.example" } });
    expect(other.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("a submission without an Idempotency-Key is refused before anything is stored", async ({ request }) => {
    const res = await request.post("/api/scores", { data: { game: "demo", initials: "NOK", value: 1 } });
    expect(res.status()).toBe(400);
  });

  test("the stream starts with the board", async ({ page }) => {
    // EventSource in a real browser, against the real server (and its proxies).
    await page.goto("/streaming");
    const first = await page.evaluate(() => new Promise<{ id: string; game: string }>((resolve, reject) => {
      const es = new EventSource("/api/scores/stream?game=runner");
      es.addEventListener("board", (e) => { es.close(); resolve({ id: e.lastEventId, game: JSON.parse(e.data).game }); });
      setTimeout(() => { es.close(); reject(new Error("no board within 10s")); }, 10_000);
    }));
    expect(first.game).toBe("runner");
    expect(Number(first.id)).toBeGreaterThanOrEqual(0);
  });
});
