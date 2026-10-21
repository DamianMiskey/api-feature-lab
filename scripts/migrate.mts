// Create the tables once per deployment, at build time, instead of once per
// serverless instance on its first request (which cost a cold start ~166 ms:
// thirteen CREATE … IF NOT EXISTS round trips, seen in a trace). Runs before
// `next build`; with no DATABASE_URL (local, CI, preview builds, which use
// in-memory PGlite) there's nothing to do. A failure fails the build, so a
// deployment can't go live against a database without its tables.
import { neon } from "@neondatabase/serverless";
import { SCHEMA_SQL } from "../src/api/db/schema.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL, skipped (in-memory PGlite creates its tables at startup)");
} else {
  const sql = neon(url);
  const statements = SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean);
  const started = performance.now();
  for (const statement of statements) await sql.query(statement);
  console.log(`migrate: ${statements.length} statements in ${Math.round(performance.now() - started)} ms`);
}
