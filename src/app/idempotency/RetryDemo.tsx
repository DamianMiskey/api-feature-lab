"use client";

import { useState } from "react";
import { Button, cx } from "@/components/ui";

type Shot = { label: string; key: string; status: number; replayed: boolean; body: { id?: string; rank?: number; value?: number; type?: string; title?: string } };

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const initials = () => Array.from({ length: 3 }, () => LETTERS[Math.floor(Math.random() * 26)]).join("");

async function submit(label: string, key: string, body: object): Promise<Shot> {
  const r = await fetch("/api/scores", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `"${key}"` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return { label, key, status: r.status, replayed: r.headers.get("idempotent-replayed") === "true", body: await r.json() };
}

// One score, sent the way a game on a bad connection might: the response is
// "lost", so the same request goes again with the same key. Then the same key
// with a different score, which is a client bug the server refuses.
export function RetryDemo() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setShots([]);
    try {
      const key = crypto.randomUUID();
      const score = { game: "demo", initials: initials(), value: 100 + Math.floor(Math.random() * 900) };
      const first = await submit("1. First attempt (pretend the answer never arrives)", key, score);
      setShots([first]);
      const retry = await submit("2. Retry: same key, same score", key, score);
      setShots((s) => [...s, retry]);
      const wrong = await submit("3. Same key, different score", key, { ...score, value: score.value + 1 });
      setShots((s) => [...s, wrong]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button onClick={go} disabled={busy}>{busy ? "Sending…" : "Submit a score, then retry it"}</Button>
      {shots.length > 0 && (
        <p className="mb-0 text-sm text-muted">Idempotency-Key: <code className="break-all">&quot;{shots[0].key}&quot;</code></p>
      )}
      <ol className="mt-3 grid list-none gap-2 pl-0" aria-live="polite">
        {shots.map((s) => (
          <li key={s.label} className="rounded-lg border border-line bg-bg p-3">
            <p className="m-0 text-sm font-semibold">{s.label}</p>
            <p className="m-0 font-mono text-sm">
              <span className={cx("font-semibold", s.status >= 400 ? "text-danger" : "text-accent-ink")}>{s.status}</span>
              {s.replayed && <span> · Idempotent-Replayed: true</span>}
            </p>
            <p className="m-0 text-sm text-muted break-all">
              {s.body.id ? <>score <code>{s.body.id}</code>, rank {s.body.rank}, value {s.body.value}</> : s.body.title}
            </p>
          </li>
        ))}
      </ol>
      {shots.length === 3 && (
        <p className="text-sm text-muted">
          The first two answers carry the same score id: the retry was <strong>replayed</strong> from what the server stored, not
          run again, so the board got one entry. The third reused the key for something else, which is refused.
        </p>
      )}
    </div>
  );
}
