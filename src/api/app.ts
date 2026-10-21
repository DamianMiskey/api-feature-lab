import { OpenAPIHono } from "@hono/zod-openapi";
import { trpcServer } from "@hono/trpc-server";
import { cors } from "hono/cors";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { type AuthEnv, authenticate } from "./auth";
import { db } from "./db/client";
import { idempotency } from "./idempotency";
import { log, observe } from "./observe";
import { problem } from "./problem";
import { rateLimit } from "./ratelimit";
import { authApi } from "./routes/auth";
import { graphqlApi } from "./routes/graphql";
import { limitsApi } from "./routes/limits";
import { scoresApi } from "./routes/scores";
import { tasksApi } from "./routes/tasks";
import { appRouter } from "./trpc";
import { validationHook } from "./validation";
import { webhooksApi } from "./routes/webhooks";
import { setTransport } from "./webhooks";

// The whole API: one Hono app under /api, mounted into Next.js by
// src/app/api/[[...route]]/route.ts. Hono only sees standard Request and
// Response objects, so the same app could run on Workers, Deno or Bun.
export const app = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook }).basePath("/api");

// The leaderboards are called from the Motion lab's pages, another origin:
// CORS tells browsers which origins may read the responses, and which extra
// request headers (Idempotency-Key) they may send. Only these endpoints, and
// only these origins; everything else stays same-origin.
// First of all: give the request an id and a log record (see observe.ts).
app.use("*", observe);

// /platform is read cross-origin too: the Portability page on api.djmiskey.com
// asks both deployments (this app on Vercel and on Cloudflare) the same thing.
// The Observability lab (obs.djmiskey.com) reads leaderboards from visitors'
// browsers too, sending a traceparent so it can find the trace afterwards.
const ORIGINS = new Set(["https://motion.djmiskey.com", "https://api.djmiskey.com", "https://obs.djmiskey.com"]);
app.use("/platform", cors({ origin: (origin) => (ORIGINS.has(origin) || /^http:\/\/localhost:\d+$/.test(origin) ? origin : null), allowMethods: ["GET"] }));
app.use("/scores/*", cors({
  origin: (origin) => (ORIGINS.has(origin) || /^http:\/\/localhost:\d+$/.test(origin) ? origin : null),
  allowMethods: ["GET", "POST"],
  allowHeaders: ["content-type", "idempotency-key", "last-event-id", "traceparent"],
  exposeHeaders: ["etag", "idempotent-replayed", "ratelimit", "ratelimit-policy", "retry-after", "x-request-id"],
  maxAge: 600,
}));

// Every request: check credentials if any were sent (see auth.ts).
app.use("*", authenticate);

// Writes to the public tasks are rate limited per client: 30 a minute
// anonymously, 120 with an API key or token. (LAB_WRITE_LIMIT raises the
// anonymous limit for the test suites.)
// ("/tasks/*" also matches "/tasks" itself: listing both would count every
// write twice.)
app.on(["POST", "PATCH", "DELETE"], "/tasks/*", rateLimit({
  name: "writes",
  windowSec: 60,
  limit: (c) => (c.get("auth") ? 120 : Number(process.env.LAB_WRITE_LIMIT ?? 30)),
}));

// Creating a task takes an Idempotency-Key too, but doesn't insist on one.
// (POST /scores insists: see routes/scores.ts.)
app.on("POST", "/tasks", idempotency({ required: false }));

app.get("/health", (c) => c.json({ ok: true }));

// Where this copy of the API is running, and how far its database is. The
// same code answers on Vercel (Node.js) and on Cloudflare Workers (workerd).
app.get("/platform", async (c) => {
  const started = performance.now();
  await (await db()).execute(sql`select 1`);
  const dbMs = Math.round(performance.now() - started);
  const cf = (c.req.raw as Request & { cf?: { colo?: string } }).cf;
  c.header("Cache-Control", "no-store");
  return c.json({
    platform: process.env.LAB_PLATFORM ?? (process.env.VERCEL ? "vercel" : "local"),
    runtime: globalThis.navigator?.userAgent ?? "unknown",
    region: cf?.colo ?? process.env.VERCEL_REGION ?? null,
    database: process.env.DATABASE_URL ? "neon" : "pglite",
    dbMs,
  });
});
app.route("/", tasksApi);
app.route("/", authApi);
app.route("/", limitsApi);
app.route("/", scoresApi);
app.route("/", webhooksApi);

// The same data in two other API styles (the "REST vs tRPC vs GraphQL" page).
// They live outside the OpenAPI document: tRPC clients get their types from
// the router itself, GraphQL clients from the schema (introspection).
// tRPC mutations are POSTs and share the REST writes budget.
app.on("POST", "/trpc/*", rateLimit({
  name: "writes",
  windowSec: 60,
  limit: (c) => (c.get("auth") ? 120 : Number(process.env.LAB_WRITE_LIMIT ?? 30)),
}));
app.use("/trpc/*", trpcServer({ endpoint: "/api/trpc", router: appRouter, createContext: (_opts, c) => ({ auth: c.get("auth") }) }));
app.route("/", graphqlApi);

// Webhook deliveries to the demo inboxes go straight to this app, rather than
// out to the internet and back in (see webhooks.ts).
setTransport((request) => Promise.resolve(app.fetch(request)));

// The OpenAPI document is generated from the same Zod schemas that validate
// requests, so the docs can't drift from the code.
app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "API Feature Lab",
    version: "1.0.0",
    description: "The API behind https://api.djmiskey.com: one page per technique, each calling these endpoints live.",
  },
  servers: [{ url: "https://api.djmiskey.com" }],
});

// Every failure leaves as Problem Details, even ones Hono raises itself.
app.notFound((c) => problem(c, 404, "not-found", { detail: `No route for ${c.req.method} ${new URL(c.req.url).pathname}.` }));
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    // Hono's JSON validator throws 400 for a body that isn't valid JSON.
    return problem(c, err.status === 400 ? 400 : 500, err.status === 400 ? "bad-request" : "internal", { detail: err.message });
  }
  log("error", "unhandled error", { error: err.message, stack: err.stack?.split("\n").slice(0, 6).join("\n") });
  return problem(c, 500, "internal");
});
