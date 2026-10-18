import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Explorer } from "@/components/Explorer";
import { Demo, FeaturePage } from "@/components/FeaturePage";
import { DEMO_LIMIT, DEMO_WINDOW } from "@/api/routes/limits";
import { Burst } from "./Burst";

export const metadata: Metadata = { title: "Rate limiting" };

export default function RateLimitsPage() {
  return (
    <FeaturePage
      title="Rate limiting"
      tagline="Share capacity fairly, and tell clients exactly when to come back."
      docs="https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/"
      whatItIs={<p>
        A rate limit caps how many requests one client can make in a time window, so one buggy script can&apos;t starve
        everyone else. Over the limit, the API answers <strong>429 Too Many Requests</strong> with{" "}
        <code>Retry-After</code>: how many seconds to wait. Every response also carries the IETF <code>RateLimit-Policy</code>{" "}
        (the quota and window) and <code>RateLimit</code> (requests remaining, seconds until reset), so a well-behaved client
        can slow down <em>before</em> hitting the wall. This lab counts in Postgres with a <strong>sliding window</strong>: the
        current window&apos;s count plus the previous window&apos;s, weighted by how much of it still overlaps, which avoids the
        double burst a plain fixed window allows at its boundary.
      </p>}
      whenToUse={[
        "Every public endpoint, especially writes and logins",
        "Expensive operations: search, exports, AI calls",
        "Giving paying or authenticated clients a bigger budget than anonymous ones",
      ]}
    >
      <Demo title={`1. Burst: ${DEMO_LIMIT} requests per ${DEMO_WINDOW} seconds`}>
        <Burst />
        <p className="text-sm text-muted">
          The first {DEMO_LIMIT} get through with the remaining count going down; the rest get 429 and a Retry-After. Wait{" "}
          {DEMO_WINDOW} seconds and the budget comes back gradually, as the old window slides out.
        </p>
      </Demo>

      <Demo title="2. One request, all the headers">
        <Explorer presets={[{ label: "Demo endpoint", method: "GET", path: "/api/limits/demo", note: "Look at RateLimit-Policy and RateLimit." }]} />
      </Demo>

      <p className="text-sm text-muted">
        The same limiter guards the real writes: creating, changing or deleting tasks is limited to 30 a minute per IP address,
        or 120 with an API key or token (keys are counted per key, not per IP). Creating keys is limited to 5 an hour, and
        exchanging them for tokens to 20 a minute. On Vercel the client IP comes from <code>x-real-ip</code>, which Vercel&apos;s
        network sets itself, so a client can&apos;t fake its way into a fresh budget.
      </p>

      <CodePeek file="api/ratelimit.ts" />
      <CodePeek file="api/app.ts" />
    </FeaturePage>
  );
}
