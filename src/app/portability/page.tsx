import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Demo, FeaturePage } from "@/components/FeaturePage";
import { BothPlatforms } from "./BothPlatforms";

export const metadata: Metadata = { title: "One API, two platforms" };

export default function PortabilityPage() {
  return (
    <FeaturePage
      title="One API, two platforms"
      tagline="The same Hono app on Vercel and on Cloudflare Workers."
      docs="https://hono.dev/docs/getting-started/cloudflare-workers"
      whatItIs={<p>
        Hono is built on web standards: a handler takes a <code>Request</code> and returns a <code>Response</code>, the same
        objects browsers use. So the API behind this lab runs unchanged in two very different places. On{" "}
        <strong>Vercel</strong> it&apos;s a Node.js function in one region (Washington, D.C., next to the database), mounted
        into Next.js. On <strong>Cloudflare Workers</strong> (<a href="https://api-cf.djmiskey.com/api/health">api-cf.djmiskey.com</a>)
        it runs in V8 isolates in hundreds of cities, starting in milliseconds. Both talk to the same Neon Postgres over
        HTTP, so they share every task, key and score. What differs is configuration, not code: how secrets arrive, which
        header carries the client&apos;s IP, and the limits each platform sets.
      </p>}
      whenToUse={[
        "Avoiding lock-in: keep the API portable, choose the host later",
        "Running near users (Workers) or near the data (one region)",
        "Moving an API between platforms without a rewrite",
      ]}
    >
      <Demo title="1. Ask both">
        <BothPlatforms />
        <p className="text-sm text-muted">
          &quot;To the database&quot; is measured inside each copy: a <code>select 1</code> to Neon in AWS us-east-1. The Vercel
          function sits in the same region, a millisecond or two away. A Worker starts in the Cloudflare city nearest you, so
          from far away every query crosses an ocean, and a request makes several. <strong>Smart Placement</strong> is on: once
          Cloudflare has seen enough traffic, it runs the Worker next to the database instead (the <code>cf-placement</code>{" "}
          response header says <code>remote-…</code> when it does).
        </p>
      </Demo>

      <section className="mb-4 rounded-xl border border-line bg-surface px-5 py-4">
        <h2>2. What changed between the two</h2>
        <ul className="mb-0 text-sm">
          <li><strong>Entry point:</strong> Vercel mounts the app with <code>hono/vercel</code> in a Next.js route; the Worker exports{" "}
            <code>{"{ fetch }"}</code> that calls <code>app.fetch</code> (below).</li>
          <li><strong>Client IP:</strong> <code>x-real-ip</code> is set by Vercel&apos;s network; on Cloudflare the Worker copies{" "}
            <code>CF-Connecting-IP</code> into it, overwriting anything the client sent, so the rate limiter can&apos;t be fooled on either.</li>
          <li><strong>Configuration:</strong> both read <code>process.env</code>. On Workers that needs the <code>nodejs_compat</code> flag;
            settings live in <code>wrangler.jsonc</code>, secrets are set with <code>wrangler secret put</code>.</li>
          <li><strong>Bundle:</strong> PGlite (the local database, WebAssembly) is swapped for a stub, since the Worker always has Neon.</li>
          <li><strong>Limits</strong> (Free plans): Workers allow 10 ms of CPU and 50 outgoing requests per request, so every
            database query counts. The Worker skips the create-table statements and keeps live streams to 15 seconds. Vercel
            functions run up to 300 s with more CPU, but in one region.</li>
          <li><strong>Not portable:</strong> the pages. They&apos;re Next.js on Vercel; the Worker serves only <code>/api</code>.</li>
        </ul>
      </section>

      <CodePeek file="../worker/index.ts" />
      <CodePeek file="../wrangler.jsonc" />
      <CodePeek file="app/api/[[...route]]/route.ts" />
    </FeaturePage>
  );
}
