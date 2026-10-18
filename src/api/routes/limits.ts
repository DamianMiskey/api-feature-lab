import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AuthEnv } from "../auth";
import { Problem } from "../problem";
import { rateLimit } from "../ratelimit";

// A deliberately tight limit, for the Rate limiting page: 5 requests per 10
// seconds per client, so a burst of 8 shows the 429s.
export const DEMO_LIMIT = 5;
export const DEMO_WINDOW = 10;

export const limitsApi = new OpenAPIHono<AuthEnv>();

limitsApi.openapi(
  createRoute({
    method: "get", path: "/limits/demo", tags: ["Rate limiting"], summary: `A cheap endpoint limited to ${DEMO_LIMIT} requests per ${DEMO_WINDOW}s`,
    middleware: [rateLimit({ name: "demo", limit: DEMO_LIMIT, windowSec: DEMO_WINDOW })] as const,
    responses: {
      200: { content: { "application/json": { schema: z.object({ ok: z.literal(true), at: z.iso.datetime() }) } }, description: "Allowed. See the RateLimit headers" },
      429: { content: { "application/problem+json": { schema: Problem } }, description: "Over the limit. Retry-After says when to try again" },
    },
  }),
  (c) => c.json({ ok: true as const, at: new Date().toISOString() }, 200),
);
