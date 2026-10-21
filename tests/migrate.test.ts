import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The build step that creates production's tables. Without DATABASE_URL (local,
// CI, previews) it must skip quietly, or every non-production build would fail.
describe("scripts/migrate.mts", () => {
  it("skips without DATABASE_URL", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(__dirname, "..", "scripts", "migrate.mts")], { env, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("skipped");
  });
});
