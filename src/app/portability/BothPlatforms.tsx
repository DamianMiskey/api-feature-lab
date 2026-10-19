"use client";

import { useState } from "react";
import { Button, cx } from "@/components/ui";

// Asks both deployments of the same app the same questions, from this
// browser. The Vercel copy is this site itself; the Workers copy answers
// cross-origin (CORS allows api.djmiskey.com to read /api/platform and
// /api/scores there).

export const TARGETS = [
  { name: "Vercel", base: "" },
  { name: "Cloudflare Workers", base: "https://api-cf.djmiskey.com" },
] as const;

type Platform = { platform: string; runtime: string; region: string | null; database: string; dbMs: number };
type Result = { platform: Platform | null; roundTrips: number[]; dbMs: number[]; board: string | null; error?: string };

const ROUNDS = 5;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

async function measure(base: string): Promise<Result> {
  const result: Result = { platform: null, roundTrips: [], dbMs: [], board: null };
  try {
    for (let i = 0; i < ROUNDS; i++) {
      const started = performance.now();
      const r = await fetch(`${base}/api/platform`, { cache: "no-store" });
      const data = (await r.json()) as Platform;
      result.roundTrips.push(Math.round(performance.now() - started));
      result.dbMs.push(data.dbMs);
      result.platform = data;
    }
    const board = await (await fetch(`${base}/api/scores?game=runner&limit=5`, { cache: "no-store" })).json();
    result.board = JSON.stringify(board.entries);
  } catch (e) {
    result.error = (e as Error).message;
  }
  return result;
}

export function BothPlatforms() {
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<{ initials: string; foundOnWorkers: boolean } | null>(null);

  const askBoth = async () => {
    setBusy(true);
    try {
      setResults(await Promise.all(TARGETS.map((t) => measure(t.base))));
    } finally {
      setBusy(false);
    }
  };

  // Write on Vercel, read on Workers: one database behind both.
  const writeThenRead = async () => {
    setBusy(true);
    try {
      const initials = Array.from({ length: 3 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)]).join("");
      const created = await (await fetch("/api/scores", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ game: "demo", initials, value: 999_000 + Math.floor(Math.random() * 1000) }),
      })).json();
      const board = await (await fetch(`${TARGETS[1].base}/api/scores?game=demo&limit=50`, { cache: "no-store" })).json();
      setWritten({ initials, foundOnWorkers: board.entries.some((e: { id: string }) => e.id === created.id) });
    } catch {
      setWritten(null);
    } finally {
      setBusy(false);
    }
  };

  const same = results && results.every((r) => r.board !== null) && results[0].board === results[1].board;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={askBoth} disabled={busy}>{busy ? "Asking…" : "Ask both"}</Button>
        <Button variant="ghost" onClick={writeThenRead} disabled={busy}>Write on Vercel, read on Workers</Button>
      </div>

      {results && (
        <div className="mt-3 grid gap-3 md:grid-cols-2" aria-live="polite">
          {TARGETS.map((t, i) => {
            const r = results[i];
            return (
              <section key={t.name} className="min-w-0 rounded-lg border border-line bg-bg p-3" data-target={t.name}>
                <h3 className="mt-0">{t.name}</h3>
                {r.error || !r.platform ? <p className="m-0 text-sm text-danger">Couldn&apos;t reach it: {r.error}</p> : (
                  <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 text-sm">
                    <dt className="text-muted">platform</dt><dd className="m-0 font-mono">{r.platform.platform}</dd>
                    <dt className="text-muted">runtime</dt><dd className="m-0 font-mono break-all">{r.platform.runtime}</dd>
                    <dt className="text-muted">running in</dt><dd className="m-0 font-mono">{r.platform.region ?? "?"}</dd>
                    <dt className="text-muted">database</dt><dd className="m-0 font-mono">{r.platform.database}</dd>
                    <dt className="text-muted">to the database</dt><dd className="m-0 font-mono">{median(r.dbMs)} ms <span className="text-muted">(median of {ROUNDS})</span></dd>
                    <dt className="text-muted">round trip from you</dt><dd className="m-0 font-mono">{median(r.roundTrips)} ms</dd>
                  </dl>
                )}
              </section>
            );
          })}
          <p className={cx("m-0 text-sm md:col-span-2", same ? "text-accent-ink" : "text-muted")} data-testid="same-data">
            {same ? "Both return exactly the same Starfield Runner board: one database behind two platforms." : "The two boards differ (or one couldn't be read)."}
          </p>
        </div>
      )}

      {written && (
        <p className="mb-0 text-sm" data-testid="cross-write" role="status">
          Posted <strong>{written.initials}</strong> to Vercel&apos;s <code>/api/scores</code>…{" "}
          {written.foundOnWorkers ? "and the Workers copy already lists it." : "but the Workers copy doesn't list it."}
        </p>
      )}
    </div>
  );
}
