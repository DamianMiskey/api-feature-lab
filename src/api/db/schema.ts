import { bigint, bigserial, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

// Game scores for the Motion lab's leaderboards. initials are three capital
// letters, like an arcade cabinet's; value is points, or milliseconds for a
// timed game (see GAMES in routes/scores.ts).
export const scores = pgTable("scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  game: text("game").notNull(),
  initials: text("initials").notNull(),
  value: integer("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScoreRow = typeof scores.$inferSelect;

// Idempotency keys: the first response to each (client, key) pair, kept for
// 24 hours so a retry gets the same answer instead of doing the work again.
// status is null while the first request is still running.
export const idempotencyKeys = pgTable("idempotency_keys", {
  client: text("client").notNull(),
  key: text("key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  status: integer("status"),
  headers: jsonb("headers").$type<Record<string, string>>(),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.client, t.key] })]);

// Everything that happened, in order: the source for webhooks and for the
// live stream. id only ever grows, so "everything after id N" is a resume point.
export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  type: text("type").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventRow = typeof events.$inferSelect;

// Webhook subscribers. In this lab they're demo inboxes on this same API, so
// nothing is ever sent to an address a visitor typed in. failFirst makes the
// inbox refuse its first deliveries, to show the retries.
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  secret: text("secret").notNull(),
  failFirst: integer("fail_first").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One message to one endpoint, retried until it's accepted or runs out of attempts.
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpointId: uuid("endpoint_id").notNull(),
  eventId: bigint("event_id", { mode: "number" }).notNull(),
  status: text("status").$type<"pending" | "delivered" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeliveryRow = typeof webhookDeliveries.$inferSelect;

// The sender's log: every attempt and what came back.
export const webhookAttempts = pgTable("webhook_attempts", {
  deliveryId: uuid("delivery_id").notNull(),
  attempt: integer("attempt").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  responseStatus: integer("response_status").notNull(),
  response: text("response").notNull(),
}, (t) => [primaryKey({ columns: [t.deliveryId, t.attempt] })]);

// The receiving inbox's memory of each message id: how many times it refused
// it (the failFirst demo), and when it processed it, so a redelivery (the
// sender never saw our 200) isn't handled twice.
export const webhookReceipts = pgTable("webhook_receipts", {
  endpointId: uuid("endpoint_id").notNull(),
  messageId: text("message_id").notNull(),
  refusals: integer("refusals").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.endpointId, t.messageId] })]);

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
  create table if not exists scores (
    id uuid primary key default gen_random_uuid(),
    game text not null,
    initials text not null check (initials ~ '^[A-Z]{3}$'),
    value integer not null check (value >= 0),
    created_at timestamptz not null default now()
  );
  create index if not exists scores_game_value on scores (game, value, created_at);
  create table if not exists idempotency_keys (
    client text not null,
    key text not null,
    fingerprint text not null,
    status integer,
    headers jsonb,
    body text,
    created_at timestamptz not null default now(),
    primary key (client, key)
  );
  create table if not exists events (
    id bigserial primary key,
    type text not null,
    data jsonb not null,
    created_at timestamptz not null default now()
  );
  create table if not exists webhook_endpoints (
    id uuid primary key default gen_random_uuid(),
    secret text not null,
    fail_first integer not null default 0,
    created_at timestamptz not null default now()
  );
  create table if not exists webhook_deliveries (
    id uuid primary key default gen_random_uuid(),
    endpoint_id uuid not null references webhook_endpoints (id) on delete cascade,
    event_id bigint not null,
    status text not null default 'pending',
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    created_at timestamptz not null default now()
  );
  create index if not exists webhook_deliveries_due on webhook_deliveries (next_attempt_at) where status = 'pending';
  create table if not exists webhook_attempts (
    delivery_id uuid not null references webhook_deliveries (id) on delete cascade,
    attempt integer not null,
    at timestamptz not null default now(),
    response_status integer not null,
    response text not null,
    primary key (delivery_id, attempt)
  );
  create table if not exists webhook_receipts (
    endpoint_id uuid not null references webhook_endpoints (id) on delete cascade,
    message_id text not null,
    refusals integer not null default 0,
    processed_at timestamptz,
    primary key (endpoint_id, message_id)
  );
`;
