import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { SCHEMA_SQL } from "./schema";

// Two Postgres backends, one set of queries:
// - DATABASE_URL set (Vercel, with Neon): Neon's HTTP driver, one round trip
//   per query, no connection pool to manage in a serverless function.
// - Otherwise (local dev, tests, CI): PGlite, real Postgres compiled to
//   WebAssembly, in memory. Nothing to install, nothing shared, nothing kept.
type Db = ReturnType<typeof drizzlePglite>;

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // The two drivers expose the same query builder; only transactions differ
    // (neon-http has none), and this lab doesn't use them.
    return drizzleNeon(neon(url)) as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  return drizzlePglite(new PGlite());
}

let ready: Promise<Db> | undefined;

/** The database, connected and with its tables created, once per instance. */
export function db(): Promise<Db> {
  ready ??= connect().then(async (d) => {
    for (const statement of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
      await d.execute(statement);
    }
    return d;
  });
  return ready;
}
