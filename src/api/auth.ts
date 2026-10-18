import type { Context, MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { apiKeys } from "./db/schema";
import { problem } from "./problem";

// Two kinds of credentials, both sent as "Authorization: Bearer …":
// - API keys ("lab_…"): long-lived, looked up in the database on every
//   request, revocable instantly.
// - JWTs, issued in exchange for a key: short-lived (15 minutes), verified
//   with a signature alone, no database lookup, so they can't be revoked
//   before they expire. That's the trade-off.

export const SCOPES = ["stats:read", "tasks:export"] as const;
export type Scope = (typeof SCOPES)[number];

export type Auth = { method: "api-key" | "jwt"; keyId: string; name: string; scopes: Scope[]; expiresAt: string };
export type AuthEnv = { Variables: { auth?: Auth } };

export const ISSUER = "https://api.djmiskey.com";
export const AUDIENCE = "api-feature-lab";
export const TOKEN_TTL = 15 * 60;

/** The HMAC secret for JWTs. Required in production; a fixed value elsewhere. */
export function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Production (with a real database) must have its own secret: fail closed.
  return process.env.DATABASE_URL ? null : "dev-only-jwt-secret-not-for-production";
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Keys carry 256 random bits, so a plain SHA-256 is the right hash: nobody
 * can guess or brute-force one. (Passwords are different: people pick weak
 * ones, so those need a slow hash like Argon2 or bcrypt.)
 */
export const hashKey = async (key: string) => toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));

export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `lab_${btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

const challenge = (c: Context, params: string) => c.header("WWW-Authenticate", `Bearer realm="${new URL(ISSUER).host}"${params}`);

/** 401: no credentials, or ones that don't work. RFC 6750 says which. */
export function unauthorized(c: Context, detail: string, invalid = true) {
  challenge(c, invalid ? `, error="invalid_token", error_description="${detail}"` : "");
  return problem(c, 401, "unauthorized", { detail });
}

/** 403: the credentials are fine, but don't carry the scope this needs. */
export function forbidden(c: Context, scope: Scope) {
  challenge(c, `, error="insufficient_scope", scope="${scope}"`);
  return problem(c, 403, "forbidden", { detail: `This needs the "${scope}" scope.` });
}

async function fromApiKey(key: string): Promise<Auth | null> {
  const d = await db();
  const [row] = await d.select().from(apiKeys)
    .where(and(eq(apiKeys.hash, await hashKey(key)), isNull(apiKeys.revokedAt), gt(apiKeys.expiresAt, new Date())));
  if (!row) return null;
  await d.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { method: "api-key", keyId: row.id, name: row.name, scopes: row.scopes as Scope[], expiresAt: row.expiresAt.toISOString() };
}

async function fromJwt(token: string): Promise<Auth | null> {
  const secret = jwtSecret();
  if (!secret) return null;
  try {
    const claims = await verify(token, secret, { alg: "HS256", iss: ISSUER, aud: AUDIENCE });
    return {
      method: "jwt",
      keyId: String(claims.sub),
      name: String(claims.name ?? ""),
      scopes: String(claims.scope ?? "").split(" ").filter(Boolean) as Scope[],
      expiresAt: new Date(Number(claims.exp) * 1000).toISOString(),
    };
  } catch {
    return null; // bad signature, expired, wrong issuer or audience
  }
}

/**
 * Runs on every request. No Authorization header: anonymous, which is fine
 * for public endpoints. A header that doesn't check out is always a 401,
 * even on a public endpoint: silently ignoring a bad credential hides bugs.
 */
export const authenticate: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  if (!header) return next();
  const [scheme, credential] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !credential) return unauthorized(c, "Use Authorization: Bearer <key or token>");
  const auth = credential.startsWith("lab_") ? await fromApiKey(credential) : await fromJwt(credential);
  if (!auth) return unauthorized(c, credential.startsWith("lab_") ? "Unknown, revoked or expired API key" : "Invalid or expired token");
  c.set("auth", auth);
  return next();
};

/** For protected routes: a 401 without (valid) credentials. */
export function requireAuth(c: Context<AuthEnv>) {
  const auth = c.get("auth");
  return auth ? { auth } : { error: unauthorized(c, "This endpoint needs an API key or token", false) };
}

/** As requireAuth, plus a 403 if the credentials lack the scope. */
export function requireScope(c: Context<AuthEnv>, scope: Scope) {
  const { auth, error } = requireAuth(c);
  if (error) return { error };
  return auth.scopes.includes(scope) ? { auth } : { error: forbidden(c, scope) };
}

export async function issueToken(auth: Auth, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: auth.keyId, name: auth.name, scope: auth.scopes.join(" "), iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + TOKEN_TTL }, secret, "HS256");
}
