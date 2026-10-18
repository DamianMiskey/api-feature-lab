import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
`;
