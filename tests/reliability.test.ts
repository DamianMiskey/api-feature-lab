import { describe, expect, it } from "vitest";
import { app } from "@/api/app";
import { backoff, MAX_ATTEMPTS, newSecret, processDue, setTransport, sign, verify } from "@/api/webhooks";

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const score = (body: unknown, key: string | null = crypto.randomUUID(), ip = "203.0.113.20") =>
  send("POST", "/scores", body, { "x-real-ip": ip, ...(key === null ? {} : { "idempotency-key": `"${key}"` }) });

describe("idempotency keys", () => {
  it("POST /scores needs one", async () => {
    const res = await score({ game: "runner", initials: "ACE", value: 10 }, null);
    expect(res.status).toBe(400);
    expect((await res.json()).type).toContain("idempotency-key-missing");
  });

  it("a retry with the same key replays the first answer instead of scoring twice", async () => {
    const key = crypto.randomUUID();
    const first = await score({ game: "stacker", initials: "AAA", value: 7 }, key);
    expect(first.status).toBe(201);
    const second = await send("POST", "/scores", { game: "stacker", initials: "AAA", value: 7 },
      { "x-real-ip": "203.0.113.20", "idempotency-key": `"${key}"`, origin: "https://motion.djmiskey.com" });
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    // The game reads the replayed answer cross-origin, so it needs CORS headers too.
    expect(second.headers.get("access-control-allow-origin")).toBe("https://motion.djmiskey.com");
    expect(await second.json()).toEqual(await first.json());
    const board = await (await send("GET", "/scores?game=stacker&limit=50")).json();
    expect(board.entries.filter((e: { initials: string; value: number }) => e.initials === "AAA" && e.value === 7)).toHaveLength(1);
  });

  it("the same key with a different body is a 422; a different client has its own keys", async () => {
    const key = crypto.randomUUID();
    await score({ game: "runner", initials: "BOB", value: 100 }, key);
    const reused = await score({ game: "runner", initials: "BOB", value: 999 }, key);
    expect(reused.status).toBe(422);
    expect((await reused.json()).type).toContain("idempotency-key-reused");
    expect((await score({ game: "runner", initials: "BOB", value: 999 }, key, "198.51.100.9")).status).toBe(201);
  });

  it("a failed request doesn't use up its key: fix the body and retry", async () => {
    const key = crypto.randomUUID();
    expect((await score({ game: "runner", initials: "bob", value: 1 }, key)).status).toBe(422);
    expect((await score({ game: "runner", initials: "BOB", value: 1 }, key)).status).toBe(201);
  });

  it("two concurrent requests with one key: exactly one score is created", async () => {
    const key = crypto.randomUUID();
    const body = { game: "toppler", initials: "CON", value: 4321 };
    const results = await Promise.all([score(body, key), score(body, key), score(body, key)]);
    const created = await Promise.all(results.filter((r) => r.status === 201).map((r) => r.json()));
    expect(new Set(created.map((c) => c.id)).size).toBe(1);
    for (const r of results) expect([201, 409]).toContain(r.status);
  });

  it("is optional on POST /tasks, and works there too", async () => {
    expect((await send("POST", "/tasks", { title: "no key" })).status).toBe(201);
    const key = { "idempotency-key": crypto.randomUUID() };
    const a = await (await send("POST", "/tasks", { title: "once" }, key)).json();
    const again = await send("POST", "/tasks", { title: "once" }, key);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.headers.get("location")).toBe(`/api/tasks/${a.id}`);
    expect((await again.json()).id).toBe(a.id);
  });
});

describe("leaderboards", () => {
  it("validate initials, game and range", async () => {
    const res = await score({ game: "pong", initials: "TOOLONG", value: -1 });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.map((e: { path: string }) => e.path).sort()).toEqual(["game", "initials", "value"]);
    expect((await score({ game: "stacker", initials: "MAX", value: 501 })).status).toBe(422);
  });

  it("rank best first: higher points, but lower times for Marble Maze", async () => {
    for (const [initials, value] of [["SLO", 90_000], ["FST", 30_000], ["MID", 60_000]] as const) {
      await score({ game: "marble", initials, value });
    }
    const created = await (await score({ game: "marble", initials: "TOP", value: 1_000 })).json();
    expect(created.rank).toBe(1);
    const board = await (await send("GET", "/scores?game=marble")).json();
    expect(board).toMatchObject({ game: "marble", unit: "ms", better: "lower" });
    const values = board.entries.map((e: { value: number }) => e.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(board.entries[0]).toMatchObject({ rank: 1, initials: "TOP" });
  });

  it("send an ETag, and 304 while nothing changes", async () => {
    const first = await send("GET", "/scores?game=runner");
    const etag = first.headers.get("etag")!;
    expect((await send("GET", "/scores?game=runner", undefined, { "if-none-match": etag })).status).toBe(304);
  });

  it("allow the Motion lab's origin (CORS), and not others", async () => {
    const preflight = await send("OPTIONS", "/scores", undefined, {
      origin: "https://motion.djmiskey.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type, idempotency-key",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://motion.djmiskey.com");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("idempotency-key");
    const read = await send("GET", "/scores?game=runner", undefined, { origin: "https://motion.djmiskey.com" });
    expect(read.headers.get("access-control-expose-headers")).toContain("idempotent-replayed");
    const other = await send("GET", "/scores?game=runner", undefined, { origin: "https://evil.example" });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("are rate limited per client", async () => {
    const before = process.env.LAB_SCORE_LIMIT;
    process.env.LAB_SCORE_LIMIT = "2";
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await score({ game: "runner", initials: "SPM", value: i }, undefined, "192.0.2.77")).status);
      expect(statuses).toEqual([201, 201, 429]);
    } finally {
      process.env.LAB_SCORE_LIMIT = before;
    }
  });
});

describe("webhook signatures", () => {
  it("verify what was signed, and nothing else", async () => {
    const secret = newSecret();
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = await sign(secret, "msg_1", ts, '{"a":1}');
    expect(signature).toMatch(/^v1,[A-Za-z0-9+/]+=*$/);
    expect(await verify(secret, { id: "msg_1", timestamp: ts, signature }, '{"a":1}')).toBeNull();
    expect(await verify(secret, { id: "msg_1", timestamp: ts, signature }, '{"a":2}')).toBe("no signature matches");
    expect(await verify(newSecret(), { id: "msg_1", timestamp: ts, signature }, '{"a":1}')).toBe("no signature matches");
    // Several signatures (during a key rotation): one good one is enough.
    expect(await verify(secret, { id: "msg_1", timestamp: ts, signature: `v1,bm9wZQ== ${signature}` }, '{"a":1}')).toBeNull();
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(await verify(secret, { id: "msg_1", timestamp: old, signature: await sign(secret, "msg_1", old, "{}") }, "{}")).toContain("timestamp");
  });

  it("the inbox refuses unsigned or forged messages", async () => {
    const { id } = await (await send("POST", "/webhooks/endpoints", { failFirst: 0 })).json();
    const forged = await send("POST", `/webhooks/inbox/${id}`, '{"type":"ping"}', {
      "webhook-id": "msg_x", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,AAAA",
    });
    expect(forged.status).toBe(401);
    expect((await forged.json()).type).toContain("invalid-signature");
  });
});

describe("webhook delivery", () => {
  const later = (seconds: number) => new Date(Date.now() + seconds * 1000 + 50);
  const log = async (id: string) => (await (await send("GET", `/webhooks/endpoints/${id}/deliveries`)).json());

  it("retries with backoff until the subscriber accepts", async () => {
    const endpoint = await (await send("POST", "/webhooks/endpoints", { failFirst: 2 })).json();
    expect(endpoint.secret).toMatch(/^whsec_/);
    const ping = await send("POST", `/webhooks/endpoints/${endpoint.id}/ping`);
    expect(ping.status).toBe(202);

    let [delivery] = (await log(endpoint.id)).deliveries;
    expect(delivery).toMatchObject({ status: "pending", event: { type: "ping" } });
    expect(delivery.attempts.map((a: { status: number }) => a.status)).toEqual([503]);
    // Not due yet: nothing happens.
    expect(await processDue({ endpointId: endpoint.id })).toBe(0);

    await processDue({ endpointId: endpoint.id, now: later(backoff(1)) });
    await processDue({ endpointId: endpoint.id, now: later(backoff(1) + backoff(2) + 30) });
    [delivery] = (await log(endpoint.id)).deliveries;
    expect(delivery.status).toBe("delivered");
    expect(delivery.attempts.map((a: { status: number }) => a.status)).toEqual([503, 503, 200]);
    expect(JSON.parse(delivery.attempts[2].response)).toEqual({ received: true, duplicate: false });
  });

  it("gives up after the last attempt (a dead letter)", async () => {
    const endpoint = await (await send("POST", "/webhooks/endpoints", { failFirst: 0 })).json();
    // The subscriber's server is down: every attempt fails.
    setTransport(async () => new Response("Bad gateway", { status: 502 }));
    try {
      await send("POST", `/webhooks/endpoints/${endpoint.id}/ping`);
      for (let i = 1; i < MAX_ATTEMPTS + 2; i++) await processDue({ endpointId: endpoint.id, now: later(i * 120) });
    } finally {
      setTransport((request) => Promise.resolve(app.fetch(request)));
    }
    const [delivery] = (await log(endpoint.id)).deliveries;
    expect(delivery.status).toBe("failed");
    expect(delivery.nextAttemptAt).toBeNull();
    expect(delivery.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(delivery.attempts.every((a: { status: number }) => a.status === 502)).toBe(true);
  });

  it("a new score is delivered to subscribed inboxes, and a redelivery is a duplicate", async () => {
    const endpoint = await (await send("POST", "/webhooks/endpoints", { failFirst: 0 })).json();
    const created = await (await score({ game: "runner", initials: "HKS", value: 777 })).json();
    const { deliveries } = await log(endpoint.id);
    const mine = deliveries.find((d: { event: { data: { id?: string } } }) => d.event.data.id === created.id);
    expect(mine).toMatchObject({ status: "delivered", event: { type: "score.submitted", data: { initials: "HKS", value: 777 } } });

    // Replay the exact message by hand, as a sender would after a lost 200.
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "score.submitted", timestamp: new Date().toISOString(), data: {} });
    const msg = `msg_${mine.event.id}`;
    const res = await send("POST", `/webhooks/inbox/${endpoint.id}`, body, { "webhook-id": msg, "webhook-timestamp": ts, "webhook-signature": await sign(endpoint.secret, msg, ts, body) });
    expect(await res.json()).toEqual({ received: true, duplicate: true });
  });
});

describe("Server-Sent Events", () => {
  async function* events(res: Response) {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const fields = Object.fromEntries(block.split("\n").filter((l) => !l.startsWith(":")).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
          if (fields.event) yield fields as { event: string; id: string; data: string; retry?: string };
        }
      }
    } finally {
      await reader.cancel();
    }
  }

  it("send the board, then the board again when a score arrives; reconnects resume", async () => {
    const res = await send("GET", "/scores/stream?game=toppler&limit=5");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const stream = events(res);
    const first = (await stream.next()).value!;
    expect(first).toMatchObject({ event: "board", retry: "3000" });
    expect(JSON.parse(first.data)).toMatchObject({ game: "toppler", better: "higher" });

    await score({ game: "toppler", initials: "SSE", value: 19_999 });
    const second = (await stream.next()).value!;
    const board = JSON.parse(second.data);
    expect(board.latest).toMatchObject({ initials: "SSE", value: 19_999, rank: 1 });
    expect(board.entries[0].initials).toBe("SSE");
    expect(Number(second.id)).toBeGreaterThan(Number(first.id));
    await stream.return(undefined);

    // Reconnecting with the id it missed from: the missed score comes first.
    await score({ game: "toppler", initials: "GAP", value: 19_998 });
    const resumed = events(await send("GET", "/scores/stream?game=toppler", undefined, { "last-event-id": second.id }));
    expect(JSON.parse((await resumed.next()).value!.data).latest.initials).toBe("GAP");
    await resumed.return(undefined);
  });
});
