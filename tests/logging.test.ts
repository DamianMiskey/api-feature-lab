import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/api/app";
import { traceIdFrom } from "@/api/observe";

// What lands in the logs: one JSON line per request, plus the odd extra
// (errors, closed streams). Captured from console.* as the platforms do.

type Line = Record<string, unknown>;
let lines: Line[] = [];

beforeEach(() => {
  lines = [];
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((text: unknown) => {
      try { lines.push(JSON.parse(String(text))); } catch { /* not ours */ }
    });
  }
});
afterEach(() => vi.restoreAllMocks());

const requestLines = () => lines.filter((l) => l.msg === "request");
const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("canonical log lines", () => {
  it("one JSON line per request, with the route pattern, status, timing and query count", async () => {
    const created = await (await send("POST", "/tasks", { title: "Log me" })).json();
    lines = [];
    const res = await send("GET", `/tasks/${created.id}`);
    const [line] = requestLines();
    expect(requestLines()).toHaveLength(1);
    expect(line).toMatchObject({ level: "info", method: "GET", route: "/api/tasks/:id", path: `/api/tasks/${created.id}`, status: 200, client: "anonymous", platform: "local" });
    expect(line.requestId).toBe(res.headers.get("x-request-id"));
    expect(line.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(line.dbQueries).toBeGreaterThanOrEqual(1);
    expect(typeof line.durationMs).toBe("number");
    expect(Date.parse(String(line.ts))).not.toBeNaN();
  });

  it("4xx is a warning, and the Problem body carries the request id", async () => {
    const res = await send("GET", "/tasks/00000000-0000-4000-8000-000000000000");
    const body = await res.json();
    expect(body.requestId).toBe(res.headers.get("x-request-id"));
    expect(requestLines()[0]).toMatchObject({ level: "warn", status: 404, requestId: body.requestId });
  });

  it("never logs credentials: a key's id, not the key", async () => {
    const key = await (await send("POST", "/keys", { name: "logged", scopes: [] })).json();
    lines = [];
    await send("GET", "/me", undefined, { authorization: `Bearer ${key.key}` });
    const [line] = requestLines();
    expect(line).toMatchObject({ client: `key:${key.id}`, authMethod: "api-key" });
    expect(JSON.stringify(lines)).not.toContain(key.key);
  });

  it("annotations from deep inside: rate limits, idempotent replays, scores", async () => {
    const before = process.env.LAB_SCORE_LIMIT;
    process.env.LAB_SCORE_LIMIT = "1";
    try {
      const headers = { "idempotency-key": crypto.randomUUID(), "x-real-ip": "192.0.2.201" };
      await send("POST", "/scores", { game: "demo", initials: "LOG", value: 5 }, headers);
      expect(requestLines()[0]).toMatchObject({ idempotency: "first", game: "demo", status: 201 });
      lines = [];
      await send("POST", "/scores", { game: "demo", initials: "LOG", value: 5 }, headers);
      expect(requestLines()[0]).toMatchObject({ rateLimited: "scores", status: 429 });
    } finally {
      process.env.LAB_SCORE_LIMIT = before;
    }
  });
});

describe("request ids across services", () => {
  it("a caller's traceparent is kept; a bad one is replaced", async () => {
    const trace = "4bf92f3577b34da6a3ce929d0e0e4736";
    const res = await send("GET", "/health", undefined, { traceparent: `00-${trace}-00f067aa0ba902b7-01` });
    expect(res.headers.get("x-request-id")).toBe(trace);
    const bad = await send("GET", "/health", undefined, { traceparent: "00-00000000000000000000000000000000-00f067aa0ba902b7-01" });
    expect(bad.headers.get("x-request-id")).not.toMatch(/^0+$/);
    expect(traceIdFrom("garbage")).toBeNull();
  });

  it("a webhook delivery carries the id of the request that caused it", async () => {
    const endpoint = await (await send("POST", "/webhooks/endpoints", { failFirst: 0 })).json();
    lines = [];
    const ping = await send("POST", `/webhooks/endpoints/${endpoint.id}/ping`);
    const id = ping.headers.get("x-request-id");
    const inbox = requestLines().find((l) => l.route === "/api/webhooks/inbox/:id");
    expect(inbox).toMatchObject({ requestId: id, webhook: "processed", status: 200 });
    expect(requestLines().find((l) => l.route === "/api/webhooks/endpoints/:id/ping")).toMatchObject({ requestId: id, webhookAttempts: 1 });
  });
});
