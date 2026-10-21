import { AsyncLocalStorage } from "node:async_hooks";
import { waitUntil } from "@vercel/functions";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthEnv } from "./auth";
import { exporting, exportTelemetry, type LogLine, SERVICE_NAME, type Span } from "./telemetry";

// Observability for every request, in two forms that share one id:
//
// - Logs: one "canonical log line" per request: instead of many scattered
//   messages, each request writes one JSON object at the end with everything
//   worth knowing about it (route, status, duration, who asked, how many
//   database queries it took, what it did). Any code running for the request
//   can add fields with annotate(), without being handed a logger, because the
//   record travels with the request in AsyncLocalStorage.
// - Traces: the same request as a tree of timed spans: the request itself,
//   the middleware steps, every database query, outgoing calls. span() opens
//   one around any piece of work; the span that's open when another starts
//   becomes its parent (a second AsyncLocalStorage tracks which is open).
//
// Every request gets an id, sent back as X-Request-Id and included in every
// error body, so a user's "it failed" can be matched to the log line and the
// trace. The id is a W3C Trace Context trace id: if the caller sends a
// traceparent header, its trace id is kept (and the caller's span becomes
// this request's parent), so one trace follows a request across services:
// here, from a score submission into the webhook deliveries it causes.

export type Fields = Record<string, string | number | boolean | null | undefined>;

/** OpenTelemetry span kinds: what a span is, relative to this service. */
export const SpanKind = { INTERNAL: 1, SERVER: 2, CLIENT: 3 } as const;

type Record_ = {
  requestId: string;
  /** The request's own (root) span, and the caller's span if a traceparent named one. */
  spanId: string; parentSpanId?: string;
  /** Wall-clock milliseconds at start, and the performance.now() it corresponds to. */
  wallStart: number; perfStart: number;
  dbQueries: number; fields: Fields;
  /** Lines and finished spans, shipped together when the request ends. */
  lines: LogLine[]; spans: Span[];
  /** Set once the request's telemetry has gone: anything later (a stream closing) ships on its own. */
  ship?: (batch: { lines: LogLine[]; spans: Span[] }) => void;
};

const storage = new AsyncLocalStorage<Record_>();
// The open span: a real one, or just the root's id (the root is assembled at the end).
const activeSpan = new AsyncLocalStorage<Span | { spanId: string }>();

const hex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

function parseTraceparent(header: string | undefined) {
  const match = header?.trim().toLowerCase().match(TRACEPARENT);
  return match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]) ? { traceId: match[1], parentSpanId: match[2] } : null;
}

/** The trace id from a valid traceparent header (all-zero ids are invalid), or null. */
export const traceIdFrom = (header: string | undefined) => parseTraceparent(header)?.traceId ?? null;

/** The current request's record, if code is running inside one. */
export const current = () => storage.getStore();

/** Add fields to the current request's log line (and its root span). A no-op outside a request. */
export function annotate(fields: Fields) {
  const record = storage.getStore();
  if (record) Object.assign(record.fields, fields);
}

/** Count a database query against the current request (called by the db client). */
export function countQuery() {
  const record = storage.getStore();
  if (record) record.dbQueries++;
}

/** A traceparent for an outgoing request: this trace, with the open span as the callee's parent. */
export function outgoingTraceparent() {
  const record = storage.getStore();
  return record ? `00-${record.requestId}-${activeSpan.getStore()?.spanId ?? record.spanId}-01` : undefined;
}

// Span times are nanoseconds since 1970, as strings (OTLP's JSON form). The
// wall clock is read once per request; performance.now() measures from there.
// On Workers both clocks stand still while code runs and move only across
// I/O (a defence against timing attacks), so spans there show waiting time.
const nanos = (record: Record_, perf = performance.now()) => `${Math.round((record.wallStart + perf - record.perfStart) * 1000)}000`;

function queue(record: Record_, batch: { lines?: LogLine[]; spans?: Span[] }) {
  if (!exporting()) return;
  if (record.ship) record.ship({ lines: batch.lines ?? [], spans: batch.spans ?? [] });
  else {
    record.lines.push(...(batch.lines ?? []));
    record.spans.push(...(batch.spans ?? []));
  }
}

/**
 * Time a piece of work as a span, a child of whichever span is open. Outside a
 * request it just runs the work. A thrown error marks the span as failed (and
 * is re-thrown: tracing never changes what the code does).
 */
export async function span<T>(name: string, attributes: Fields, work: () => Promise<T>, kind: number = SpanKind.INTERNAL): Promise<T> {
  const record = storage.getStore();
  if (!record) return work();
  const s: Span = { traceId: record.requestId, spanId: hex(8), parentSpanId: activeSpan.getStore()?.spanId ?? record.spanId, name, kind, start: nanos(record), end: "", attributes: { ...attributes } };
  try {
    return await activeSpan.run(s, work);
  } catch (e) {
    s.error = (e as Error).message;
    throw e;
  } finally {
    s.end = nanos(record);
    queue(record, { spans: [s] });
  }
}

/** Add attributes to the open span, and mark it failed if `error` is given (for failures that aren't exceptions). */
export function spanResult(attributes: Fields, error?: string) {
  const s = activeSpan.getStore();
  if (!s || !("attributes" in s)) return;
  Object.assign(s.attributes, attributes);
  if (error) s.error = error;
}

/**
 * Write one JSON log line to stdout (Vercel's and Cloudflare's log viewers
 * both index JSON fields) and, in production, queue it for Grafana.
 */
export function log(level: "info" | "warn" | "error", msg: string, fields: Fields = {}) {
  const record = storage.getStore();
  const line: LogLine = { ts: new Date().toISOString(), level, msg, requestId: record?.requestId, ...fields };
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(JSON.stringify(line));
  if (record) queue(record, { lines: [line] });
}

/**
 * Run work after the response has been sent. Workers hand Hono an execution
 * context with waitUntil; on Vercel, @vercel/functions provides the same.
 * (Elsewhere the promise simply runs.)
 */
function background(c: Context, work: Promise<unknown>) {
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
  try { ctx = c.executionCtx; } catch { /* not on Workers */ }
  if (ctx) ctx.waitUntil(work);
  else waitUntil(work);
}

const platform = () => process.env.LAB_PLATFORM ?? (process.env.VERCEL ? "vercel" : "local");

export const observe: MiddlewareHandler<AuthEnv> = (c, next) => {
  const caller = parseTraceparent(c.req.header("traceparent"));
  const record: Record_ = {
    requestId: caller?.traceId ?? hex(16), spanId: hex(8), parentSpanId: caller?.parentSpanId,
    wallStart: Date.now(), perfStart: performance.now(), dbQueries: 0, fields: {}, lines: [], spans: [],
  };
  return storage.run(record, async () => {
    c.header("X-Request-Id", record.requestId);
    const start = nanos(record);
    try {
      await activeSpan.run({ spanId: record.spanId }, next);
    } finally {
      const status = c.res.status;
      const auth = c.get("auth");
      const region = process.env.VERCEL_REGION ?? (c.req.raw as Request & { cf?: { colo?: string } }).cf?.colo;
      const durationMs = Math.round(performance.now() - record.perfStart);
      log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", {
        method: c.req.method,
        // The route pattern (/api/tasks/:id), not the path: it groups requests
        // for dashboards, and keeps ids out of the field's values.
        route: c.req.routePath,
        path: c.req.path,
        status,
        durationMs,
        dbQueries: record.dbQueries,
        // Who: an API key's id (never the key), or just "anonymous". No IPs:
        // they're personal data, and the rate limiter doesn't need them logged.
        client: auth ? `key:${auth.keyId}` : "anonymous",
        platform: platform(),
        region,
        ...record.fields,
      });
      // The root span: the whole request, named after its route, with the
      // OpenTelemetry semantic-convention attributes for HTTP servers.
      const root: Span = {
        traceId: record.requestId, spanId: record.spanId, parentSpanId: record.parentSpanId,
        name: `${c.req.method} ${c.req.routePath}`, kind: SpanKind.SERVER, start, end: nanos(record),
        attributes: {
          "http.request.method": c.req.method, "http.route": c.req.routePath, "url.path": c.req.path,
          "http.response.status_code": status, "db.queries": record.dbQueries, ...record.fields,
        },
        ...(status >= 500 ? { error: `HTTP ${status}` } : {}),
      };
      queue(record, { spans: [root] });
      if (exporting()) {
        // Who sent the telemetry: OpenTelemetry "resource" attributes.
        const resource = {
          "service.name": SERVICE_NAME,
          "deployment.environment.name": process.env.VERCEL_ENV ?? (process.env.LAB_PLATFORM ? "production" : "local"),
          "cloud.platform": platform(),
          "cloud.region": region,
        };
        record.ship = (batch) => background(c, exportTelemetry(batch, resource));
        record.ship({ lines: record.lines, spans: record.spans });
        record.lines = [];
        record.spans = [];
      }
    }
  });
};
