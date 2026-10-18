import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { problem } from "./problem";
import { tasksApi } from "./routes/tasks";
import { validationHook } from "./validation";

// The whole API: one Hono app under /api, mounted into Next.js by
// src/app/api/[[...route]]/route.ts. Hono only sees standard Request and
// Response objects, so the same app could run on Workers, Deno or Bun.
export const app = new OpenAPIHono({ defaultHook: validationHook }).basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", tasksApi);

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
