import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { app } from "@/api/app";
import type { AppRouter } from "@/api/trpc";

// tRPC and GraphQL over the same Hono app as REST, through app.fetch.
const requests: string[] = [];
const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({
    url: "http://localhost/api/trpc",
    fetch: async (url, init) => { requests.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`); return app.fetch(new Request(url, init as RequestInit)); },
  })],
});

const gql = (query: string, variables?: object) =>
  app.request("/api/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });

describe("tRPC", () => {
  it("creates and reads tasks, type-checked end to end", async () => {
    const created = await trpc.tasks.create.mutate({ title: "From tRPC" });
    expect(created).toMatchObject({ title: "From tRPC", done: false });
    expect((await trpc.tasks.byId.query({ id: created.id })).id).toBe(created.id);
    expect((await trpc.tasks.newest.query({ limit: 3 })).map((t) => t.id)).toContain(created.id);
  });

  it("batches concurrent calls into one HTTP request", async () => {
    requests.length = 0;
    const [runner, stacker, tasks] = await Promise.all([
      trpc.scores.top.query({ game: "runner", limit: 3 }),
      trpc.scores.top.query({ game: "stacker", limit: 3 }),
      trpc.tasks.newest.query({ limit: 3 }),
    ]);
    expect(runner.game).toBe("runner");
    expect(stacker.game).toBe("stacker");
    expect(Array.isArray(tasks)).toBe(true);
    expect(requests).toEqual(["GET /api/trpc/scores.top,scores.top,tasks.newest"]);
  });

  it("reports errors in its own shape, with a matching HTTP status", async () => {
    const missing = await trpc.tasks.byId.query({ id: "00000000-0000-4000-8000-000000000000" }).catch((e) => e);
    expect(missing).toBeInstanceOf(TRPCClientError);
    expect(missing.data).toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
    const invalid = await trpc.tasks.create.mutate({ title: "" }).catch((e) => e);
    expect(invalid.data).toMatchObject({ code: "BAD_REQUEST", httpStatus: 400 });
  });
});

describe("GraphQL", () => {
  it("returns exactly the fields asked for, from several types in one request", async () => {
    await gql("mutation { createTask(title: \"From GraphQL\") { id } }");
    const res = await gql(`{
      runner: leaderboard(game: runner, limit: 3) { entries { rank initials } }
      tasks(limit: 2) { title }
    }`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/graphql-response+json");
    const { data } = await res.json();
    expect(Object.keys(data)).toEqual(["runner", "tasks"]);
    expect(data.tasks).toHaveLength(2);
    for (const t of data.tasks) expect(Object.keys(t)).toEqual(["title"]);
  });

  it("takes variables, and null for a missing task", async () => {
    const res = await gql("query One($id: ID!) { task(id: $id) { id } }", { id: "00000000-0000-4000-8000-000000000000" });
    expect(await res.json()).toEqual({ data: { task: null } });
  });

  it("400 for a request that can't run: syntax, unknown fields, bad JSON, no query", async () => {
    expect((await gql("{ tasks { title ")).status).toBe(400);
    const unknown = await gql("{ tasks { titel } }");
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).errors[0].message).toContain("titel");
    expect((await app.request("/api/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })).status).toBe(400);
    expect((await app.request("/api/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
    expect((await app.request("/api/graphql")).status).toBe(405);
  });

  it("200 with errors next to the data that did resolve, once execution starts", async () => {
    const res = await gql("{ tasks(limit: 2) { id } bad: tasks(limit: 999) { id } }");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull(); // tasks is non-null, so its error nulls the whole data object
    expect(body.errors[0]).toMatchObject({ message: "limit must be between 1 and 50", path: ["bad"], extensions: { code: "BAD_USER_INPUT" } });
    const partial = await (await gql("{ leaderboard(game: runner) { game } task(id: \"nope\") { id } }")).json();
    expect(partial.data.leaderboard).toEqual({ game: "runner" });
    expect(partial.data.task).toBeNull();
    expect(partial.errors[0].path).toEqual(["task"]);
  });

  it("refuses queries nested too deeply, fragments included", async () => {
    const deep = await gql("{ leaderboard(game: runner) { ...A } } fragment A on Leaderboard { entries { ...B } } fragment B on ScoreEntry { rank }");
    expect(deep.status).toBe(200); // depth 3: fine
    const { maxDepth } = await import("@/api/graphql");
    const { parse } = await import("graphql");
    expect(maxDepth(parse("{ a { b { c { d { e { f } } } } } }"))).toBe(6);
    expect(maxDepth(parse("{ ...F } fragment F on Query { a { b } }"))).toBe(2);
    expect(maxDepth(parse("{ __schema { types { fields { type { ofType { ofType { name } } } } } } }"))).toBe(0);
  });

  it("is introspectable: the schema documents itself", async () => {
    const { getIntrospectionQuery } = await import("graphql");
    const full = await gql(getIntrospectionQuery());
    expect(full.status).toBe(200); // the tools' standard query, nested well past the depth limit
    const { data } = await (await gql("{ __type(name: \"Game\") { enumValues { name } } }")).json();
    expect(data.__type.enumValues.map((v: { name: string }) => v.name)).toEqual(["toppler", "marble", "stacker", "runner", "demo"]);
  });
});
