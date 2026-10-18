import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { type AuthEnv, authenticate } from "./auth";
import { problem } from "./problem";
import { rateLimit } from "./ratelimit";
import { authApi } from "./routes/auth";
import { limitsApi } from "./routes/limits";
import { tasksApi } from "./routes/tasks";
import { validationHook } from "./validation";

// The whole API: one Hono app under /api, mounted into Next.js by
// src/app/api/[[...route]]/route.ts. Hono only sees standard Request and
// Response objects, so the same app could run on Workers, Deno or Bun.
export const app = new OpenAPIHono<AuthEnv>({ defaultHook: validationHook }).basePath("/api");

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

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", tasksApi);
app.route("/", authApi);
app.route("/", limitsApi);

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
  console.error(err);
  return problem(c, 500, "internal");
});
