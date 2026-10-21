import type { ExecutionContext } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/api/app";
import worker from "../worker/index";

// Shipping log lines to Grafana. fetch() is intercepted for Grafana's address
// only, so nothing leaves the machine; everything else passes through.

const GRAFANA = "https://otlp-gateway-prod-us-east-3.grafana.net/otlp/v1/logs";
type Sent = { url: string; headers: Headers; body: { resourceLogs: { resource: { attributes: { key: string; value: Record<string, unknown> }[] }; scopeLogs: { logRecords: Record<string, unknown>[] }[] }[] } };
type SentSpans = { resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[] };
type OtlpSpan = { traceId: string; spanId: string; parentSpanId?: string; name: string; kind: number; startTimeUnixNano: string; endTimeUnixNano: string; attributes: { key: string; value: Record<string, unknown> }[]; status: { code: number; message?: string } };
let all: Sent[];
const sentTo = (signal: "logs" | "traces") => all.filter((s) => s.url.endsWith(`/v1/${signal}`));
// Log POSTs (what the original tests counted); spans() gathers every span sent.
const logsSent = () => sentTo("logs");
const spans = () => sentTo("traces").flatMap((s) => (s.body as unknown as SentSpans).resourceSpans[0].scopeSpans[0].spans);
const attr = (s: OtlpSpan, key: string) => { const a = s.attributes.find((x) => x.key === key); return a && Object.values(a.value)[0]; };
let answer: () => Response;
const realFetch = globalThis.fetch;

beforeEach(() => {
  all = [];
  answer = () => new Response("{}", { status: 200 });
  process.env.GRAFANA_OTLP_TOKEN = "test-token";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://otlp-gateway")) return realFetch(input, init);
    all.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return answer();
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.GRAFANA_OTLP_TOKEN;
  vi.restoreAllMocks();
});

const records = (s: Sent) => s.body.resourceLogs[0].scopeLogs[0].logRecords;
const resource = (s: Sent) => Object.fromEntries(s.body.resourceLogs[0].resource.attributes.map((a) => [a.key, Object.values(a.value)[0]]));

describe("OTLP log export", () => {
  it("sends the request's log line to Grafana, after the response", async () => {
    const res = await app.request("/api/health");
    await vi.waitFor(() => expect(logsSent()).toHaveLength(1));
    const [s] = logsSent();
    expect(s.url).toBe(GRAFANA);
    expect(s.headers.get("authorization")).toBe(`Basic ${btoa("1884408:test-token")}`);
    expect(s.headers.get("content-type")).toBe("application/json");
    expect(resource(s)).toMatchObject({ "service.name": "api-feature-lab", "cloud.platform": "local", "deployment.environment.name": "local" });
    const [record] = records(s);
    expect(record).toMatchObject({ severityText: "INFO", severityNumber: 9, traceId: res.headers.get("x-request-id") });
    expect(JSON.parse((record.body as { stringValue: string }).stringValue)).toMatchObject({ msg: "request", route: "/api/health", status: 200 });
    expect(record.attributes).toContainEqual({ key: "http.route", value: { stringValue: "/api/health" } });
    expect(record.attributes).toContainEqual({ key: "http.response.status_code", value: { intValue: "200" } });
    expect(Number(record.timeUnixNano)).toBeGreaterThan(1.7e18);
  });

  it("sends nothing without the token", async () => {
    delete process.env.GRAFANA_OTLP_TOKEN;
    await app.request("/api/health");
    await new Promise((r) => setTimeout(r, 50));
    expect(all).toHaveLength(0);
  });

  it("a failing Grafana doesn't affect the API: one warning, and the request still succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    answer = () => new Response("quota exceeded", { status: 429 });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("telemetry export failed")));
    expect(warn.mock.calls.find((c) => String(c[0]).includes("telemetry"))![0]).toContain("HTTP 429");
  });

  it("on Workers, the export is handed to ctx.waitUntil", async () => {
    const waiting: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waiting.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
    await worker.fetch(new Request("https://api-cf.djmiskey.com/api/health", { headers: { "cf-connecting-ip": "203.0.113.5" } }), {}, ctx);
    expect(waiting).toHaveLength(1);
    await Promise.all(waiting);
    expect(logsSent()).toHaveLength(1);
    expect(sentTo("traces")).toHaveLength(1);
  });

  it("a 4xx request ships as a WARN record", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request("/api/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(400);
    await vi.waitFor(() => expect(logsSent()).toHaveLength(1));
    expect(records(logsSent()[0]).map((r) => r.severityText)).toEqual(["WARN"]);
  });
});

describe("traces", () => {
  const byName = (name: string) => spans().filter((s) => s.name === name);

  it("a request is a SERVER root span with its steps and queries as children", async () => {
    const res = await app.request("/api/scores?game=runner&limit=3");
    const id = res.headers.get("x-request-id")!;
    await vi.waitFor(() => expect(byName("GET /api/scores")).toHaveLength(1));
    const [root] = byName("GET /api/scores");
    expect(root).toMatchObject({ traceId: id, kind: 2, status: { code: 1 } });
    expect(root.parentSpanId).toBeUndefined();
    expect(attr(root, "http.route")).toBe("/api/scores");
    expect(attr(root, "http.response.status_code")).toBe("200");
    const queries = spans().filter((s) => s.traceId === id && s.name === "SELECT scores");
    expect(queries.length).toBeGreaterThanOrEqual(1);
    for (const q of queries) {
      expect(q.kind).toBe(3);
      expect(attr(q, "db.system.name")).toBe("postgresql");
      // Placeholders, never values: the game name isn't in the query text.
      expect(String(attr(q, "db.query.text"))).toMatch(/\$1/);
      expect(String(attr(q, "db.query.text"))).not.toContain("runner");
      // Inside the request's time.
      expect(BigInt(q.startTimeUnixNano) >= BigInt(root.startTimeUnixNano)).toBe(true);
      expect(BigInt(q.endTimeUnixNano) <= BigInt(root.endTimeUnixNano)).toBe(true);
    }
  });

  it("joins the caller's trace: the traceparent's span becomes the root's parent", async () => {
    const trace = "4bf92f3577b34da6a3ce929d0e0e4736";
    await app.request("/api/health", { headers: { traceparent: `00-${trace}-00f067aa0ba902b7-01` } });
    await vi.waitFor(() => expect(spans().find((s) => s.traceId === trace)).toBeDefined());
    expect(spans().find((s) => s.traceId === trace)).toMatchObject({ name: "GET /api/health", parentSpanId: "00f067aa0ba902b7" });
  });

  it("middleware steps get their own spans: authentication and rate limiting", async () => {
    const key = await (await app.request("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "traced", scopes: [] }) })).json();
    all = [];
    const res = await app.request("/api/tasks", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ title: "traced" }) });
    const id = res.headers.get("x-request-id")!;
    await vi.waitFor(() => expect(spans().some((s) => s.traceId === id && s.name === "POST /api/tasks")).toBe(true));
    const mine = spans().filter((s) => s.traceId === id);
    const root = mine.find((s) => s.name === "POST /api/tasks")!;
    const auth = mine.find((s) => s.name === "authenticate")!;
    expect(auth.parentSpanId).toBe(root.spanId);
    expect(attr(auth, "auth.method")).toBe("api-key");
    const limit = mine.find((s) => s.name === "rate limit writes")!;
    expect(limit.parentSpanId).toBe(root.spanId);
    // The limiter's own query is a child of the limiter's span.
    expect(mine.some((s) => s.parentSpanId === limit.spanId && s.kind === 3)).toBe(true);
  });

  it("a webhook delivery is a CLIENT span, with the inbox's request inside it", async () => {
    const endpoint = await (await app.request("/api/webhooks/endpoints", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ failFirst: 1 }) })).json();
    all = [];
    const res = await app.request(`/api/webhooks/endpoints/${endpoint.id}/ping`, { method: "POST" });
    const id = res.headers.get("x-request-id")!;
    await vi.waitFor(() => expect(spans().some((s) => s.traceId === id && s.name === "POST /api/webhooks/inbox/:id")).toBe(true));
    const mine = spans().filter((s) => s.traceId === id);
    const deliver = mine.find((s) => s.name === "webhook deliver")!;
    expect(deliver.kind).toBe(3);
    // failFirst: 1, so this first attempt was refused: a failed span.
    expect(deliver.status).toMatchObject({ code: 2 });
    expect(attr(deliver, "http.response.status_code")).toBe("503");
    const inbox = mine.find((s) => s.name === "POST /api/webhooks/inbox/:id")!;
    expect(inbox.parentSpanId).toBe(deliver.spanId);
  });

  it("an error in the work marks its span failed, and the error still reaches the caller", async () => {
    const { Hono } = await import("hono");
    const { observe, span } = await import("@/api/observe");
    const mini = new Hono().use(observe).get("/boom", async (c) => {
      const caught = await span("risky step", {}, async () => { throw new Error("boom"); }).catch((e: Error) => e.message);
      return c.text(String(caught));
    });
    const res = await mini.request("/boom");
    expect(await res.text()).toBe("boom");
    await vi.waitFor(() => expect(byName("risky step")).toHaveLength(1));
    expect(byName("risky step")[0].status).toEqual({ code: 2, message: "boom" });
    expect(byName("GET /boom")[0].status).toEqual({ code: 1 });
  });
});
