// Shipping telemetry to Grafana Cloud over OTLP (the OpenTelemetry Protocol),
// as HTTP + JSON. Vercel's own exporter (Drains) is Pro-only, so on Hobby the
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

/** Send log lines to Grafana. Never throws: telemetry must not break the API. */
export async function exportLogs(lines: LogLine[], resource: Record<string, unknown>) {
  const token = process.env.GRAFANA_OTLP_TOKEN;
  if (!token || lines.length === 0) return;
  try {
    const res = await fetch(`${ENDPOINT}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${btoa(`${INSTANCE_ID}:${token}`)}` },
      body: JSON.stringify(otlpLogs(lines, resource)),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) failed(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (e) {
    failed((e as Error).message);
  }
}

// Printed, not exported: a failing exporter mustn't feed itself.
const failed = (reason: string) => console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "telemetry export failed", reason }));
