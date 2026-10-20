import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { AuthEnv } from "../auth";
import { db } from "../db/client";
import { events, webhookAttempts, webhookDeliveries, webhookEndpoints, webhookReceipts } from "../db/schema";
import { annotate } from "../observe";
import { Problem, problem } from "../problem";
import { rateLimit } from "../ratelimit";
import { validationHook } from "../validation";
import { MAX_ATTEMPTS, newSecret, processDue, recordEvent, verify } from "../webhooks";

// The Webhooks page's endpoints: a demo inbox to subscribe, a ping to send it,
// the sender's delivery log, and the inbox itself (the subscriber's side).
// An inbox's id is its only credential (a capability URL, like a secret
// gist): 122 random bits nobody can guess.

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const problemResponse = (description: string) => ({ content: { "application/problem+json": { schema: Problem } }, description });
const IdParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });

const Endpoint = z.object({
  id: z.uuid(),
  url: z.string().openapi({ description: "Where deliveries go" }),
  secret: z.string().openapi({ description: "whsec_…: the signing secret. Shown once" }),
  failFirst: z.number().int(),
  receives: z.string(),
}).openapi("WebhookEndpoint");

const Delivery = z.object({
  id: z.uuid(),
  event: z.object({ id: z.number().int(), type: z.string(), data: z.record(z.string(), z.unknown()) }),
  status: z.enum(["pending", "delivered", "failed"]),
  nextAttemptAt: z.iso.datetime().nullable(),
  attempts: z.array(z.object({ attempt: z.number().int(), at: z.iso.datetime(), status: z.number().int(), response: z.string() })),
}).openapi("WebhookDelivery");

export const webhooksApi = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });

webhooksApi.openapi(
  createRoute({
    method: "post", path: "/webhooks/endpoints", tags: ["Webhooks"], summary: "Create a demo inbox that receives this API's events for an hour",
    middleware: [rateLimit({ name: "inboxes", windowSec: 3600, limit: () => Number(process.env.LAB_INBOX_LIMIT ?? 10) })] as const,
    request: {
      body: {
        content: { "application/json": { schema: z.strictObject({ failFirst: z.number().int().min(0).max(5).default(0).openapi({ description: "Refuse (503) each message this many times first, to see the retries" }) }).openapi({ example: { failFirst: 2 } }) } },
        required: true,
      },
    },
    responses: { 201: json(Endpoint, "Subscribed. Keep the secret: it's needed to verify signatures"), 422: problemResponse("failFirst outside 0–5"), 429: problemResponse("More than 10 inboxes an hour") },
  }),
  async (c) => {
    const { failFirst } = c.req.valid("json");
    const [row] = await (await db()).insert(webhookEndpoints).values({ secret: newSecret(), failFirst }).returning();
    c.header("Cache-Control", "no-store");
    return c.json({ id: row.id, url: `/api/webhooks/inbox/${row.id}`, secret: row.secret, failFirst, receives: "ping, and score.submitted for the next hour" }, 201);
  },
);

webhooksApi.openapi(
  createRoute({
    method: "post", path: "/webhooks/endpoints/{id}/ping", tags: ["Webhooks"], summary: "Send a ping event to one inbox",
    middleware: [rateLimit({ name: "pings", windowSec: 60, limit: () => Number(process.env.LAB_INBOX_LIMIT ?? 20) })] as const,
    request: { params: IdParam },
    responses: { 202: json(z.object({ eventId: z.number().int(), deliveryId: z.uuid() }), "Queued, and the first attempt made"), 404: problemResponse("No such inbox") },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const [endpoint] = await (await db()).select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    if (!endpoint) return problem(c, 404, "not-found", { detail: `There's no inbox ${id}.` });
    const { event, deliveries } = await recordEvent("ping", { message: "Hello from api.djmiskey.com" }, { endpointId: id });
    await processDue({ eventId: event.id });
    return c.json({ eventId: event.id, deliveryId: deliveries[0].id }, 202);
  },
);

webhooksApi.openapi(
  createRoute({
    method: "get", path: "/webhooks/endpoints/{id}/deliveries", tags: ["Webhooks"], summary: "The sender's log for one inbox: every delivery and attempt (runs due retries first)",
    request: { params: IdParam },
    responses: { 200: json(z.object({ maxAttempts: z.number().int(), deliveries: z.array(Delivery) }), "Newest first"), 404: problemResponse("No such inbox") },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const d = await db();
    const [endpoint] = await d.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    if (!endpoint) return problem(c, 404, "not-found", { detail: `There's no inbox ${id}.` });
    await processDue({ endpointId: id });
    const rows = await d.select({ delivery: webhookDeliveries, event: events }).from(webhookDeliveries)
      .innerJoin(events, eq(events.id, webhookDeliveries.eventId))
      .where(eq(webhookDeliveries.endpointId, id)).orderBy(desc(webhookDeliveries.createdAt)).limit(20);
    const attempts = rows.length
      ? await d.select().from(webhookAttempts).where(inArray(webhookAttempts.deliveryId, rows.map((r) => r.delivery.id))).orderBy(asc(webhookAttempts.attempt))
      : [];
    c.header("Cache-Control", "no-store");
    return c.json({
      maxAttempts: MAX_ATTEMPTS,
      deliveries: rows.map(({ delivery, event }) => ({
        id: delivery.id,
        event: { id: event.id, type: event.type, data: event.data },
        status: delivery.status,
        nextAttemptAt: delivery.status === "pending" ? delivery.nextAttemptAt.toISOString() : null,
        attempts: attempts.filter((a) => a.deliveryId === delivery.id)
          .map((a) => ({ attempt: a.attempt, at: a.at.toISOString(), status: a.responseStatus, response: a.response })),
      })),
    }, 200);
  },
);

// ---- The subscriber's side ------------------------------------------------------

webhooksApi.openapi(
  createRoute({
    method: "post", path: "/webhooks/inbox/{id}", tags: ["Webhooks"],
    summary: "The demo inbox: verifies the signature, refuses failFirst times, and ignores duplicates",
    request: { params: IdParam },
    responses: {
      200: json(z.object({ received: z.boolean(), duplicate: z.boolean() }), "Accepted (or already had it)"),
      401: problemResponse("Missing or invalid signature, or a stale timestamp"),
      404: problemResponse("No such inbox"),
      503: problemResponse("Refused on purpose (failFirst): the sender should retry"),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const d = await db();
    const [endpoint] = await d.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    if (!endpoint) return problem(c, 404, "not-found", { detail: `There's no inbox ${id}.` });
    // 1. Verify, against the raw body: re-serialised JSON wouldn't match the bytes that were signed.
    const body = await c.req.text();
    const messageId = c.req.header("webhook-id");
    const failure = await verify(endpoint.secret, { id: messageId, timestamp: c.req.header("webhook-timestamp"), signature: c.req.header("webhook-signature") }, body);
    if (failure) { annotate({ webhook: "bad-signature" }); return problem(c, 401, "invalid-signature", { detail: `Rejected: ${failure}.` }); }
    // 2. The demo's flaky subscriber: refuse each message failFirst times.
    const [receipt] = await d.insert(webhookReceipts).values({ endpointId: id, messageId: messageId! })
      .onConflictDoUpdate({ target: [webhookReceipts.endpointId, webhookReceipts.messageId], set: { endpointId: sql`excluded.endpoint_id` } })
      .returning();
    if (receipt.refusals < endpoint.failFirst) {
      await d.update(webhookReceipts).set({ refusals: receipt.refusals + 1 })
        .where(and(eq(webhookReceipts.endpointId, id), eq(webhookReceipts.messageId, messageId!), lt(webhookReceipts.refusals, endpoint.failFirst)));
      annotate({ webhook: "refused" });
      return problem(c, 503, "unavailable", { detail: `Refusing on purpose (${receipt.refusals + 1} of ${endpoint.failFirst}).` });
    }
    // 3. Process each message once. Senders deliver "at least once": if our
    // 200 got lost, the same webhook-id comes again, and must be a no-op.
    const first = await d.update(webhookReceipts).set({ processedAt: new Date() })
      .where(and(eq(webhookReceipts.endpointId, id), eq(webhookReceipts.messageId, messageId!), isNull(webhookReceipts.processedAt))).returning();
    annotate({ webhook: first.length ? "processed" : "duplicate" });
    return c.json({ received: true, duplicate: first.length === 0 }, 200);
  },
);
