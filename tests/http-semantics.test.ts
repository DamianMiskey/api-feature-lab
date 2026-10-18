import { describe, expect, it } from "vitest";
import { app } from "@/api/app";

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const create = async (title: string) => (await send("POST", "/tasks", { title })).json();

describe("cursor pagination", () => {
  it("walks every task exactly once, newest first, even while tasks are added", async () => {
    for (let i = 0; i < 12; i++) await create(`page-test ${i}`);
    const seen: string[] = [];
    let cursor: string | null = null;
    let first = true;
    do {
      const res: Response = await send("GET", `/tasks?limit=5${cursor ? `&cursor=${cursor}` : ""}`);
      const body = await res.json();
      seen.push(...body.items.map((t: { title: string }) => t.title));
      if (body.nextCursor) expect(res.headers.get("link")).toContain('rel="next"');
      cursor = body.nextCursor;
      // Someone adds a task after the first page: a cursor isn't affected.
      if (first) { await create("added while paging"); first = false; }
    } while (cursor);
    const ours = seen.filter((t) => t.startsWith("page-test"));
    expect(ours).toEqual(Array.from({ length: 12 }, (_, i) => `page-test ${11 - i}`));
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(seen).not.toContain("added while paging"); // newer than page 1: it belongs before it
  });

  it("offset pagination repeats a row when one is added between pages", async () => {
    for (let i = 0; i < 6; i++) await create(`offset-test ${i}`);
    const page1 = (await (await send("GET", "/tasks?limit=3&offset=0")).json()).items;
    await create("offset intruder");
    const page2 = (await (await send("GET", "/tasks?limit=3&offset=3")).json()).items;
    const ids1 = page1.map((t: { id: string }) => t.id);
    expect(page2.some((t: { id: string }) => ids1.includes(t.id))).toBe(true);
  });

  it("rejects a forged cursor, a too-big page, and cursor+offset together", async () => {
    expect((await send("GET", "/tasks?cursor=not-a-cursor")).status).toBe(422);
    expect((await send("GET", "/tasks?limit=500")).status).toBe(422);
    expect((await send("GET", "/tasks?cursor=abc&offset=3")).status).toBe(422);
  });
});

describe("ETags and conditional requests", () => {
  it("304 Not Modified when the client's copy is current", async () => {
    const { id } = await create("cache me");
    const first = await send("GET", `/tasks/${id}`);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[\w-]+"$/);
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const again = await send("GET", `/tasks/${id}`, undefined, { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
  });

  it("the ETag changes when the task does", async () => {
    const { id } = await create("change me");
    const before = (await send("GET", `/tasks/${id}`)).headers.get("etag");
    await send("PATCH", `/tasks/${id}`, { done: true });
    const after = await send("GET", `/tasks/${id}`, undefined, { "if-none-match": before! });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(before);
  });

  it("If-Match: a write with a stale ETag gets 412, so nobody overwrites anyone", async () => {
    const { id } = await create("shared doc");
    const etag = (await send("GET", `/tasks/${id}`)).headers.get("etag")!;
    // Alice and Bob both read the same version. Alice saves first…
    const alice = await send("PATCH", `/tasks/${id}`, { title: "Alice's title" }, { "if-match": etag });
    expect(alice.status).toBe(200);
    // …so Bob's save, based on the old version, is refused.
    const bob = await send("PATCH", `/tasks/${id}`, { title: "Bob's title" }, { "if-match": etag });
    expect(bob.status).toBe(412);
    expect((await bob.json()).type).toContain("precondition-failed");
    expect((await (await send("GET", `/tasks/${id}`)).json()).title).toBe("Alice's title");
    // With Alice's new ETag, Bob's retry goes through.
    const retry = await send("PATCH", `/tasks/${id}`, { title: "Bob's title" }, { "if-match": alice.headers.get("etag")! });
    expect(retry.status).toBe(200);
  });

  it("the list has an ETag too", async () => {
    const res = await send("GET", "/tasks?limit=3");
    const again = await send("GET", "/tasks?limit=3", undefined, { "if-none-match": res.headers.get("etag")! });
    expect(again.status).toBe(304);
  });
});

describe("versioning", () => {
  it("API-Version: 2 returns the v2 shape at the same URL, with Vary", async () => {
    const { id } = await create("versioned");
    const v1 = await send("GET", `/tasks/${id}`);
    expect(await v1.json()).toHaveProperty("done", false);
    expect(v1.headers.get("api-version")).toBe("1");
    const v2 = await send("GET", `/tasks/${id}`, undefined, { "api-version": "2" });
    expect(await v2.json()).toMatchObject({ status: "open", links: { self: `/api/v2/tasks/${id}` } });
    expect(v2.headers.get("vary")).toBe("API-Version");
    expect(v2.headers.get("etag")).not.toBe(v1.headers.get("etag")); // different bytes, different tag
  });

  it("the v2 URL gives the same shape; an unknown version is a 400 Problem", async () => {
    const { id } = await create("v2 url");
    expect(await (await send("GET", `/v2/tasks/${id}`)).json()).toHaveProperty("status", "open");
    const v9 = await send("GET", `/tasks/${id}`, undefined, { "api-version": "9" });
    expect(v9.status).toBe(400);
    expect((await v9.json()).type).toContain("unsupported-version");
  });

  it("v0 answers, but announces its deprecation and sunset", async () => {
    const res = await send("GET", "/v0/tasks");
    expect(res.status).toBe(200);
    expect(res.headers.get("deprecation")).toMatch(/^@\d+$/);
    expect(new Date(res.headers.get("sunset")!).getUTCFullYear()).toBe(2027);
    expect(res.headers.get("link")).toContain('rel="successor-version"');
  });
});
