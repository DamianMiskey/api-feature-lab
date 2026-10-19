import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests call the Hono app directly (app.request), no server needed. With
// no DATABASE_URL the app uses an in-memory PGlite database, so tests never
// touch Neon. End-to-end tests (e2e/) are Playwright's.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    // The tests write far more than a visitor would: lift the anonymous write
    // key-creation, score and inbox limits (the limiter itself is tested on its own).
    env: { LAB_WRITE_LIMIT: "100000", LAB_KEY_LIMIT: "100000", LAB_SCORE_LIMIT: "100000", LAB_INBOX_LIMIT: "100000" },
  },
});
