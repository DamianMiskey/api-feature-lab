"use client";

import { useState } from "react";
import { Button, cx } from "@/components/ui";

type Task = { id: string; title: string };
type Run = { offset: [Task[], Task[]]; cursor: [Task[], Task[]]; inserted: string };

const get = async (url: string) => (await fetch(url, { cache: "no-store" })).json();
const post = async (title: string) =>
  (await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) })).json();

// Pages through the tasks twice at the same time, three per page: once with
// ?offset=, once with ?cursor=. Between page 1 and page 2 a new task is
// created, as another visitor might. Offset counts rows from the top, so the
// new row pushes everything down and page 2 repeats the end of page 1. The
// cursor says "after this task", which the new row doesn't change.
export function OffsetVsCursor() {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      // The comparison needs at least two pages of tasks to work with.
      const { items } = await get("/api/tasks?limit=6");
      for (let i = items.length; i < 6; i++) await post(`Sample task ${i + 1}`);
      const offset1 = await get("/api/tasks?limit=3&offset=0");
      const cursor1 = await get("/api/tasks?limit=3");
      const inserted = await post("Created between page 1 and page 2");
      const offset2 = await get("/api/tasks?limit=3&offset=3");
      const cursor2 = await get(`/api/tasks?limit=3&cursor=${cursor1.nextCursor}`);
      await fetch(`/api/tasks/${inserted.id}`, { method: "DELETE" }); // tidy up
      setRun({ offset: [offset1.items, offset2.items], cursor: [cursor1.items, cursor2.items], inserted: inserted.id });
    } finally {
      setBusy(false);
    }
  };

  const column = (title: string, [p1, p2]: [Task[], Task[]]) => {
    const firstIds = new Set(p1.map((t) => t.id));
    return (
      <div className="min-w-0 flex-1 basis-60 rounded-lg border border-line bg-bg p-3">
        <h3 className="mt-0">{title}</h3>
        {[p1, p2].map((items, n) => (
          <div key={n}>
            <p className="mb-1 text-xs tracking-wider text-muted uppercase">Page {n + 1}</p>
            <ol className="mb-2">
              {items.map((t) => {
                const repeat = n === 1 && firstIds.has(t.id);
                return <li key={t.id} className={cx("text-sm", repeat && "font-semibold text-danger")}>{t.title}{repeat && " (again!)"}</li>;
              })}
            </ol>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <Button onClick={go} disabled={busy}>{busy ? "Paging…" : "Run the comparison"}</Button>
      <p className="text-sm text-muted">Creates a task between the two pages, then deletes it. If there are fewer than six tasks, it adds sample tasks first.</p>
      {run && (
        <div className="mt-3 flex flex-wrap gap-3" aria-live="polite">
          {column("?offset=", run.offset)}
          {column("?cursor=", run.cursor)}
        </div>
      )}
    </div>
  );
}
