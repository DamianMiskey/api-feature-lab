import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (e2e/). By default they start the production build
// (`npm start`, so run `npm run build` first) with no DATABASE_URL, so the API
// runs on an in-memory PGlite database and tests may write freely. Set
// BASE_URL to test a deployment instead; then only tests tagged @readonly run
// (and @deployed ones), so the live database is never written to:
//   BASE_URL=https://api.djmiskey.com npm run e2e
// Locally the browser is the installed Microsoft Edge; CI installs Chromium.
const CI = !!process.env.CI;
const LIVE = !!process.env.BASE_URL;
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3300";
const channel = CI ? undefined : "msedge";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  // Over the network a request can blip; a pass on retry is reported as flaky.
  retries: CI || LIVE ? 1 : 0,
  workers: CI || LIVE ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  grep: LIVE ? /@readonly|@deployed/ : undefined,
  grepInvert: LIVE ? undefined : /@deployed/,
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel }, testMatch: /pages\.spec/ },
  ],
  // The suite writes more than a visitor would: lift the anonymous write and
  // key-creation limits for the local server (the limiter has its own tests).
  webServer: LIVE ? undefined : {
    command: "npm start -- -p 3300", url: BASE_URL, reuseExistingServer: !CI, timeout: 60_000,
    env: { LAB_WRITE_LIMIT: "100000", LAB_KEY_LIMIT: "100000" },
  },
});
