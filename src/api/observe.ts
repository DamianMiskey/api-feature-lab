import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";
import type { AuthEnv } from "./auth";

// Structured logging, one "canonical log line" per request: instead of many
// scattered messages, each request writes one JSON object at the end with
// everything worth knowing about it (route, status, duration, who asked, how
// many database queries it took, what it did). Any code running for the
// request can add fields with annotate(), without being handed a logger,
// because the record travels with the request in AsyncLocalStorage.
//
// Every request gets an ID, sent back as X-Request-Id and included in every
// error body, so a user's "it failed" can be matched to the log line. The ID
// is a W3C Trace Context trace id: if the caller sends a traceparent header,
// its trace id is kept, so one id follows a request across services (here:
// from a score submission into the webhook deliveries it causes).

export type Fields = Record<string, string | number | boolean | null | undefined>;
type Record_ = { requestId: string; spanId: string; started: number; dbQueries: number; fields: Fields };

const storage = new AsyncLocalStorage<Record_>();

const hex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/** The trace id from a valid traceparent header (all-zero ids are invalid), or null. */
export function traceIdFrom(header: string | undefined) {
  const match = header?.trim().toLowerCase().match(TRACEPARENT);
  return match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]) ? match[1] : null;
}

/** The current request's record, if code is running inside one. */
export const current = () => storage.getStore();

/** Add fields to the current request's log line. A no-op outside a request. */
export function annotate(fields: Fields) {
  const record = storage.getStore();
  if (record) Object.assign(record.fields, fields);
}

/** Count a database query against the current request (called by the db client). */
export function countQuery() {
  const record = storage.getStore();
  if (record) record.dbQueries++;
}

/** A traceparent for an outgoing request made on this request's behalf. */
export function outgoingTraceparent() {
  const record = storage.getStore();
  return record ? `00-${record.requestId}-${hex(8)}-01` : undefined;
}

/** Write one JSON log line. Vercel's and Cloudflare's log viewers both index JSON fields. */
export function log(level: "info" | "warn" | "error", msg: string, fields: Fields = {}) {
  const record = storage.getStore();
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, requestId: record?.requestId, ...fields });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

const platform = () => process.env.LAB_PLATFORM ?? (process.env.VERCEL ? "vercel" : "local");

export const observe: MiddlewareHandler<AuthEnv> = (c, next) => {
  const record: Record_ = { requestId: traceIdFrom(c.req.header("traceparent")) ?? hex(16), spanId: hex(8), started: performance.now(), dbQueries: 0, fields: {} };
  return storage.run(record, async () => {
    c.header("X-Request-Id", record.requestId);
    try {
      await next();
    } finally {
      const status = c.res.status;
      const auth = c.get("auth");
      log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", {
        method: c.req.method,
        // The route pattern (/api/tasks/:id), not the path: it groups requests
        // for dashboards, and keeps ids out of the field's values.
        route: c.req.routePath,
        path: c.req.path,
        status,
        durationMs: Math.round(performance.now() - record.started),
        dbQueries: record.dbQueries,
        // Who: an API key's id (never the key), or just "anonymous". No IPs:
        // they're personal data, and the rate limiter doesn't need them logged.
        client: auth ? `key:${auth.keyId}` : "anonymous",
        platform: platform(),
        region: process.env.VERCEL_REGION ?? (c.req.raw as Request & { cf?: { colo?: string } }).cf?.colo,
        ...record.fields,
      });
    }
  });
};
