import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { app } from "@/api/app";
import { AUDIENCE, ISSUER, jwtSecret } from "@/api/auth";

const call = (method: string, path: string, opts: { auth?: string; body?: unknown; ip?: string } = {}) =>
  app.request(`/api${path}`, {
    method,
    headers: {
      ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.ip ? { "x-real-ip": opts.ip } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

const createKey = async (scopes: string[] = []) => (await call("POST", "/keys", { body: { name: "test key", scopes } })).json();

describe("API keys", () => {
  it("are shown once, stored only as a hash, and identify the caller", async () => {
    const res = await call("POST", "/keys", { body: { name: "My script", scopes: ["stats:read"] } });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const created = await res.json();
    expect(created.key).toMatch(/^lab_[\w-]{43}$/);
    expect(created.prefix).toBe(created.key.slice(0, 12));
    const me = await call("GET", "/me", { auth: created.key });
    expect(await me.json()).toMatchObject({ method: "api-key", keyId: created.id, name: "My script", scopes: ["stats:read"] });
  });

  it("401 with a WWW-Authenticate challenge: none, unknown, malformed", async () => {
    const none = await call("GET", "/me");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe('Bearer realm="api.djmiskey.com"');
    const unknown = await call("GET", "/me", { auth: "lab_doesnotexist" });
    expect(unknown.status).toBe(401);
    expect(unknown.headers.get("www-authenticate")).toContain('error="invalid_token"');
    const basic = await app.request("/api/me", { headers: { authorization: "Basic dXNlcjpwYXNz" } });
    expect(basic.status).toBe(401);
  });

  it("a bad credential is refused even on a public endpoint", async () => {
    expect((await call("GET", "/tasks", { auth: "lab_wrong" })).status).toBe(401);
  });

  it("403 with insufficient_scope when the key lacks the scope; 200 when it has it", async () => {
    const plain = await createKey();
    const denied = await call("GET", "/stats", { auth: plain.key });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toContain('error="insufficient_scope", scope="stats:read"');
    const reader = await createKey(["stats:read"]);
    const ok = await call("GET", "/stats", { auth: reader.key });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toHaveProperty("tasks.total");
  });

  it("the CSV export needs tasks:export", async () => {
    const exporter = await createKey(["tasks:export"]);
    const res = await call("GET", "/export/tasks", { auth: exporter.key });
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect((await res.text()).split("\n")[0]).toBe("id,title,done,created_at");
  });

  it("rejects unknown scopes", async () => {
    expect((await call("POST", "/keys", { body: { name: "x", scopes: ["admin"] } })).status).toBe(422);
  });

  it("a revoked key stops working at once; only the key itself can revoke it", async () => {
    const a = await createKey();
    const b = await createKey();
    expect((await call("DELETE", `/keys/${a.id}`, { auth: b.key })).status).toBe(403);
    expect((await call("DELETE", `/keys/${a.id}`, { auth: a.key })).status).toBe(204);
    expect((await call("GET", "/me", { auth: a.key })).status).toBe(401);
  });
});

describe("JWTs", () => {
  it("exchange a key for a 15-minute token that works without the key", async () => {
    const key = await createKey(["stats:read"]);
    const res = await call("POST", "/token", { auth: key.key });
    expect(res.status).toBe(200);
    const token = await res.json();
    expect(token).toMatchObject({ token_type: "Bearer", expires_in: 900, scope: "stats:read" });
    const me = await (await call("GET", "/me", { auth: token.access_token })).json();
    expect(me).toMatchObject({ method: "jwt", keyId: key.id, scopes: ["stats:read"] });
    expect((await call("GET", "/stats", { auth: token.access_token })).status).toBe(200);
  });

  it("keep working after the key is revoked, until they expire: the trade-off", async () => {
    const key = await createKey();
    const { access_token } = await (await call("POST", "/token", { auth: key.key })).json();
    await call("DELETE", `/keys/${key.id}`, { auth: key.key });
    expect((await call("GET", "/me", { auth: key.key })).status).toBe(401);
    expect((await call("GET", "/me", { auth: access_token })).status).toBe(200);
  });

  it("refuse tampered, expired, wrongly-addressed tokens, and token-for-token exchanges", async () => {
    const key = await createKey();
    const { access_token } = await (await call("POST", "/token", { auth: key.key })).json();
    const [h, p, s] = access_token.split(".");
    const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
    const forged = [h, btoa(JSON.stringify({ ...payload, scope: "stats:read tasks:export" })).replace(/=+$/, ""), s].join(".");
    expect((await call("GET", "/me", { auth: forged })).status).toBe(401);

    const secret = jwtSecret()!;
    const now = Math.floor(Date.now() / 1000);
    const expired = await sign({ sub: key.id, scope: "", iss: ISSUER, aud: AUDIENCE, iat: now - 2000, exp: now - 1000 }, secret, "HS256");
    expect((await call("GET", "/me", { auth: expired })).status).toBe(401);
    const otherAudience = await sign({ sub: key.id, scope: "", iss: ISSUER, aud: "someone-else", iat: now, exp: now + 60 }, secret, "HS256");
    expect((await call("GET", "/me", { auth: otherAudience })).status).toBe(401);

    expect((await call("POST", "/token", { auth: access_token })).status).toBe(403);
  });
});

describe("rate limiting", () => {
  it("the demo endpoint allows 5 per 10 s, then 429 with Retry-After and RateLimit headers", async () => {
    const statuses: number[] = [];
    let last!: Response;
    for (let i = 0; i < 7; i++) {
      last = await call("GET", "/limits/demo", { ip: "203.0.113.7" });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(last.headers.get("ratelimit-policy")).toBe('"demo";q=5;w=10');
    expect(last.headers.get("ratelimit")).toMatch(/^"demo";r=0;t=\d+$/);
    expect((await last.json()).type).toContain("rate-limited");
  });

  it("counts each client separately", async () => {
    for (let i = 0; i < 6; i++) await call("GET", "/limits/demo", { ip: "198.51.100.1" });
    expect((await call("GET", "/limits/demo", { ip: "198.51.100.2" })).status).toBe(200);
  });

  it("anonymous writes are limited; a key gets its own, larger budget", async () => {
    const before = process.env.LAB_WRITE_LIMIT;
    process.env.LAB_WRITE_LIMIT = "2";
    try {
      const ip = "192.0.2.50";
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await call("POST", "/tasks", { body: { title: `limited ${i}` }, ip })).status);
      expect(statuses).toEqual([201, 201, 429]);
      const key = await createKey();
      expect((await call("POST", "/tasks", { body: { title: "with a key" }, ip, auth: key.key })).status).toBe(201);
    } finally {
      process.env.LAB_WRITE_LIMIT = before;
    }
  });
});

describe("OpenAPI", () => {
  it("documents the bearer scheme and the protected routes", async () => {
    const doc = await (await call("GET", "/openapi.json")).json();
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: "http", scheme: "bearer" });
    expect(doc.paths["/api/stats"].get.security).toEqual([{ bearer: [] }]);
  });
});
