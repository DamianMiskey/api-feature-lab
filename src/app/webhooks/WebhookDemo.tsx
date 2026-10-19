"use client";

import { useEffect, useState } from "react";
import { Button, cx } from "@/components/ui";

type Endpoint = { id: string; url: string; secret: string; failFirst: number };
type Attempt = { attempt: number; at: string; status: number; response: string };
type Delivery = { id: string; event: { id: number; type: string; data: Record<string, unknown> }; status: "pending" | "delivered" | "failed"; nextAttemptAt: string | null; attempts: Attempt[] };

const post = (url: string, body?: object, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Subscribe a demo inbox, send it events, and watch the sender's log. While a
// delivery is pending the page asks for the log every second; that request is
// also what runs the retries that have come due (see processDue).
export function WebhookDemo() {
  const [failFirst, setFailFirst] = useState(2);
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [forged, setForged] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0); // set when the log arrives (not during prerender)

  const refresh = async (id: string) => {
    const r = await fetch(`/api/webhooks/endpoints/${id}/deliveries`, { cache: "no-store" });
    if (r.ok) setDeliveries((await r.json()).deliveries);
    setNow(Date.now());
  };

  const pending = deliveries.some((d) => d.status === "pending");
  useEffect(() => {
    if (!endpoint || !pending) return;
    const timer = setInterval(() => void refresh(endpoint.id), 1000);
    return () => clearInterval(timer);
  }, [endpoint, pending]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await post("/api/webhooks/endpoints", { failFirst });
      if (r.ok) { setEndpoint(await r.json()); setDeliveries([]); setForged(null); }
    } finally { setBusy(false); }
  };

  const run = async (action: () => Promise<unknown>) => {
    if (!endpoint) return;
    setBusy(true);
    try { await action(); await refresh(endpoint.id); } finally { setBusy(false); }
  };
  const ping = () => run(() => post(`/api/webhooks/endpoints/${endpoint!.id}/ping`));
  const scoreEvent = () => run(() => post("/api/scores", { game: "demo", initials: "WEB", value: Math.floor(Math.random() * 1000) }, { "idempotency-key": crypto.randomUUID() }));
  const forge = () => run(async () => {
    const r = await post(endpoint!.url, { type: "score.submitted", data: { initials: "HAX", value: 999999 } }, {
      "webhook-id": "msg_forged", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,bm90IGEgcmVhbCBzaWduYXR1cmU=",
    });
    setForged(`${r.status}: ${(await r.json()).detail}`);
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="fail-first">The inbox refuses each message</label>
        <select id="fail-first" value={failFirst} onChange={(e) => setFailFirst(Number(e.target.value))}>
          {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n} time{n === 1 ? "" : "s"}</option>)}
        </select>
        <Button onClick={create} disabled={busy}>{endpoint ? "New inbox" : "Create an inbox"}</Button>
      </div>

      {endpoint && (
        <>
          <dl className="my-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 font-mono text-xs">
            <dt className="text-muted">url</dt><dd className="m-0 break-all">{endpoint.url}</dd>
            <dt className="text-muted">secret</dt><dd className="m-0 break-all">{endpoint.secret}</dd>
            <dt className="text-muted">refuses</dt><dd className="m-0">each message {endpoint.failFirst}×, then accepts</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button onClick={ping} disabled={busy}>Send a ping</Button>
            <Button variant="ghost" onClick={scoreEvent} disabled={busy}>Post a demo score</Button>
            <Button variant="ghost" onClick={forge} disabled={busy}>Send a forged message</Button>
          </div>
          {forged && <p className="mb-0 text-sm"><span className="font-semibold text-danger">Forged message refused</span>: <code className="break-all">{forged}</code></p>}

          <ol className="mt-3 grid list-none gap-2 pl-0" aria-live="polite">
            {deliveries.map((d) => (
              <li key={d.id} className="rounded-lg border border-line bg-bg p-3">
                <p className="m-0 flex flex-wrap justify-between gap-2 text-sm">
                  <span><strong>{d.event.type}</strong> <span className="font-mono text-muted">msg_{d.event.id}</span></span>
                  <span className={cx("font-semibold", d.status === "delivered" ? "text-accent-ink" : d.status === "failed" ? "text-danger" : "text-muted")}>
                    {d.status}
                    {d.nextAttemptAt && `, retry in ${Math.max(0, Math.ceil((Date.parse(d.nextAttemptAt) - now) / 1000))}s`}
                  </span>
                </p>
                <ol className="m-0 mt-1 list-none pl-0 font-mono text-xs">
                  {d.attempts.map((a) => (
                    <li key={a.attempt} className="break-all">
                      #{a.attempt} {time(a.at)} → <span className={cx("font-semibold", a.status >= 200 && a.status < 300 ? "text-accent-ink" : "text-danger")}>{a.status || "error"}</span>{" "}
                      <span className="text-muted">{a.response.slice(0, 120)}</span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
