"use client";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { useState } from "react";
import type { AppRouter } from "@/api/trpc";
import { Button, cx } from "@/components/ui";

// The same three questions asked three ways, for real. Every HTTP exchange
// is recorded as it happens: how many requests, how many bytes came back,
// and the raw bodies. (Bytes are the JSON as received, before compression.)

type Exchange = { method: string; url: string; status: number; bytes: number; body: string };
type Style = "REST" | "tRPC" | "GraphQL";
type Run = Record<Style, { exchanges: Exchange[]; code: string }>;

const encoder = new TextEncoder();

function recorder() {
  const exchanges: Exchange[] = [];
  const fetchAndRecord = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, { ...init, cache: "no-store" });
    const body = await res.clone().text();
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    exchanges.push({ method: init?.method ?? "GET", url: decodeURIComponent(url.pathname + url.search), status: res.status, bytes: encoder.encode(body).length, body });
    return res;
  };
  return { exchanges, fetch: fetchAndRecord };
}

// The tRPC client knows every procedure, input and output from the router's
// type alone: `import type` brings no server code into this bundle.
const trpcWith = (f: typeof fetch) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: "/api/trpc", fetch: f })] });

const graphql = (f: typeof fetch, query: string) =>
  f("/api/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });

type Scenario = { label: string; code: Record<Style, string>; run: Record<Style, (f: typeof fetch) => Promise<unknown>> };

const SCENARIOS: Scenario[] = [
  {
    label: "Top 3 on Runner",
    code: {
      REST: `fetch("/api/scores?game=runner&limit=3")`,
      tRPC: `trpc.scores.top.query({ game: "runner", limit: 3 })`,
      GraphQL: `{ leaderboard(game: runner, limit: 3) {\n    entries { rank initials value }\n} }`,
    },
    run: {
      REST: (f) => f("/api/scores?game=runner&limit=3"),
      tRPC: (f) => trpcWith(f).scores.top.query({ game: "runner", limit: 3 }),
      GraphQL: (f) => graphql(f, "{ leaderboard(game: runner, limit: 3) { entries { rank initials value } } }"),
    },
  },
  {
    label: "A dashboard: two boards and the newest tasks",
    code: {
      REST: `Promise.all([\n  fetch("/api/scores?game=runner&limit=3"),\n  fetch("/api/scores?game=stacker&limit=3"),\n  fetch("/api/tasks?limit=3"),\n])`,
      tRPC: `Promise.all([\n  trpc.scores.top.query({ game: "runner", limit: 3 }),\n  trpc.scores.top.query({ game: "stacker", limit: 3 }),\n  trpc.tasks.newest.query({ limit: 3 }),\n])  // batched into one request`,
      GraphQL: `{\n  runner: leaderboard(game: runner, limit: 3) { entries { initials value } }\n  stacker: leaderboard(game: stacker, limit: 3) { entries { initials value } }\n  tasks(limit: 3) { title done }\n}`,
    },
    run: {
      REST: (f) => Promise.all([f("/api/scores?game=runner&limit=3"), f("/api/scores?game=stacker&limit=3"), f("/api/tasks?limit=3")]),
      tRPC: (f) => {
        const trpc = trpcWith(f);
        return Promise.all([trpc.scores.top.query({ game: "runner", limit: 3 }), trpc.scores.top.query({ game: "stacker", limit: 3 }), trpc.tasks.newest.query({ limit: 3 })]);
      },
      GraphQL: (f) => graphql(f, "{ runner: leaderboard(game: runner, limit: 3) { entries { initials value } } stacker: leaderboard(game: stacker, limit: 3) { entries { initials value } } tasks(limit: 3) { title done } }"),
    },
  },
  {
    label: "A mistake: a game that doesn't exist",
    code: {
      REST: `fetch("/api/scores?game=pong")`,
      tRPC: `// TypeScript rejects this line before it ever runs;\n// the demo forces it through with a cast.\ntrpc.scores.top.query({ game: "pong" as never })`,
      GraphQL: `{ leaderboard(game: pong) { entries { rank } } }`,
    },
    run: {
      REST: (f) => f("/api/scores?game=pong"),
      tRPC: (f) => trpcWith(f).scores.top.query({ game: "pong" as never }).catch(() => null),
      GraphQL: (f) => graphql(f, "{ leaderboard(game: pong) { entries { rank } } }"),
    },
  },
];

const STYLES: Style[] = ["REST", "tRPC", "GraphQL"];
const pretty = (text: string) => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } };

export function Compare() {
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (i: number) => {
    setIndex(i);
    setBusy(true);
    try {
      const scenario = SCENARIOS[i];
      const result = {} as Run;
      for (const style of STYLES) {
        const rec = recorder();
        await scenario.run[style](rec.fetch as typeof fetch).catch(() => null);
        result[style] = { exchanges: rec.exchanges, code: scenario.code[style] };
      }
      setRun(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Questions">
        {SCENARIOS.map((s, i) => (
          <Button key={s.label} variant={run && i === index ? "primary" : "ghost"} aria-pressed={!!run && i === index} disabled={busy} onClick={() => go(i)}>{s.label}</Button>
        ))}
      </div>
      {!run && <p className="m-0 text-sm text-muted">Pick a question to send it all three ways.</p>}
      {run && (
        <div className="grid gap-3 lg:grid-cols-3" aria-live="polite">
          {STYLES.map((style) => {
            const { exchanges, code } = run[style];
            const bytes = exchanges.reduce((n, e) => n + e.bytes, 0);
            return (
              <section key={style} className="min-w-0 rounded-lg border border-line bg-bg p-3" data-style={style}>
                <h3 className="mt-0 flex items-baseline justify-between gap-2">
                  {style}
                  <span className="text-sm font-normal text-muted" data-testid="totals">
                    {exchanges.length} request{exchanges.length === 1 ? "" : "s"} · {bytes.toLocaleString("en")} bytes
                  </span>
                </h3>
                <pre className="m-0 mb-2 overflow-x-auto rounded bg-code px-2 py-1.5 font-mono text-xs" tabIndex={0}>{code}</pre>
                {exchanges.map((e, i) => (
                  <details key={i} className="mb-1" open={exchanges.length === 1}>
                    <summary className="cursor-pointer font-mono text-xs break-all">
                      <span className={cx("font-semibold", e.status >= 400 ? "text-danger" : "text-accent-ink")}>{e.status}</span> {e.method} {e.url}
                    </summary>
                    <pre className="m-0 mt-1 max-h-60 overflow-auto rounded bg-code px-2 py-1.5 font-mono text-xs" tabIndex={0}>{pretty(e.body)}</pre>
                  </details>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
