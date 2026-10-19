import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, gt, lt, notInArray, or, sql } from "drizzle-orm";
import { streamSSE } from "hono/streaming";
import type { AuthEnv } from "../auth";
import { db } from "../db/client";
import { events, type ScoreRow, scores } from "../db/schema";
import { etagFor, isNotModified } from "../http";
import { idempotency } from "../idempotency";
import { Problem } from "../problem";
import { rateLimit } from "../ratelimit";
import { validationHook } from "../validation";
import { processDue, recordEvent } from "../webhooks";

// Leaderboards for the Motion lab's games (https://motion.djmiskey.com). The
// games post a score when a run ends; retries carry the same Idempotency-Key,
// so a flaky connection can't put one run on the board twice.

export const GAMES = {
  toppler: { name: "Tower Toppler", unit: "points", better: "higher", max: 20_000 },
  marble: { name: "Marble Maze", unit: "ms", better: "lower", max: 3_600_000 }, // all three levels, in milliseconds
  stacker: { name: "Stacker", unit: "slabs", better: "higher", max: 500 },
  runner: { name: "Starfield Runner", unit: "points", better: "higher", max: 1_000_000 },
  // For this lab's own pages, so trying the demos doesn't touch the games' boards.
  demo: { name: "Lab demo", unit: "points", better: "higher", max: 1_000_000 },
} as const;
export type Game = keyof typeof GAMES;
const GAME_IDS = Object.keys(GAMES) as [Game, ...Game[]];

const KEEP_PER_GAME = 100;
const STREAM_SECONDS = Number(process.env.LAB_SSE_SECONDS ?? 25);

// A score can't be checked: the game runs in the visitor's browser, so anyone
// can post any number. The limits below only keep the board plausible; a
// game where cheating matters would run (or replay) the game on the server.
const NewScore = z
  .strictObject({
    game: z.enum(GAME_IDS),
    initials: z.string().regex(/^[A-Z]{3}$/, "Three capital letters, A–Z"),
    value: z.number().int().min(0),
  })
  .superRefine((s, ctx) => {
    const game = GAMES[s.game];
    if (game && s.value > game.max) ctx.addIssue({ code: "custom", path: ["value"], message: `At most ${game.max} for ${game.name}` });
  })
  .openapi("NewScore", { example: { game: "runner", initials: "ACE", value: 1234 } });

const Entry = z.object({ rank: z.number().int(), id: z.uuid(), initials: z.string(), value: z.number().int(), createdAt: z.iso.datetime() }).openapi("ScoreEntry");
const Board = z
  .object({ game: z.enum(GAME_IDS), name: z.string(), unit: z.string(), better: z.enum(["higher", "lower"]), entries: z.array(Entry) })
  .openapi("Leaderboard");
const Created = z.object({ id: z.uuid(), game: z.enum(GAME_IDS), initials: z.string(), value: z.number().int(), rank: z.number().int(), createdAt: z.iso.datetime() }).openapi("Score");

const GameQuery = z.object({
  game: z.enum(GAME_IDS).openapi({ description: "toppler, marble, stacker, runner, or demo (this lab's pages)" }),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const problemResponse = (description: string) => ({ content: { "application/problem+json": { schema: Problem } }, description });

// Best first. Ties go to whoever got there first.
const order = (game: Game) => GAMES[game].better === "higher" ? [desc(scores.value), asc(scores.createdAt)] : [asc(scores.value), asc(scores.createdAt)];

export async function board(game: Game, limit = 10): Promise<z.infer<typeof Board>> {
  const rows = await (await db()).select().from(scores).where(eq(scores.game, game)).orderBy(...order(game)).limit(limit);
  const { name, unit, better } = GAMES[game];
  return { game, name, unit, better, entries: rows.map((r, i) => ({ rank: i + 1, id: r.id, initials: r.initials, value: r.value, createdAt: r.createdAt.toISOString() })) };
}

/** 1 + how many scores beat this one (better value, or the same value earlier). */
async function rankOf(row: ScoreRow) {
  const game = row.game as Game;
  const better = GAMES[game].better === "higher" ? gt(scores.value, row.value) : lt(scores.value, row.value);
  const [{ n }] = await (await db()).select({ n: sql<number>`count(*)::int` }).from(scores)
    .where(and(eq(scores.game, game), or(better, and(eq(scores.value, row.value), lt(scores.createdAt, row.createdAt)))));
  return Number(n) + 1;
}

export const scoresApi = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });

scoresApi.openapi(
  createRoute({
    method: "get", path: "/scores", tags: ["Leaderboards"], summary: "A game's leaderboard, best first",
    request: { query: GameQuery },
    responses: {
      200: { ...json(Board, "The top scores"), headers: z.object({ ETag: z.string() }) },
      304: { description: "Not modified since the ETag you sent" },
      422: problemResponse("Unknown game or bad limit"),
    },
  }),
  async (c) => {
    const { game, limit } = c.req.valid("query");
    const body = await board(game, limit);
    const etag = await etagFor(body);
    c.header("ETag", etag);
    c.header("Cache-Control", "no-cache");
    return isNotModified(c, etag) ? c.body(null, 304) : c.json(body, 200);
  },
);

scoresApi.openapi(
  createRoute({
    method: "post", path: "/scores", tags: ["Leaderboards"],
    summary: "Submit a score (Idempotency-Key required: retries with the same key are replayed, not counted again)",
    middleware: [
      rateLimit({ name: "scores", windowSec: 60, limit: () => Number(process.env.LAB_SCORE_LIMIT ?? 10) }),
      idempotency({ required: true }),
    ] as const,
    request: {
      headers: z.object({ "idempotency-key": z.string().optional().openapi({ description: "A unique value per score, e.g. a UUID. Required", example: '"5d1f6c2a-7f4e-4a59-9b8e-0d6c3a2b1e7f"' }) }),
      body: { content: { "application/json": { schema: NewScore } }, required: true },
    },
    responses: {
      201: { ...json(Created, "On the board, with its rank. A replay has Idempotent-Replayed: true") },
      400: problemResponse("No Idempotency-Key, or the body isn't JSON"),
      409: problemResponse("The first request with this key is still running"),
      422: problemResponse("Invalid score, or the key was used for a different score"),
      429: problemResponse("More than 10 scores a minute"),
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const d = await db();
    const [row] = await d.insert(scores).values({ ...input, createdAt: new Date() }).returning();
    const rank = await rankOf(row);
    // Only the best 100 per game are kept.
    const keep = d.select({ id: scores.id }).from(scores).where(eq(scores.game, input.game)).orderBy(...order(input.game)).limit(KEEP_PER_GAME);
    await d.delete(scores).where(and(eq(scores.game, input.game), notInArray(scores.id, keep)));
    const created = { id: row.id, game: input.game, initials: row.initials, value: row.value, rank, createdAt: row.createdAt.toISOString() };
    // Tell the subscribers: the event is stored first, then each webhook gets
    // its first attempt now; failures are retried later.
    const { event } = await recordEvent("score.submitted", created);
    await processDue({ eventId: event.id });
    return c.json(created, 201);
  },
);

scoresApi.openapi(
  createRoute({
    method: "get", path: "/scores/stream", tags: ["Leaderboards"],
    summary: "Server-Sent Events: the leaderboard, again each time it changes",
    request: {
      query: GameQuery,
      headers: z.object({ "last-event-id": z.string().optional().openapi({ description: "Sent by EventSource on reconnect: resume after this event" }) }),
    },
    responses: {
      200: { content: { "text/event-stream": { schema: z.string() } }, description: "event: board, data: a Leaderboard, id: the event it's up to date with" },
      422: problemResponse("Unknown game"),
    },
  }),
  (c) => {
    const { game, limit } = c.req.valid("query");
    const resumeFrom = Number(c.req.header("last-event-id"));
    return streamSSE(c, async (stream) => {
      const d = await db();
      let cursor: number;
      if (Number.isSafeInteger(resumeFrom) && resumeFrom > 0) {
        // A reconnect: only what's new since the last event the client saw.
        cursor = resumeFrom;
        await stream.write("retry: 3000\n\n");
      } else {
        // A new client: the board as it is now, tagged with the latest event id.
        const [{ max }] = await d.select({ max: sql<number>`coalesce(max(${events.id}), 0)` }).from(events);
        cursor = Number(max);
        await stream.writeSSE({ event: "board", id: String(cursor), data: JSON.stringify(await board(game, limit)), retry: 3000 });
      }
      // Serverless functions have no shared memory to publish through, so the
      // stream polls the event log once a second. After STREAM_SECONDS it ends;
      // EventSource reconnects by itself (after `retry` ms) with Last-Event-ID,
      // and continues where this one stopped.
      const end = Date.now() + STREAM_SECONDS * 1000;
      let quietSince = Date.now();
      while (!stream.aborted && Date.now() < end) {
        const fresh = await d.select().from(events).where(gt(events.id, cursor)).orderBy(asc(events.id)).limit(100);
        if (fresh.length) {
          cursor = fresh.at(-1)!.id;
          const mine = fresh.filter((e) => e.type === "score.submitted" && e.data.game === game);
          if (mine.length) {
            await stream.writeSSE({ event: "board", id: String(cursor), data: JSON.stringify({ ...(await board(game, limit)), latest: mine.at(-1)!.data }) });
            quietSince = Date.now();
          }
        }
        // A comment line now and then keeps proxies from closing an idle stream.
        if (Date.now() - quietSince > 10_000) {
          await stream.write(": keep-alive\n\n");
          quietSince = Date.now();
        }
        await stream.sleep(1000);
      }
    });
  },
);
