import { expect, test } from "@playwright/test";
import { PAGES } from "./helpers";

// The API over real HTTP, through Next.js: what the unit tests check with
// app.request(), plus what only a real server adds (headers, routing).

test.describe("contract", () => {
  test("create → read → update → delete", async ({ request }) => {
    const created = await request.post("/api/tasks", { data: { title: "From Playwright" } });
    expect(created.status()).toBe(201);
    const task = await created.json();
    expect(created.headers().location).toBe(`/api/tasks/${task.id}`);
    expect((await request.get(created.headers().location)).ok()).toBe(true);
    expect((await (await request.patch(`/api/tasks/${task.id}`, { data: { done: true } })).json()).done).toBe(true);
    expect((await request.delete(`/api/tasks/${task.id}`)).status()).toBe(204);
    expect((await request.get(`/api/tasks/${task.id}`)).status()).toBe(404);
  });

  test("invalid input is a 422 Problem with field paths", async ({ request }) => {
    const res = await request.post("/api/tasks", { data: { title: "", done: "yes" } });
    expect(res.status()).toBe(422);
    expect(res.headers()["content-type"]).toContain("application/problem+json");
    expect((await res.json()).errors.map((e: { path: string }) => e.path).sort()).toEqual(["done", "title"]);
  });
});

test.describe("read-only checks @readonly", () => {
  test("health", async ({ request }) => {
    expect(await (await request.get("/api/health")).json()).toEqual({ ok: true });
  });

  test("the list answers in the documented shape", async ({ request }) => {
    const res = await request.get("/api/tasks");
    expect(res.ok()).toBe(true);
    expect(Array.isArray((await res.json()).items)).toBe(true);
  });

  test("errors are Problems even for routes that don't exist", async ({ request }) => {
    const res = await request.get("/api/nope");
    expect(res.status()).toBe(404);
    expect(res.headers()["content-type"]).toContain("application/problem+json");
  });

  test("the OpenAPI document lists every route", async ({ request }) => {
    const doc = await (await request.get("/api/openapi.json")).json();
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/api/tasks", "/api/tasks/{id}"]));
  });

  test("API responses carry the strictest CSP; pages the site-wide one", async ({ request }) => {
    expect((await request.get("/api/health")).headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    for (const path of PAGES) {
      const h = (await request.get(path)).headers();
      expect(h["content-security-policy"], path).toContain("default-src 'self'");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["x-powered-by"]).toBeUndefined();
    }
  });
});
