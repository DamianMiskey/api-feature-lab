// Shipping telemetry (log lines to Loki, spans to Tempo) to Grafana Cloud over
// OTLP (the OpenTelemetry Protocol), as HTTP + JSON. Vercel's own exporter (Drains) is Pro-only, so on Hobby the
// app sends its own: one POST per request, made after the response has gone
// (see background() in observe.ts), so visitors never wait for it.
//
// Nothing is sent without GRAFANA_OTLP_TOKEN, which only production has
// (Vercel production env and the Worker's secrets): local runs, tests, CI and
// preview deployments keep their logs to themselves.

const ENDPOINT = process.env.GRAFANA_OTLP_ENDPOINT ?? "https://otlp-gateway-prod-us-east-3.grafana.net/otlp";
const INSTANCE_ID = process.env.GRAFANA_INSTANCE_ID ?? "1884408"; // not secret: the token is
export const SERVICE_NAME = "api-feature-lab";

export type LogLine = { ts: string; level: "info" | "warn" | "error"; msg: string; requestId?: string; [field: string]: unknown };

/** A finished span. start/end are nanoseconds since 1970, as strings (OTLP's JSON form). */
export type Span = {
  traceId: string; spanId: string; parentSpanId?: string;
  name: string; kind: number; start: string; end: string;
  attributes: Record<string, unknown>;
  /** Set when the work failed: the span's status becomes ERROR with this message. */
  error?: string;
};

export const exporting = () => !!process.env.GRAFANA_OTLP_TOKEN;

// OTLP's attribute value shape.
const value = (v: unknown) =>
  typeof v === "boolean" ? { boolValue: v }
    : typeof v === "number" && Number.isInteger(v) ? { intValue: String(v) }
      : typeof v === "number" ? { doubleValue: v }
        : { stringValue: String(v) };
const attributes = (fields: Record<string, unknown>) =>
  Object.entries(fields).filter(([, v]) => v !== undefined && v !== null).map(([key, v]) => ({ key, value: value(v) }));

// OTLP severity numbers: INFO 9, WARN 13, ERROR 17.
const SEVERITY = { info: 9, warn: 13, error: 17 } as const;

/** The OTLP/JSON body for some log lines (exported for tests). */
export function otlpLogs(lines: LogLine[], resource: Record<string, unknown>) {
  return {
    resourceLogs: [{
      resource: { attributes: attributes(resource) },
      scopeLogs: [{
        scope: { name: `${SERVICE_NAME}/observe` },
        logRecords: lines.map(({ ts, level, msg, requestId, ...fields }) => ({
          timeUnixNano: `${Date.parse(ts)}000000`, // milliseconds, as nanoseconds
          severityNumber: SEVERITY[level],
          severityText: level.toUpperCase(),
          // The body is the whole JSON line, exactly as printed to stdout, so
          // Loki's `| json` parser can query any field of it.
          body: { stringValue: JSON.stringify({ ts, level, msg, requestId, ...fields }) },
          // The id doubles as the OTLP trace id: Grafana links a log line to
          // its trace (Phase 2) through this field.
          ...(requestId ? { traceId: requestId } : {}),
          // A few fields as attributes too (Loki "structured metadata"), named
          // by OpenTelemetry's semantic conventions, for filtering without parsing.
          attributes: attributes({
            "log.message": msg,
            "http.request.method": fields.method,
            "http.route": fields.route,
            "http.response.status_code": fields.status,
          }),
        })),
      }],
    }],
  };
}

/** The OTLP/JSON body for some spans (exported for tests). */
export function otlpSpans(spans: Span[], resource: Record<string, unknown>) {
  return {
    resourceSpans: [{
      resource: { attributes: attributes(resource) },
      scopeSpans: [{
        scope: { name: `${SERVICE_NAME}/observe` },
        spans: spans.map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
          name: s.name,
          kind: s.kind,
          startTimeUnixNano: s.start,
          endTimeUnixNano: s.end,
          attributes: attributes(s.attributes),
          // OTLP status codes: 1 OK, 2 ERROR.
          status: s.error ? { code: 2, message: s.error } : { code: 1 },
        })),
      }],
    }],
  };
}

async function post(signal: "logs" | "traces", body: unknown, token: string) {
  try {
    const res = await fetch(`${ENDPOINT}/v1/${signal}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${btoa(`${INSTANCE_ID}:${token}`)}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) failed(signal, `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (e) {
    failed(signal, (e as Error).message);
  }
}

/** Send log lines and spans to Grafana, in parallel. Never throws: telemetry must not break the API. */
export async function exportTelemetry({ lines, spans }: { lines: LogLine[]; spans: Span[] }, resource: Record<string, unknown>) {
  const token = process.env.GRAFANA_OTLP_TOKEN;
  if (!token) return;
  await Promise.all([
    lines.length ? post("logs", otlpLogs(lines, resource), token) : null,
    spans.length ? post("traces", otlpSpans(spans, resource), token) : null,
  ]);
}

// Printed, not exported: a failing exporter mustn't feed itself.
const failed = (signal: string, reason: string) => console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "telemetry export failed", signal, reason }));
