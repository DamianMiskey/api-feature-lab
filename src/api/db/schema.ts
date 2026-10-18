import { bigint, boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// The one resource the REST pages work with. Drizzle turns this into typed
// queries; the table itself is created by ensureSchema() in client.ts.
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskRow = typeof tasks.$inferSelect;

// API keys: only a SHA-256 hash of each key is stored, plus its first
// characters so a person can recognise it in a list. The key itself is shown
// once, when it's created.
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export type ApiKeyRow = typeof apiKeys.$inferSelect;

// Rate-limit counters: one row per client per time window.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").notNull(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] })]);

// Same shape in SQL, with the limits enforced by the database too.
export const SCHEMA_SQL = `
  create table if not exists tasks (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(title) between 1 and 200),
    done boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists tasks_created_at on tasks (created_at desc, id desc);
  create table if not exists api_keys (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 60),
    prefix text not null,
    hash text not null unique,
    scopes text[] not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    last_used_at timestamptz
  );
  create table if not exists rate_limits (
    key text not null,
    window_start bigint not null,
    count integer not null,
    primary key (key, window_start)
  );
`;
