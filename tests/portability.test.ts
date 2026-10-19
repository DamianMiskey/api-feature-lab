import type { ExecutionContext } from "hono";
import { describe, expect, it } from "vitest";
import { app } from "@/api/app";
import worker from "../worker/index";

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

describe("/api/platform", () => {
  it("says where it runs and times a database round trip", async () => {
    const res = await app.request("/api/platform");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ platform: "local", database: "pglite", region: null });
    expect(body.runtime).toMatch(/Node\.js/);
    expect(body.dbMs).toBeGreaterThanOrEqual(0);
  });

  it("can be read by the Portability page from the other deployment (CORS)", async () => {
    const res = await app.request("/api/platform", { headers: { origin: "https://api.djmiskey.com" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://api.djmiskey.com");
  });
});

describe("the Worker entry point", () => {
  it("serves the same app", async () => {
    const res = await worker.fetch(new Request("https://api-cf.djmiskey.com/api/health"), {}, ctx);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("keys clients by CF-Connecting-IP, ignoring an x-real-ip the client made up", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await worker.fetch(new Request("https://api-cf.djmiskey.com/api/limits/demo", {
        headers: { "cf-connecting-ip": "203.0.113.99", "x-real-ip": `10.0.0.${i}`, "x-forwarded-for": `10.1.0.${i}` },
      }), {}, ctx);
      statuses.push(res.status);
    }
    // Spoofing a new IP each time would have kept every request under the limit.
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });
});
