import { describe, expect, it } from "vitest";
import { app } from "@/api/app";

const send = (method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

describe("tasks: the REST happy path", () => {
  it("creates a task: 201, a Location header, and the new resource", async () => {
    const res = await send("POST", "/tasks", { title: "Write tests" });
    expect(res.status).toBe(201);
    const task = await res.json();
    expect(res.headers.get("location")).toBe(`/api/tasks/${task.id}`);
    expect(task).toMatchObject({ title: "Write tests", done: false });
    expect(Date.parse(task.createdAt)).not.toBeNaN();
  });

  it("reads, updates and deletes it", async () => {
    const { id } = await (await send("POST", "/tasks", { title: "Round trip" })).json();
    expect((await (await send("GET", `/tasks/${id}`)).json()).title).toBe("Round trip");

    const patched = await send("PATCH", `/tasks/${id}`, { done: true });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: "Round trip", done: true });

    const deleted = await send("DELETE", `/tasks/${id}`);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect((await send("GET", `/tasks/${id}`)).status).toBe(404);
  });

  it("lists newest first and filters by done", async () => {
    await send("POST", "/tasks", { title: "Open one" });
    await send("POST", "/tasks", { title: "Finished one", done: true });
    const all = (await (await send("GET", "/tasks")).json()).items;
    expect(all[0].title).toBe("Finished one");
    const open = (await (await send("GET", "/tasks?done=false")).json()).items;
    expect(open.every((t: { done: boolean }) => !t.done)).toBe(true);
  });
});

describe("errors are Problem Details (RFC 9457)", () => {
  const expectProblem = async (res: Response, status: number, type: string) => {
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    expect(body).toMatchObject({ status, type: `https://api.djmiskey.com/problems/${type}` });
    return body;
  };

  it("422 lists every invalid field", async () => {
    const body = await expectProblem(await send("POST", "/tasks", { title: "", done: "yes" }), 422, "validation");
    expect(body.errors.map((e: { path: string }) => e.path).sort()).toEqual(["done", "title"]);
    expect(body.instance).toBe("/api/tasks");
  });

  it("422 for unknown fields: a typo isn't silently ignored", async () => {
    const body = await expectProblem(await send("POST", "/tasks", { titel: "Typo" }), 422, "validation");
    expect(JSON.stringify(body.errors)).toContain("titel");
  });

  it("422 for an empty patch and for a bad query", async () => {
    const { id } = await (await send("POST", "/tasks", { title: "Patch me" })).json();
    await expectProblem(await send("PATCH", `/tasks/${id}`, {}), 422, "validation");
    const q = await expectProblem(await send("GET", "/tasks?done=maybe"), 422, "validation");
    expect(q.errors[0].path).toBe("query.done");
  });

  it("400 when the body isn't JSON at all", async () => {
    await expectProblem(await send("POST", "/tasks", "{not json"), 400, "bad-request");
  });

  it("404 for a missing task and for an unknown route", async () => {
    await expectProblem(await send("GET", "/tasks/00000000-0000-4000-8000-000000000000"), 404, "not-found");
    await expectProblem(await send("GET", "/nope"), 404, "not-found");
  });

  it("422, not 500, when the id isn't a UUID", async () => {
    const body = await expectProblem(await send("GET", "/tasks/42"), 422, "validation");
    expect(body.errors[0].path).toBe("param.id");
  });
});

describe("OpenAPI", () => {
  it("documents every route from the same schemas that validate them", async () => {
    const doc = await (await send("GET", "/openapi.json")).json();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).sort()).toEqual(["/api/tasks", "/api/tasks/{id}"]);
    expect(Object.keys(doc.paths["/api/tasks/{id}"]).sort()).toEqual(["delete", "get", "patch"]);
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(["Task", "NewTask", "TaskPatch", "Problem"]));
    expect(doc.paths["/api/tasks"].post.responses["422"].content).toHaveProperty("application/problem+json");
  });
});
