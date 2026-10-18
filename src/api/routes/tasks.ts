import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "../db/client";
import { type TaskRow, tasks } from "../db/schema";
import { Problem, problem } from "../problem";
import { validationHook } from "../validation";

// A classic REST resource. The URL names the thing (/tasks, /tasks/{id}); the
// method says what to do with it; the status code says how it went.

const MAX_TASKS = 200; // the live lab is public: keep only the newest 200

const Task = z
  .object({
    id: z.uuid(),
    title: z.string(),
    done: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("Task");

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

const json = <T extends z.ZodType>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const problemResponse = (description: string) => ({ content: { "application/problem+json": { schema: Problem } }, description });

const toTask = (row: TaskRow): z.infer<typeof Task> => ({
  id: row.id,
  title: row.title,
  done: row.done,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const tasksApi = new OpenAPIHono({ defaultHook: validationHook });

tasksApi.openapi(
  createRoute({
    method: "get", path: "/tasks", tags: ["Tasks"], summary: "List tasks",
    request: { query: z.object({ done: z.enum(["true", "false"]).optional().openapi({ description: "Only finished (true) or open (false) tasks" }) }) },
    responses: { 200: json(z.object({ items: z.array(Task) }), "The newest tasks first (up to 50)"), 422: problemResponse("Invalid query") },
  }),
  async (c) => {
    const { done } = c.req.valid("query");
    const rows = await (await db()).select().from(tasks)
      .where(done === undefined ? undefined : eq(tasks.done, done === "true"))
      .orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(50);
    return c.json({ items: rows.map(toTask) }, 200);
  },
);

tasksApi.openapi(
  createRoute({
    method: "post", path: "/tasks", tags: ["Tasks"], summary: "Create a task",
    request: { body: { content: { "application/json": { schema: NewTask } }, required: true } },
    responses: {
      201: { ...json(Task, "Created. The Location header holds the new task's URL"), headers: z.object({ Location: z.string() }) },
      400: problemResponse("The body isn't JSON"),
      422: problemResponse("The JSON doesn't match NewTask"),
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const d = await db();
    const [row] = await d.insert(tasks).values({ title: input.title, done: input.done ?? false }).returning();
    // Keep the table small: drop everything but the newest MAX_TASKS.
    const keep = d.select({ id: tasks.id }).from(tasks).orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(MAX_TASKS);
    await d.delete(tasks).where(notInArray(tasks.id, keep));
    c.header("Location", `/api/tasks/${row.id}`);
    return c.json(toTask(row), 201);
  },
);

tasksApi.openapi(
  createRoute({
    method: "get", path: "/tasks/{id}", tags: ["Tasks"], summary: "Get one task",
    request: { params: IdParam },
    responses: { 200: json(Task, "The task"), 404: problemResponse("No task with that id"), 422: problemResponse("The id isn't a UUID") },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const [row] = await (await db()).select().from(tasks).where(eq(tasks.id, id));
    return row ? c.json(toTask(row), 200) : problem(c, 404, "not-found", { detail: `There's no task ${id}.` });
  },
);

tasksApi.openapi(
  createRoute({
    method: "patch", path: "/tasks/{id}", tags: ["Tasks"], summary: "Change some fields of a task",
    request: { params: IdParam, body: { content: { "application/json": { schema: TaskPatch } }, required: true } },
    responses: { 200: json(Task, "The updated task"), 404: problemResponse("No task with that id"), 422: problemResponse("Invalid fields") },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const [row] = await (await db()).update(tasks).set({ ...patch, updatedAt: new Date() }).where(eq(tasks.id, id)).returning();
    return row ? c.json(toTask(row), 200) : problem(c, 404, "not-found", { detail: `There's no task ${id}.` });
  },
);

tasksApi.openapi(
  createRoute({
    method: "delete", path: "/tasks/{id}", tags: ["Tasks"], summary: "Delete a task",
    request: { params: IdParam },
    responses: { 204: { description: "Deleted. No body" }, 404: problemResponse("No task with that id") },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const gone = await (await db()).delete(tasks).where(and(eq(tasks.id, id))).returning({ id: tasks.id });
    return gone.length ? c.body(null, 204) : problem(c, 404, "not-found", { detail: `There's no task ${id}.` });
  },
);
