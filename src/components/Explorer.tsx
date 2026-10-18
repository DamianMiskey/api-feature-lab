"use client";

import { useState } from "react";
import { Button, cx } from "./ui";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";
export type Preset = { label: string; method: Method; path: string; body?: string; note?: string };

type Result = { status: number; statusText: string; ms: number; headers: [string, string][]; body: string };

const METHOD_BG: Record<Method, string> = { GET: "bg-get", POST: "bg-post", PATCH: "bg-patch", DELETE: "bg-delete" };
// Headers worth looking at; the rest (date, vary, CSP…) is noise for these demos.
const SHOWN = new Set(["content-type", "location", "content-length", "etag", "cache-control", "retry-after", "allow"]);
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

const pretty = (text: string) => {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};

// A tiny HTTP client on the page: pick a preset or edit the request, send it
// to this site's own API with fetch(), and see the raw status line, headers
// and body. "{id}" in a path is replaced by the last task this page created.
export function Explorer({ presets }: { presets: Preset[] }) {
  const [req, setReq] = useState<Preset>(presets[0]);
  const [lastId, setLastId] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const url = req.path.replace("{id}", lastId ?? PLACEHOLDER_ID);
  const hasBody = req.method === "POST" || req.method === "PATCH";

  const send = async () => {
    setBusy(true);
    const started = performance.now();
    try {
      const r = await fetch(url, {
        method: req.method,
        headers: hasBody ? { "content-type": "application/json" } : undefined,
        body: hasBody ? req.body ?? "" : undefined,
      });
      const body = await r.text();
      setRes({ status: r.status, statusText: r.statusText, ms: Math.round(performance.now() - started), headers: [...r.headers].filter(([k]) => SHOWN.has(k)), body });
      // Remember a newly created task, so the next request can use its id.
      if (r.status === 201) {
        try { setLastId(JSON.parse(body).id); } catch {}
      }
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
        <select id="explorer-method" value={req.method} onChange={(e) => setReq({ ...req, method: e.target.value as Method })}>
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
      {req.path.includes("{id}") && (
        <p className="text-sm text-muted">
          <code>{"{id}"}</code> = {lastId ? <code>{lastId}</code> : <>no task created yet, so a made-up id (send <em>Create</em> first)</>}
        </p>
      )}

      <div className="mt-3 overflow-hidden rounded-xl border border-line" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-code px-3 py-2 font-mono text-sm">
          <span className={cx("rounded px-1.5 py-0.5 text-xs font-bold text-white", METHOD_BG[req.method])}>{req.method}</span>
          <span className="min-w-0 break-all">{url}</span>
        </div>
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
