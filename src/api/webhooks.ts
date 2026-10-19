import { and, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "./db/client";
import { type DeliveryRow, type EventRow, events, webhookAttempts, webhookDeliveries, webhookEndpoints } from "./db/schema";

// Webhooks: the API calls its subscribers when something happens, instead of
// them polling. Three things make that dependable:
// - an event log (the events table) written when the thing happens, so
//   nothing is lost if a delivery fails;
// - retries with exponential backoff until the subscriber says 2xx, then a
//   final "failed" state (a dead letter) instead of trying forever;
// - a signature on every message (the Standard Webhooks format), so the
//   subscriber can prove the message came from us and wasn't replayed later.

export const MAX_ATTEMPTS = 6;
/** Seconds to wait after failed attempt n: 2, 4, 8, 16, 32 (short, for the demo; real senders stretch this over hours). */
export const backoff = (attempt: number) => 2 ** attempt;
const LEASE_MS = 30_000; // a claimed delivery isn't picked up by anyone else for this long
const FANOUT_WINDOW_MS = 60 * 60 * 1000; // demo inboxes receive events for an hour
const MAX_ENDPOINTS = 100;
const MAX_EVENTS = 1000;

// ---- Signing (https://www.standardwebhooks.com) -------------------------------

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

/** A secret like whsec_<base64 of 24 random bytes>. */
export const newSecret = () => `whsec_${b64(crypto.getRandomValues(new Uint8Array(24)))}`;

const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", unb64(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

/** What gets signed: the message id, the time, and the exact body bytes. */
const signedContent = (id: string, timestamp: string, body: string) => new TextEncoder().encode(`${id}.${timestamp}.${body}`);

export async function sign(secret: string, id: string, timestamp: string, body: string) {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), signedContent(id, timestamp, body));
  return `v1,${b64(new Uint8Array(mac))}`;
}

/**
 * The subscriber's side. The header may list several signatures (during a
 * secret rotation); one valid one is enough. crypto.subtle.verify compares in
 * constant time, so timing can't leak how much of a guess was right. The
 * timestamp check stops an attacker replaying a captured message later.
 */
export async function verify(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, body: string, toleranceSec = 300) {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return "missing webhook-id, webhook-timestamp or webhook-signature";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSec) return "the timestamp is too old or too far in the future";
  const key = await hmacKey(secret, "verify");
  for (const candidate of signature.split(" ")) {
    const [version, mac] = candidate.split(",");
    if (version !== "v1" || !mac) continue;
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = unb64(mac); } catch { continue; }
    if (await crypto.subtle.verify("HMAC", key, bytes, signedContent(id, timestamp, body))) return null;
  }
  return "no signature matches";
}

// ---- Recording events ------------------------------------------------------------

/**
 * Write an event and queue a delivery to each subscriber: by default, every
 * demo inbox created in the last hour (the 10 newest).
 */
export async function recordEvent(type: string, data: Record<string, unknown>, only?: { endpointId: string }) {
  const d = await db();
  const [event] = await d.insert(events).values({ type, data }).returning();
  const targets = only
    ? [{ id: only.endpointId }]
    : await d.select({ id: webhookEndpoints.id }).from(webhookEndpoints)
      .where(gt(webhookEndpoints.createdAt, new Date(Date.now() - FANOUT_WINDOW_MS))).orderBy(desc(webhookEndpoints.createdAt)).limit(10);
  const deliveries = targets.length
    ? await d.insert(webhookDeliveries).values(targets.map((t) => ({ endpointId: t.id, eventId: event.id }))).returning()
    : [];
  if (Math.random() < 0.02) await prune();
  return { event, deliveries };
}

async function prune() {
  const d = await db();
  await d.delete(events).where(notInArray(events.id, d.select({ id: events.id }).from(events).orderBy(desc(events.id)).limit(MAX_EVENTS)));
  await d.delete(webhookEndpoints).where(notInArray(webhookEndpoints.id,
    d.select({ id: webhookEndpoints.id }).from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt)).limit(MAX_ENDPOINTS)));
}

// ---- Delivering -------------------------------------------------------------------

/**
 * How a message travels. The demo inboxes live in this same app, so by
 * default app.ts hands the request straight to it (app.fetch) instead of
 * going out over the network and back. A real sender would use fetch() to the
 * subscriber's URL, with a timeout; nothing else here would change.
 */
type Transport = (request: Request) => Promise<Response>;
let transport: Transport = (request) => fetch(request, { signal: AbortSignal.timeout(10_000) });
export const setTransport = (t: Transport) => { transport = t; };

/** The JSON body of a message: the same for every attempt, so the signature is too. */
export const payload = (event: EventRow) => JSON.stringify({ type: event.type, timestamp: event.createdAt.toISOString(), data: event.data });

async function attempt(delivery: DeliveryRow, now: Date) {
  const d = await db();
  const [event] = await d.select().from(events).where(eq(events.id, delivery.eventId));
  const [endpoint] = await d.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, delivery.endpointId));
  if (!event || !endpoint) {
    await d.update(webhookDeliveries).set({ status: "failed" }).where(eq(webhookDeliveries.id, delivery.id));
    return;
  }
  const body = payload(event);
  // webhook-id stays the same across retries: it's how the subscriber spots a duplicate.
  const id = `msg_${event.id}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  let status = 0;
  let response: string;
  try {
    const res = await transport(new Request(`https://api.djmiskey.com/api/webhooks/inbox/${endpoint.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json", "user-agent": "api-feature-lab-webhooks/1",
        "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": await sign(endpoint.secret, id, timestamp, body),
      },
      body,
    }));
    status = res.status;
    response = (await res.text()).slice(0, 500);
  } catch (e) {
    response = `network error: ${(e as Error).message}`;
  }
  const attempts = delivery.attempts + 1;
  await d.insert(webhookAttempts).values({ deliveryId: delivery.id, attempt: attempts, responseStatus: status, response });
  const ok = status >= 200 && status < 300;
  await d.update(webhookDeliveries).set(ok
    ? { status: "delivered", attempts }
    : attempts >= MAX_ATTEMPTS
      ? { status: "failed", attempts }
      : { attempts, nextAttemptAt: new Date(now.getTime() + backoff(attempts) * 1000) })
    .where(eq(webhookDeliveries.id, delivery.id));
}

/**
 * Attempt every delivery that's due (optionally only one endpoint's or one
 * event's). A real system runs this in a worker or on a schedule; Vercel Hobby
 * crons run once a day, so here it runs when an event is recorded and
 * whenever someone looks at a delivery log, which is when retries matter.
 */
export async function processDue({ endpointId, eventId, now = new Date() }: { endpointId?: string; eventId?: number; now?: Date } = {}) {
  const d = await db();
  // Claim the due rows by pushing their next attempt into the future, in one
  // statement: a second worker running the same query at the same moment
  // re-checks next_attempt_at and finds nothing left to claim.
  const due = and(eq(webhookDeliveries.status, "pending"), sql`${webhookDeliveries.nextAttemptAt} <= ${now}`);
  const scope = and(due,
    endpointId ? eq(webhookDeliveries.endpointId, endpointId) : undefined,
    eventId !== undefined ? eq(webhookDeliveries.eventId, eventId) : undefined);
  const claimed = await d.update(webhookDeliveries)
    .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
    .where(and(due, inArray(webhookDeliveries.id, d.select({ id: webhookDeliveries.id }).from(webhookDeliveries).where(scope).orderBy(webhookDeliveries.nextAttemptAt).limit(10))))
    .returning();
  // The lease is in the row now; attempt() works from the claimed copy.
  for (const delivery of claimed) await attempt(delivery, now);
  return claimed.length;
}
