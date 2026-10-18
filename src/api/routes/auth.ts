import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, count, desc, eq, gt, isNull, notInArray } from "drizzle-orm";
import { type AuthEnv, issueToken, jwtSecret, newKey, hashKey, requireAuth, requireScope, SCOPES, TOKEN_TTL } from "../auth";
import { db } from "../db/client";
import { apiKeys, tasks } from "../db/schema";
import { Problem, problem } from "../problem";
import { rateLimit } from "../ratelimit";
import { validationHook } from "../validation";

const KEY_TTL_HOURS = 24; // the lab is public: keys expire after a day
const MAX_KEYS = 500;

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const problemResponse = (description: string) => ({ content: { "application/problem+json": { schema: Problem } }, description });
const bearer = [{ bearer: [] }];

const NewKey = z.strictObject({
  name: z.string().trim().min(1, "Name the key").max(60),
  scopes: z.array(z.enum(SCOPES)).max(SCOPES.length).default([]),
}).openapi("NewKey", { example: { name: "My script", scopes: ["stats:read"] } });

const CreatedKey = z.object({
  id: z.uuid(), name: z.string(), prefix: z.string(), scopes: z.array(z.enum(SCOPES)), expiresAt: z.iso.datetime(),
  key: z.string().openapi({ description: "The key itself. Shown only now: only its hash is stored" }),
}).openapi("CreatedKey");

const Identity = z.object({
  method: z.enum(["api-key", "jwt"]), keyId: z.uuid(), name: z.string(), scopes: z.array(z.enum(SCOPES)), expiresAt: z.iso.datetime(),
}).openapi("Identity");

const Token = z.object({
  access_token: z.string(), token_type: z.literal("Bearer"), expires_in: z.number().int(), scope: z.string(),
}).openapi("Token");

export const authApi = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook });

authApi.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
  type: "http", scheme: "bearer", description: "An API key (lab_…) or a JWT from POST /api/token",
});

authApi.openapi(
  createRoute({
    method: "post", path: "/keys", tags: ["Auth"], summary: "Create an API key (shown once)",
    middleware: [rateLimit({ name: "keys", windowSec: 3600, limit: () => Number(process.env.LAB_KEY_LIMIT ?? 5) })] as const,
    request: { body: { content: { "application/json": { schema: NewKey } }, required: true } },
    responses: { 201: json(CreatedKey, "The new key. Store it now: it can't be shown again"), 422: problemResponse("Invalid name or scope"), 429: problemResponse("Too many keys created") },
  }),
  async (c) => {
    const { name, scopes } = c.req.valid("json");
    const key = newKey();
    const d = await db();
    const [row] = await d.insert(apiKeys).values({
      name, scopes, hash: await hashKey(key), prefix: key.slice(0, 12), expiresAt: new Date(Date.now() + KEY_TTL_HOURS * 3_600_000),
    }).returning();
    const keep = d.select({ id: apiKeys.id }).from(apiKeys).orderBy(desc(apiKeys.createdAt)).limit(MAX_KEYS);
    await d.delete(apiKeys).where(notInArray(apiKeys.id, keep));
    c.header("Cache-Control", "no-store"); // a secret: never cache this response
    return c.json({ id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes as typeof scopes, expiresAt: row.expiresAt.toISOString(), key }, 201);
  },
);

authApi.openapi(
  createRoute({
    method: "delete", path: "/keys/{id}", tags: ["Auth"], summary: "Revoke a key (authenticate with that same key)", security: bearer,
    request: { params: z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) }) },
    responses: { 204: { description: "Revoked: the key stops working at once" }, 401: problemResponse("No or bad credentials"), 403: problemResponse("Not your key, or not an API key") },
  }),
  async (c) => {
    const { auth, error } = requireAuth(c);
    if (error) return error;
    const { id } = c.req.valid("param");
    if (auth.method !== "api-key" || auth.keyId !== id) return problem(c, 403, "forbidden", { detail: "A key can only revoke itself: send it in Authorization." });
    await (await db()).update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    return c.body(null, 204);
  },
);

authApi.openapi(
  createRoute({
    method: "post", path: "/token", tags: ["Auth"], summary: "Exchange an API key for a 15-minute JWT", security: bearer,
    middleware: [rateLimit({ name: "token", windowSec: 60, limit: 20 })] as const,
    responses: {
      200: json(Token, "A signed, short-lived access token (OAuth 2 style response)"),
      401: problemResponse("No or bad API key"), 403: problemResponse("Sent a token, not a key"), 503: problemResponse("Tokens aren't configured"),
    },
  }),
  async (c) => {
    const { auth, error } = requireAuth(c);
    if (error) return error;
    if (auth.method !== "api-key") return problem(c, 403, "forbidden", { detail: "Exchange an API key, not a token: tokens can't mint tokens." });
    const secret = jwtSecret();
    if (!secret) return problem(c, 503, "unavailable", { detail: "JWT_SECRET isn't set on this deployment." });
    c.header("Cache-Control", "no-store");
    return c.json({ access_token: await issueToken(auth, secret), token_type: "Bearer" as const, expires_in: TOKEN_TTL, scope: auth.scopes.join(" ") }, 200);
  },
);

authApi.openapi(
  createRoute({
    method: "get", path: "/me", tags: ["Auth"], summary: "Who am I? (any valid key or token)", security: bearer,
    responses: { 200: json(Identity, "The caller's identity and scopes"), 401: problemResponse("No or bad credentials") },
  }),
  async (c) => {
    const { auth, error } = requireAuth(c);
    return error ?? c.json(auth, 200);
  },
);

authApi.openapi(
  createRoute({
    method: "get", path: "/stats", tags: ["Auth"], summary: "Task and key counts (needs stats:read)", security: bearer,
    responses: {
      200: json(z.object({ tasks: z.object({ total: z.number(), open: z.number(), done: z.number() }), activeKeys: z.number() }), "The numbers"),
      401: problemResponse("No or bad credentials"), 403: problemResponse("Missing the stats:read scope"),
    },
  }),
  async (c) => {
    const { error } = requireScope(c, "stats:read");
    if (error) return error;
    const d = await db();
    const byDone = await d.select({ done: tasks.done, n: count() }).from(tasks).groupBy(tasks.done);
    const [keys] = await d.select({ n: count() }).from(apiKeys).where(and(isNull(apiKeys.revokedAt), gt(apiKeys.expiresAt, new Date())));
    const done = byDone.find((r) => r.done)?.n ?? 0;
    const open = byDone.find((r) => !r.done)?.n ?? 0;
    return c.json({ tasks: { total: done + open, open, done }, activeKeys: keys.n }, 200);
  },
);

authApi.openapi(
  createRoute({
    method: "get", path: "/export/tasks", tags: ["Auth"], summary: "All tasks as CSV (needs tasks:export)", security: bearer,
    responses: {
      200: { content: { "text/csv": { schema: z.string() } }, description: "One row per task" },
      401: problemResponse("No or bad credentials"), 403: problemResponse("Missing the tasks:export scope"),
    },
  }),
  async (c) => {
    const { error } = requireScope(c, "tasks:export");
    if (error) return error;
    const rows = await (await db()).select().from(tasks).orderBy(desc(tasks.createdAt));
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = ["id,title,done,created_at", ...rows.map((r) => [r.id, cell(r.title), r.done, r.createdAt.toISOString()].join(","))].join("\n");
    return c.text(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="tasks.csv"' });
  },
);
