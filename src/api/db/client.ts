import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { countQuery, span, SpanKind } from "../observe";
import { SCHEMA_SQL } from "./schema";

// Two Postgres backends, one set of queries:
// - DATABASE_URL set (Vercel, with Neon): Neon's HTTP driver, one round trip
//   per query, no connection pool to manage in a serverless function.
// - Otherwise (local dev, tests, CI): PGlite, real Postgres compiled to
//   WebAssembly, in memory. Nothing to install, nothing shared, nothing kept.
type Db = ReturnType<typeof drizzlePglite>;

// Drizzle calls this for every query: each one counts against the request
// that ran it, so its log line says how many round trips it cost.
const queryCounter = { logQuery: () => countQuery() };

type Query = (text: string, ...rest: unknown[]) => Promise<unknown>;

/**
 * Both drivers send every query through client.query(text, params, …): time
 * each call as a span. Its name follows OpenTelemetry's database conventions
 * ("SELECT tasks"); the text has placeholders ($1, $2), never the values, so
 * no data ends up in traces.
 */
function traceQueries<T extends { query: Query }>(client: T): T {
  const query = client.query.bind(client);
  client.query = ((text: string, ...rest: unknown[]) => {
    const operation = text.trim().split(/\s+/)[0]?.toUpperCase() ?? "QUERY";
    const table = text.match(/\b(?:from|into|update|table(?: if not exists)?|index if not exists \w+ on)\s+"?(\w+)/i)?.[1];
    return span(table ? `${operation} ${table}` : operation, {
      "db.system.name": "postgresql", "db.operation.name": operation, "db.collection.name": table, "db.query.text": text.slice(0, 1000),
    }, () => query(text, ...rest), SpanKind.CLIENT);
  }) as T["query"];
  return client;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // The two drivers expose the same query builder; only transactions differ
    // (neon-http has none), and this lab doesn't use them.
    return drizzleNeon(traceQueries(neon(url) as unknown as { query: Query }) as never, { logger: queryCounter }) as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  return drizzlePglite(traceQueries(new PGlite() as unknown as { query: Query }) as never, { logger: queryCounter });
}

let ready: Promise<Db> | undefined;

/** The database, connected and with its tables created, once per instance. */
export function db(): Promise<Db> {
  ready ??= connect().then(async (d) => {
    // Production's tables are created at build time (scripts/migrate.mts), and
    // the Worker shares that database: neither repeats it on a cold start.
    if (process.env.LAB_SCHEMA === "skip" || process.env.VERCEL_ENV === "production") return d;
    // In-memory PGlite (local, tests, previews) starts empty: its first request
    // creates the tables. One span around the lot, so it's easy to spot in a trace.
    await span("db.ensure-schema", {}, async () => {
      for (const statement of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
        await d.execute(statement);
      }
    });
    return d;
  });
  return ready;
}
