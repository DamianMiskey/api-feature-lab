import type { Context } from "hono";

// Conditional requests, written out by hand so the mechanics are visible.

/**
 * A strong ETag for a JSON representation: a hash of exactly the bytes the
 * client receives. Change one field and the tag changes; send the same data
 * twice and it doesn't.
 */
export async function etagFor(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return `"${btoa(String.fromCharCode(...hash)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}"`;
}

const tags = (header: string | undefined) => (header ?? "").split(",").map((t) => t.trim().replace(/^W\//, "")).filter(Boolean);

/** If-None-Match: the client already has this version, so answer 304 with no body. */
export const isNotModified = (c: Context, etag: string) => {
  const sent = tags(c.req.header("if-none-match"));
  return sent.includes("*") || sent.includes(etag);
};

/**
 * If-Match: only change the resource if it's still the version the client
 * last saw. Without the header the write goes ahead (optimistic locking is
 * opt-in here; an API could demand it with 428 Precondition Required).
 */
export const failsIfMatch = (c: Context, etag: string) => {
  const sent = tags(c.req.header("if-match"));
  return sent.length > 0 && !sent.includes("*") && !sent.includes(etag);
};

/** Cursors are opaque to clients: base64url JSON they must hand back unchanged. */
export const encodeCursor = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
export function decodeCursor<T>(cursor: string): T | null {
  try {
    return JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}
