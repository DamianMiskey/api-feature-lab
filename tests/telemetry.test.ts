import type { ExecutionContext } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/api/app";
import worker from "../worker/index";

// Shipping log lines to Grafana. fetch() is intercepted for Grafana's address
// only, so nothing leaves the machine; everything else passes through.

const GRAFANA = "https://otlp-gateway-prod-us-east-3.grafana.net/otlp/v1/logs";
type Sent = { url: string; headers: Headers; body: { resourceLogs: { resource: { attributes: { key: string; value: Record<string, unknown> }[] }; scopeLogs: { logRecords: Record<string, unknown>[] }[] }[] } };
let sent: Sent[];
let answer: () => Response;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  answer = () => new Response("{}", { status: 200 });
  process.env.GRAFANA_OTLP_TOKEN = "test-token";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://otlp-gateway")) return realFetch(input, init);
    sent.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
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
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const [s] = sent;
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
    expect(sent).toHaveLength(0);
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
    expect(sent).toHaveLength(1);
  });

  it("a 4xx request ships as a WARN record", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request("/api/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(400);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(records(sent[0]).map((r) => r.severityText)).toEqual(["WARN"]);
  });
});
