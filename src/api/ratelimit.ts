import type { Context, MiddlewareHandler } from "hono";
import { sql } from "drizzle-orm";
import type { AuthEnv } from "./auth";
import { db } from "./db/client";
import { problem } from "./problem";

// A sliding-window rate limiter on Postgres. Each client gets a counter per
// fixed window; the limit is checked against an estimate of the last full
// window's worth of requests: this window's count plus the previous window's,
// weighted by how much of it still overlaps. Smoother than a plain fixed
// window (no double burst at the boundary), and only one row per window.

type Limit = { name: string; limit: number | ((c: Context<AuthEnv>) => number); windowSec: number };

/** Who's asking: their API key or token if they have one, otherwise their IP. */
export function clientId(c: Context<AuthEnv>) {
  const auth = c.get("auth");
  if (auth) return `key:${auth.keyId}`;
  // On Vercel, x-real-ip and x-forwarded-for are set by Vercel's network, not
  // the client, so they can't be spoofed. Locally there's no proxy.
  return `ip:${c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`;
}

export async function hit(id: string, windowSec: number) {
  const windowMs = windowSec * 1000;
  const now = Date.now();
  const start = Math.floor(now / windowMs) * windowMs;
  const d = await db();
  // One statement, so concurrent requests can't both read the old count.
  const result = await d.execute(sql`
    with cur as (
      insert into rate_limits (key, window_start, count) values (${id}, ${start}, 1)
      on conflict (key, window_start) do update set count = rate_limits.count + 1
      returning count
    )
    select (select count from cur) as current,
           coalesce((select count from rate_limits where key = ${id} and window_start = ${start - windowMs}), 0) as previous`);
  const row = (result as unknown as { rows: { current: number; previous: number }[] }).rows[0];
  // Now and then, drop counters nobody needs any more.
  if (Math.random() < 0.02) await d.execute(sql`delete from rate_limits where window_start < ${now - 3_600_000}`);
  const elapsed = (now - start) / windowMs;
  const estimate = Number(row.current) + Number(row.previous) * (1 - elapsed);
  return { estimate, resetSec: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
}

export const rateLimit = ({ name, limit, windowSec }: Limit): MiddlewareHandler<AuthEnv> => async (c, next) => {
  const max = typeof limit === "function" ? limit(c) : limit;
  const { estimate, resetSec } = await hit(`${name}:${clientId(c)}`, windowSec);
  // The IETF RateLimit headers: the policy (quota per window) and where this
  // client stands (remaining, seconds until it resets).
  c.header("RateLimit-Policy", `"${name}";q=${max};w=${windowSec}`);
  c.header("RateLimit", `"${name}";r=${Math.max(0, Math.floor(max - estimate))};t=${resetSec}`);
  if (estimate > max) {
    c.header("Retry-After", String(resetSec));
    return problem(c, 429, "rate-limited", { detail: `At most ${max} requests per ${windowSec} seconds. Try again in ${resetSec}s.` });
  }
  return next();
};
