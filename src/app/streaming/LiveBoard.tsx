"use client";

import { useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";

type Entry = { rank: number; id: string; initials: string; value: number };
type Board = { name: string; entries: Entry[]; latest?: { id: string } };
type Line = { at: string; text: string };

const GAMES = [["demo", "Lab demo"], ["runner", "Starfield Runner"], ["stacker", "Stacker"], ["toppler", "Tower Toppler"], ["marble", "Marble Maze"]] as const;
const LISTEN_MS = 120_000; // the page hangs up after two minutes: an open stream keeps a function busy
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const clock = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const showValue = (game: string, v: number) => (game === "marble" ? `${(v / 1000).toFixed(1)}s` : v.toLocaleString("en"));

// EventSource is the browser's built-in SSE client: it parses the stream,
// fires one event per message, and when the stream ends it reconnects by
// itself, sending the last id it saw as Last-Event-ID.
export function LiveBoard() {
  const [game, setGame] = useState<string>("demo");
  const [board, setBoard] = useState<Board | null>(null);
  const [log, setLog] = useState<Line[]>([]);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);

  const say = (text: string) => setLog((l) => [{ at: clock(), text }, ...l].slice(0, 12));

  const stop = () => {
    source.current?.close();
    source.current = null;
    setLive(false);
  };

  useEffect(() => {
    if (!live) return;
    const es = new EventSource(`/api/scores/stream?game=${game}`);
    source.current = es;
    let lastId = "";
    es.addEventListener("open", () => say(lastId ? `reconnected, with Last-Event-ID: ${lastId}` : "connected"));
    es.addEventListener("board", (e) => {
      lastId = e.lastEventId;
      const data = JSON.parse(e.data) as Board;
      setBoard(data);
      if (data.latest) setFlash(data.latest.id);
      say(`event: board, id: ${e.lastEventId}${data.latest ? " (a new score)" : " (the board as it is)"}`);
    });
    es.addEventListener("error", () => {
      if (es.readyState === EventSource.CONNECTING) say("the stream ended; the browser reconnects in 3s (retry: 3000)");
    });
    const timer = setTimeout(() => { say("stopped listening after two minutes"); stop(); }, LISTEN_MS);
    return () => { clearTimeout(timer); es.close(); };
  }, [live, game]);

  const post = async () => {
    const initials = Array.from({ length: 3 }, () => LETTERS[Math.floor(Math.random() * 26)]).join("");
    await fetch("/api/scores", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ game: "demo", initials, value: Math.floor(Math.random() * 10_000) }),
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="board-game">Board</label>
        <select id="board-game" value={game} onChange={(e) => { stop(); setBoard(null); setLog([]); setGame(e.target.value); }}>
          {GAMES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {live
          ? <Button variant="ghost" onClick={() => { say("disconnected"); stop(); }}>Disconnect</Button>
          : <Button onClick={() => { setLog([]); setLive(true); }}>Connect</Button>}
        {game === "demo" && <Button variant="ghost" onClick={post} disabled={!live}>Post a random score</Button>}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-line bg-bg p-3">
          <h3 className="mt-0">{board?.name ?? "Leaderboard"}</h3>
          {board && board.entries.length === 0 && <p className="m-0 text-sm text-muted">No scores yet.</p>}
          <ol className="m-0 list-none pl-0 font-mono text-sm">
            {board?.entries.map((e) => (
              <li key={e.id} className={cx("flex justify-between gap-3 rounded px-1", e.id === flash && "bg-code font-semibold text-accent-ink")}>
                <span>{e.rank}. {e.initials}</span><span className="tabular-nums">{showValue(game, e.value)}</span>
              </li>
            ))}
          </ol>
          {!board && <p className="m-0 text-sm text-muted">Connect to load it.</p>}
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-bg p-3">
          <h3 className="mt-0">What arrived</h3>
          <ol className="m-0 list-none pl-0 font-mono text-xs" aria-live="polite">
            {log.map((l, i) => <li key={`${l.at}-${i}`} className="break-words"><span className="text-muted">{l.at}</span> {l.text}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}
