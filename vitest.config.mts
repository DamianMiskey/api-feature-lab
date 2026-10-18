import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests call the Hono app directly (app.request), no server needed. With
// no DATABASE_URL the app uses an in-memory PGlite database, so tests never
// touch Neon. End-to-end tests (e2e/) are Playwright's.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 20_000 },
});
