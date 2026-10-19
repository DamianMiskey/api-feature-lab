"use client";

import { useState } from "react";
import { Button, cx } from "./ui";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";
export type Preset = { label: string; method: Method; path: string; body?: string; headers?: Record<string, string>; note?: string };

type Result = { status: number; statusText: string; ms: number; headers: [string, string][]; body: string };

const METHOD_BG: Record<Method, string> = { GET: "bg-get", POST: "bg-post", PATCH: "bg-patch", DELETE: "bg-delete" };
// Headers worth looking at; the rest (date, vary, CSP…) is noise for these demos.
const SHOWN = new Set(["content-type", "location", "etag", "cache-control", "link", "vary", "api-version", "deprecation", "sunset", "www-authenticate", "ratelimit-policy", "ratelimit", "retry-after", "allow", "idempotent-replayed"]);
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

const pretty = (text: string) => {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};

type Vars = { id?: string; cursor?: string; etag?: string; key?: string; keyId?: string; token?: string };
const fill = (text: string, vars: Vars) =>
  text.replace("{id}", vars.id ?? PLACEHOLDER_ID).replace("{cursor}", vars.cursor ?? "").replace("{etag}", vars.etag ?? '"none-yet"')
    .replace("{keyId}", vars.keyId ?? PLACEHOLDER_ID).replace("{key}", vars.key ?? "lab_no-key-yet").replace("{token}", vars.token ?? "no-token-yet");

const VAR_NAMES = ["id", "cursor", "etag", "key", "keyId", "token"] as const;
const MISSING: Record<(typeof VAR_NAMES)[number], string> = {
  id: "no task created yet, so a made-up id (send Create first)",
  cursor: "empty: send the first page first",
  etag: "no ETag received yet",
  key: "no key created yet (send Create key first)",
  keyId: "no key created yet",
  token: "no token yet (send Get a token first)",
};

/** A JWT's header and payload are base64url JSON: readable by anyone. */
function decodeJwt(token: string) {
  try {
    const [h, p] = token.split(".").slice(0, 2).map((part) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))));
    return { header: h, payload: p };
  } catch {
    return null;
  }
}

// A tiny HTTP client on the page: pick a preset or edit the request, send it
// to this site's own API with fetch(), and see the raw status line, headers
// and body. Values carry over between requests: {id} is the last task this
// page created, {cursor} the last nextCursor, {etag} the last ETag received,
// {key}/{keyId} the last API key created and {token} the last JWT issued.
export function Explorer({ presets }: { presets: Preset[] }) {
  const [req, setReq] = useState<Preset>(presets[0]);
  const [vars, setVars] = useState<Vars>({});
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const url = fill(req.path, vars);
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k, fill(v, vars)]));
  // A body box only when the request has a body (POST /api/token, say, has none).
  const hasBody = (req.method === "POST" || req.method === "PATCH") && req.body !== undefined;
  const used = VAR_NAMES.filter((k) => req.path.includes(`{${k}}`) || Object.values(req.headers ?? {}).some((v) => v.includes(`{${k}}`)));

  const send = async () => {
    setBusy(true);
    const started = performance.now();
    try {
      const r = await fetch(url, {
        method: req.method,
        headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...headers },
        body: hasBody ? req.body ?? "" : undefined,
        // Show the raw exchange: no browser cache answering on the API's behalf.
        cache: "no-store",
      });
      const body = await r.text();
      setRes({ status: r.status, statusText: r.statusText, ms: Math.round(performance.now() - started), headers: [...r.headers].filter(([k]) => SHOWN.has(k)), body });
      // Remember values the next request may need.
      const next: Vars = {};
      const etag = r.headers.get("etag");
      if (etag) next.etag = etag;
      try {
        const data = JSON.parse(body);
        if (r.status === 201 && data.key) { next.key = data.key; next.keyId = data.id; }
        else if (r.status === 201 && data.id) next.id = data.id;
        if (data.access_token) next.token = data.access_token;
        if ("nextCursor" in data) next.cursor = data.nextCursor ?? undefined;
      } catch {}
      setVars((v) => ({ ...v, ...next }));
    } catch (e) {
      setRes({ status: 0, statusText: (e as Error).message, ms: 0, headers: [], body: "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Example requests">
        {presets.map((p) => (
          <Button key={p.label} variant={p === req ? "primary" : "ghost"} aria-pressed={p === req} onClick={() => { setReq(p); setRes(null); }}>
            {p.label}
          </Button>
        ))}
      </div>
      {req.note && <p className="text-sm text-muted">{req.note}</p>}

      <form className="mb-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="explorer-method">Method</label>
        <select id="explorer-method" value={req.method} onChange={(e) => {
          const method = e.target.value as Method;
          setReq({ ...req, method, body: req.body ?? (method === "POST" || method === "PATCH" ? "" : undefined) });
        }}>
          {(["GET", "POST", "PATCH", "DELETE"] as Method[]).map((m) => <option key={m}>{m}</option>)}
        </select>
        <label className="sr-only" htmlFor="explorer-path">Path</label>
        <input id="explorer-path" className="min-w-0 flex-1 basis-60 font-mono text-sm" value={req.path} onChange={(e) => setReq({ ...req, path: e.target.value })} spellCheck={false} />
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send"}</Button>
      </form>
      {hasBody && (
        <>
          <label className="mb-1 block text-sm text-muted" htmlFor="explorer-body">Body (application/json, sent exactly as typed)</label>
          <textarea id="explorer-body" className="mb-2 block h-24 w-full rounded-md border border-line bg-bg p-2 font-mono text-sm" value={req.body ?? ""} onChange={(e) => setReq({ ...req, body: e.target.value })} spellCheck={false} />
        </>
      )}
      {used.length > 0 && (
        <ul className="my-1 list-none pl-0 text-sm text-muted">
          {used.map((k) => (
            <li key={k}>
              <code>{`{${k}}`}</code> = {vars[k] ? <code className="break-all">{vars[k]}</code> : MISSING[k]}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 overflow-hidden rounded-xl border border-line" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-code px-3 py-2 font-mono text-sm">
          <span className={cx("rounded px-1.5 py-0.5 text-xs font-bold text-white", METHOD_BG[req.method])}>{req.method}</span>
          <span className="min-w-0 break-all">{url}</span>
        </div>
        {Object.keys(headers).length > 0 && (
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 border-b border-line bg-code px-3 pb-2 font-mono text-xs">
            {Object.entries(headers).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="m-0 break-all">{v}</dd></div>)}
          </dl>
        )}
        {res ? (
          <div className="px-3 py-2">
            <p className="my-1 font-mono text-sm">
              <strong className={cx(res.status >= 400 || res.status === 0 ? "text-danger" : "text-accent-ink")}>{res.status || "network error"} {res.statusText}</strong>
              <span className="text-muted"> · {res.ms} ms</span>
            </p>
            {res.headers.length > 0 && (
              <dl className="my-1 grid grid-cols-[max-content_1fr] gap-x-3 font-mono text-xs">
                {res.headers.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="m-0 break-all">{v}</dd></div>)}
              </dl>
            )}
            {(() => {
              const token = (() => { try { return JSON.parse(res.body).access_token as string | undefined; } catch { return undefined; } })();
              const decoded = token && decodeJwt(token);
              return decoded ? (
                <div className="mt-2 rounded-lg border border-line p-2">
                  <p className="m-0 text-sm"><strong>Inside the token</strong> <span className="text-muted">(decoded here, without the secret: a JWT is signed, not encrypted)</span></p>
                  <pre className="m-0 mt-1 overflow-auto font-mono text-xs" tabIndex={0}>{JSON.stringify(decoded, null, 2)}</pre>
                </div>
              ) : null;
            })()}
            {res.body
              ? <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-code px-3 py-2 font-mono text-xs" tabIndex={0}>{pretty(res.body)}</pre>
              : <p className="my-1 text-sm text-muted">No body.</p>}
          </div>
        ) : (
          <p className="m-0 px-3 py-2 text-sm text-muted">Press Send to see the response.</p>
        )}
      </div>
    </div>
  );
}
