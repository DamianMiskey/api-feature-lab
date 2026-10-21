import type { MiddlewareHandler } from "hono";
import { and, eq, lt, sql } from "drizzle-orm";
import type { AuthEnv } from "./auth";
import { db } from "./db/client";
import { idempotencyKeys } from "./db/schema";
import { annotate, span } from "./observe";
import { problem } from "./problem";
import { clientId } from "./ratelimit";

// Idempotency keys (IETF draft-ietf-httpapi-idempotency-key-header, the
// pattern Stripe made popular). POST isn't safe to retry: if the response is
// lost, the client can't tell whether the work happened. So the client makes
// up a unique key per operation and sends it with every attempt; the server
// does the work once, remembers the response, and replays it for retries.

const TTL_MS = 24 * 60 * 60 * 1000; // how long a key is remembered
const STALE_MS = 60 * 1000; // a first attempt that never finished (crashed) after this long

// Headers worth replaying along with the body.
const KEPT = ["content-type", "location", "etag"];

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The header is a Structured Field string, so `"abc"` with quotes; the bare
 * form `abc` is accepted too, since that's what most clients send.
 */
export function parseKey(header: string | undefined) {
  if (header === undefined) return null;
  const key = header.trim().replace(/^"(.*)"$/, "$1");
  return /^[\x21-\x7e]{1,255}$/.test(key) ? key : null;
}

export const idempotency = ({ required }: { required: boolean }): MiddlewareHandler<AuthEnv> => async (c, next) => {
  const header = c.req.header("idempotency-key");
  if (header === undefined && !required) return next();
  const key = parseKey(header);
  if (!key) {
    return problem(c, 400, "idempotency-key-missing", {
      detail: header === undefined
        ? "Send Idempotency-Key with a unique value (a UUID, say) per operation, and the same value when you retry it."
        : "Idempotency-Key must be 1–255 printable ASCII characters.",
    });
  }

  // What the request asks for. The same key with a different request is a
  // client bug, and silently replaying the old answer would hide it.
  const fingerprint = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${c.req.method} ${c.req.path}\n${await c.req.text()}`)));
  const client = clientId(c);
  const d = await db();

  const claimed = await span("idempotency claim", {}, async () => {
    // Expired keys, and first attempts that died half-way, free their key.
    await d.delete(idempotencyKeys).where(and(eq(idempotencyKeys.client, client), eq(idempotencyKeys.key, key), sql`(
      ${idempotencyKeys.createdAt} < ${new Date(Date.now() - TTL_MS)} or
      (${idempotencyKeys.status} is null and ${idempotencyKeys.createdAt} < ${new Date(Date.now() - STALE_MS)}))`));

    // Claim the key. The primary key makes this atomic: of two concurrent
    // requests with the same key, exactly one inserts the row.
    return d.insert(idempotencyKeys).values({ client, key, fingerprint }).onConflictDoNothing().returning();
  });
  if (claimed.length === 0) {
    const [seen] = await d.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.client, client), eq(idempotencyKeys.key, key)));
    if (!seen) return problem(c, 409, "request-in-progress", { detail: "Retry in a moment." });
    if (seen.fingerprint !== fingerprint) {
      return problem(c, 422, "idempotency-key-reused", { detail: "Use a new key for a new request; reuse a key only to retry exactly the same one." });
    }
    if (seen.status === null) {
      c.header("Retry-After", "1");
      return problem(c, 409, "request-in-progress", { detail: "The first request with this key hasn't finished. Retry in a moment." });
    }
    // The replay: the same status, headers and body as the first time.
    annotate({ idempotency: "replayed" });
    return new Response(seen.body, { status: seen.status, headers: { ...seen.headers, "idempotent-replayed": "true" } });
  }

  annotate({ idempotency: "first" });
  await next();

  // Only successes are remembered. A failure (invalid body, 429, a crash)
  // releases the key, so the client can fix the problem and retry with it.
  if (c.res.status >= 200 && c.res.status < 300) {
    const headers = Object.fromEntries(KEPT.flatMap((h) => (c.res.headers.get(h) ? [[h, c.res.headers.get(h)!]] : [])));
    await d.update(idempotencyKeys).set({ status: c.res.status, headers, body: await c.res.clone().text() })
      .where(and(eq(idempotencyKeys.client, client), eq(idempotencyKeys.key, key)));
  } else {
    await d.delete(idempotencyKeys).where(and(eq(idempotencyKeys.client, client), eq(idempotencyKeys.key, key)));
  }
  // Now and then, forget keys older than a day.
  if (Math.random() < 0.02) await d.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(Date.now() - TTL_MS)));
};
