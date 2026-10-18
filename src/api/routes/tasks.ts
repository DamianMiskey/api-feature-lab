import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { and, desc, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client";
import { type TaskRow, tasks } from "../db/schema";
import { decodeCursor, encodeCursor, etagFor, failsIfMatch, isNotModified } from "../http";
import { Problem, problem } from "../problem";
import { validationHook } from "../validation";

// A classic REST resource. The URL names the thing (/tasks, /tasks/{id}); the
// method says what to do with it; the status code says how it went.

const MAX_TASKS = 200; // the live lab is public: keep only the newest 200

// ---- Representations --------------------------------------------------------

const Task = z
  .object({ id: z.uuid(), title: z.string(), done: z.boolean(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
  .openapi("Task");

// Version 2 of the same resource: a status enum instead of a boolean (room for
// "archived" later without another breaking change) and a link to itself.
const TaskV2 = z
  .object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(["open", "done"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    links: z.object({ self: z.string() }),
  })
  .openapi("TaskV2");

const toTask = (row: TaskRow): z.infer<typeof Task> => ({
  id: row.id, title: row.title, done: row.done, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
const toTaskV2 = (row: TaskRow): z.infer<typeof TaskV2> => ({
  id: row.id, title: row.title, status: row.done ? "done" : "open",
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), links: { self: `/api/v2/tasks/${row.id}` },
});

// strictObject: unknown fields are an error, not silently ignored, so a typo
// like "titel" is caught instead of creating an untitled task.
const NewTask = z
  .strictObject({
    title: z.string().trim().min(1, "Give the task a title").max(200, "Keep the title under 200 characters"),
    done: z.boolean().optional(),
  })
  .openapi("NewTask", { example: { title: "Learn about status codes" } });

const TaskPatch = NewTask.partial()
  .refine((p) => Object.keys(p).length > 0, "Send at least one field to change")
  .openapi("TaskPatch", { example: { done: true } });

const IdParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: "5f0c1d2e-8a4b-4c6d-9e0f-1a2b3c4d5e6f" }) });

const ListQuery = z
  .object({
    done: z.enum(["true", "false"]).optional().openapi({ description: "Only finished (true) or open (false) tasks" }),
    limit: z.coerce.number().int().min(1).max(50).default(20).openapi({ description: "Page size, 1–50" }),
    cursor: z.string().max(200).optional().openapi({ description: "nextCursor from the previous page" }),
    offset: z.coerce.number().int().min(0).max(1000).optional().openapi({ description: "Offset pagination, for comparison: skips rows" }),
  })
  .refine((q) => !(q.cursor && q.offset !== undefined), { message: "Use cursor or offset, not both", path: ["offset"] });

const page = <T extends z.ZodType>(item: T, name: string) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().openapi({ description: "Pass as ?cursor= for the next page; null on the last page" }),
    nextOffset: z.number().int().optional().openapi({ description: "Only in offset mode" }),
  }).openapi(name);
const TaskPage = page(Task, "TaskPage");
const TaskPageV2 = page(TaskV2, "TaskPageV2");

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const problemResponse = (description: string) => ({ content: { "application/problem+json": { schema: Problem } }, description });
const etagHeaders = z.object({ ETag: z.string(), "Cache-Control": z.string() });

// ---- Queries -----------------------------------------------------------------

type Cursor = { c: string; i: string }; // created_at and id of the last row shown

/**
 * Keyset ("cursor") pagination: "the 20 rows after this one", using the
 * (created_at, id) index. Unlike OFFSET, inserting or deleting rows while
 * someone pages through can't make them skip or repeat a row, and page 1,000
 * is as fast as page 1. id breaks ties between rows created in the same
 * millisecond.
 */
async function listPage(c: Context, query: z.infer<typeof ListQuery>, basePath: string) {
  const filters: SQL[] = [];
  if (query.done !== undefined) filters.push(eq(tasks.done, query.done === "true"));
  if (query.cursor) {
    const cur = decodeCursor<Cursor>(query.cursor);
    if (!cur?.c || !cur?.i || Number.isNaN(Date.parse(cur.c))) return null;
    filters.push(sql`(${tasks.createdAt}, ${tasks.id}) < (${cur.c}::timestamptz, ${cur.i}::uuid)`);
  }
  let q = (await db()).select().from(tasks).where(and(...filters))
    .orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(query.limit + 1).$dynamic();
  if (query.offset !== undefined) q = q.offset(query.offset);
  const rows = await q;
  const more = rows.length > query.limit;
  const shown = rows.slice(0, query.limit);
  const last = shown.at(-1);
  const nextCursor = more && last && query.offset === undefined ? encodeCursor({ c: last.createdAt.toISOString(), i: last.id }) : null;
  // RFC 8288 Link header: generic clients can follow rel="next" without
  // knowing this API's body format.
  if (nextCursor) {
    const next = new URLSearchParams({ ...(query.done ? { done: query.done } : {}), limit: String(query.limit), cursor: nextCursor });
    c.header("Link", `<${basePath}?${next}>; rel="next"`);
  }
  return { rows: shown, nextCursor, nextOffset: query.offset !== undefined && more ? query.offset + query.limit : undefined };
}

const findTask = async (id: string) => (await (await db()).select().from(tasks).where(eq(tasks.id, id)))[0];

const missing = (c: Context, id: string) => problem(c, 404, "not-found", { detail: `There's no task ${id}.` });
const badCursor = (c: Context) => problem(c, 422, "validation", { detail: "The cursor isn't one this API issued.", errors: [{ path: "query.cursor", message: "Invalid cursor" }] });

// ---- Routes -------------------------------------------------------------------

export const tasksApi = new OpenAPIHono({ defaultHook: validationHook });

tasksApi.openapi(
  createRoute({
    method: "get", path: "/tasks", tags: ["Tasks"], summary: "List tasks, a page at a time",
    request: { query: ListQuery },
    responses: {
      200: { ...json(TaskPage, "The newest tasks first. Link: <…>; rel=\"next\" when there's more"), headers: etagHeaders },
      304: { description: "Not modified: the page is unchanged since the ETag you sent" },
      422: problemResponse("Invalid query or cursor"),
    },
  }),
  async (c) => {
    const result = await listPage(c, c.req.valid("query"), "/api/tasks");
    if (!result) return badCursor(c);
    const body = { items: result.rows.map(toTask), nextCursor: result.nextCursor, ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}) };
    const etag = await etagFor(body);
    c.header("ETag", etag);
    c.header("Cache-Control", "no-cache"); // may be stored, but must be revalidated before reuse
    return isNotModified(c, etag) ? c.body(null, 304) : c.json(body, 200);
  },
);

tasksApi.openapi(
  createRoute({
    method: "post", path: "/tasks", tags: ["Tasks"], summary: "Create a task",
    request: { body: { content: { "application/json": { schema: NewTask } }, required: true } },
    responses: {
      201: { ...json(Task, "Created. The Location header holds the new task's URL"), headers: z.object({ Location: z.string(), ETag: z.string() }) },
      400: problemResponse("The body isn't JSON"),
      422: problemResponse("The JSON doesn't match NewTask"),
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const d = await db();
    // createdAt is set here, with millisecond precision, rather than by
    // Postgres (microseconds): cursors carry it as an ISO string, which must
    // round-trip exactly.
    const [row] = await d.insert(tasks).values({ title: input.title, done: input.done ?? false, createdAt: new Date(), updatedAt: new Date() }).returning();
    const keep = d.select({ id: tasks.id }).from(tasks).orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(MAX_TASKS);
    await d.delete(tasks).where(notInArray(tasks.id, keep));
    const task = toTask(row);
    c.header("Location", `/api/tasks/${row.id}`);
    c.header("ETag", await etagFor(task));
    return c.json(task, 201);
  },
);

tasksApi.openapi(
  createRoute({
    method: "get", path: "/tasks/{id}", tags: ["Tasks"], summary: "Get one task (API-Version: 1 or 2)",
    request: {
      params: IdParam,
      headers: z.object({ "api-version": z.string().optional().openapi({ description: "1 (default) or 2: which representation to return" }) }),
    },
    responses: {
      200: { ...json(z.union([Task, TaskV2]), "The task, as Task (version 1) or TaskV2"), headers: etagHeaders.extend({ "API-Version": z.string(), Vary: z.string() }) },
      304: { description: "Not modified: your copy (If-None-Match) is current" },
      400: problemResponse("Unknown API-Version"),
      404: problemResponse("No task with that id"),
      422: problemResponse("The id isn't a UUID"),
    },
  }),
  async (c) => {
    // Header-based versioning: same URL, the client picks the shape. Vary tells
    // caches that the response depends on this header.
    const version = c.req.header("api-version") ?? "1";
    c.header("Vary", "API-Version");
    if (version !== "1" && version !== "2") return problem(c, 400, "unsupported-version", { detail: `API-Version must be 1 or 2, not "${version}".` });
    const { id } = c.req.valid("param");
    const row = await findTask(id);
    if (!row) return missing(c, id);
    const body = version === "2" ? toTaskV2(row) : toTask(row);
    const etag = await etagFor(body);
    c.header("ETag", etag);
    c.header("Cache-Control", "no-cache");
    c.header("API-Version", version);
    return isNotModified(c, etag) ? c.body(null, 304) : c.json(body, 200);
  },
);

tasksApi.openapi(
  createRoute({
    method: "patch", path: "/tasks/{id}", tags: ["Tasks"], summary: "Change some fields of a task (If-Match for safe concurrent edits)",
    request: {
      params: IdParam,
      headers: z.object({ "if-match": z.string().optional().openapi({ description: "The ETag you last saw. 412 if the task has changed since" }) }),
      body: { content: { "application/json": { schema: TaskPatch } }, required: true },
    },
    responses: {
      200: { ...json(Task, "The updated task, with its new ETag"), headers: z.object({ ETag: z.string() }) },
      404: problemResponse("No task with that id"),
      412: problemResponse("If-Match didn't match: someone changed the task first"),
      422: problemResponse("Invalid fields"),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const current = await findTask(id);
    if (!current) return missing(c, id);
    if (failsIfMatch(c, await etagFor(toTask(current)))) return problem(c, 412, "precondition-failed", { detail: "Fetch the task again, reapply your change, and send its new ETag." });
    // The WHERE on updated_at makes the check and the write one atomic step: a
    // change that lands between our read and this update makes it match nothing.
    const [row] = await (await db()).update(tasks).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.updatedAt, current.updatedAt))).returning();
    if (!row) return problem(c, 412, "precondition-failed", { detail: "The task changed while this update was in flight." });
    const task = toTask(row);
    c.header("ETag", await etagFor(task));
    return c.json(task, 200);
  },
);

tasksApi.openapi(
  createRoute({
    method: "delete", path: "/tasks/{id}", tags: ["Tasks"], summary: "Delete a task",
    request: { params: IdParam, headers: z.object({ "if-match": z.string().optional() }) },
    responses: {
      204: { description: "Deleted. No body" },
      404: problemResponse("No task with that id"),
      412: problemResponse("If-Match didn't match"),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const current = await findTask(id);
    if (!current) return missing(c, id);
    if (failsIfMatch(c, await etagFor(toTask(current)))) return problem(c, 412, "precondition-failed", { detail: "The task changed since you read it." });
    await (await db()).delete(tasks).where(and(eq(tasks.id, id), eq(tasks.updatedAt, current.updatedAt)));
    return c.body(null, 204);
  },
);

// ---- Version 2 in the URL, and a deprecated version 0 -----------------------

tasksApi.openapi(
  createRoute({
    method: "get", path: "/v2/tasks", tags: ["Tasks v2"], summary: "List tasks in the version 2 shape",
    request: { query: ListQuery },
    responses: { 200: json(TaskPageV2, "Like /api/tasks, as TaskV2"), 422: problemResponse("Invalid query or cursor") },
  }),
  async (c) => {
    const result = await listPage(c, c.req.valid("query"), "/api/v2/tasks");
    if (!result) return badCursor(c);
    return c.json({ items: result.rows.map(toTaskV2), nextCursor: result.nextCursor, ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}) }, 200);
  },
);

tasksApi.openapi(
  createRoute({
    method: "get", path: "/v2/tasks/{id}", tags: ["Tasks v2"], summary: "Get one task in the version 2 shape",
    request: { params: IdParam },
    responses: { 200: json(TaskV2, "The task"), 404: problemResponse("No task with that id"), 422: problemResponse("The id isn't a UUID") },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const row = await findTask(id);
    return row ? c.json(toTaskV2(row), 200) : missing(c, id);
  },
);

const SUNSET = new Date("2027-06-30T00:00:00Z");
const DEPRECATED_AT = new Date("2026-10-01T00:00:00Z");

tasksApi.openapi(
  createRoute({
    method: "get", path: "/v0/tasks", tags: ["Tasks v0 (deprecated)"], deprecated: true,
    summary: "A retired version, kept to demonstrate the Deprecation and Sunset headers",
    responses: { 200: { ...json(z.object({ tasks: z.array(z.object({ id: z.uuid(), title: z.string(), done: z.boolean() })) }), "The old shape"), headers: z.object({ Deprecation: z.string(), Sunset: z.string(), Link: z.string() }) } },
  }),
  async (c) => {
    const rows = await (await db()).select().from(tasks).orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(20);
    // RFC 9745: when it was deprecated. RFC 8594: when it stops answering.
    // Link: where to go instead, and where the change is explained.
    c.header("Deprecation", `@${Math.floor(DEPRECATED_AT.getTime() / 1000)}`);
    c.header("Sunset", SUNSET.toUTCString());
    c.header("Link", '</api/tasks>; rel="successor-version", </versioning>; rel="deprecation"');
    return c.json({ tasks: rows.map((r) => ({ id: r.id, title: r.title, done: r.done })) }, 200);
  },
);
