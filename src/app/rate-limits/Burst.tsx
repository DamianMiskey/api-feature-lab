"use client";

import { useState } from "react";
import { Button, cx } from "@/components/ui";

type Row = { n: number; status: number; rateLimit: string; retryAfter: string };

// Fires requests at the demo endpoint one after another and records what each
// answer says about the limit.
export function Burst() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setRows([]);
    for (let n = 1; n <= 8; n++) {
      const r = await fetch("/api/limits/demo", { cache: "no-store" });
      const row = { n, status: r.status, rateLimit: r.headers.get("ratelimit") ?? "", retryAfter: r.headers.get("retry-after") ?? "" };
      setRows((all) => [...all, row]);
    }
    setBusy(false);
  };

  return (
    <div>
      <Button onClick={go} disabled={busy}>{busy ? "Sending…" : "Send 8 requests"}</Button>
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto" tabIndex={0} aria-live="polite">
          <table className="w-full border-collapse font-mono text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-1 pr-4 font-normal">#</th><th className="py-1 pr-4 font-normal">Status</th>
                <th className="py-1 pr-4 font-normal">RateLimit</th><th className="py-1 font-normal">Retry-After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.n} className="border-b border-line">
                  <td className="py-1 pr-4">{r.n}</td>
                  <td className={cx("py-1 pr-4 font-semibold", r.status === 429 ? "text-danger" : "text-accent-ink")}>{r.status}</td>
                  <td className="py-1 pr-4">{r.rateLimit}</td>
                  <td className="py-1">{r.retryAfter ? `${r.retryAfter}s` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
