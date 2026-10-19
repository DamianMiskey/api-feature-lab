import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Explorer } from "@/components/Explorer";
import { Demo, FeaturePage } from "@/components/FeaturePage";
import { RetryDemo } from "./RetryDemo";

export const metadata: Metadata = { title: "Idempotency keys" };

export default function IdempotencyPage() {
  return (
    <FeaturePage
      title="Idempotency keys"
      tagline="Retry a POST safely: the second one changes nothing."
      docs="https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/"
      whatItIs={<p>
        GET, PUT and DELETE can be repeated without harm; POST can&apos;t. When a POST times out, the client can&apos;t tell
        whether the server did the work, so retrying risks doing it twice: two orders, two charges, one game run on the board
        twice. The fix is an <code>Idempotency-Key</code> header: the client makes up a unique value per operation and sends it
        with every attempt. The server records the first response under that key and <strong>replays</strong> it for any retry.
        The same key with a different body is a <strong>422</strong>; a retry that arrives while the first attempt is still running
        gets a <strong>409</strong>. Only successes are remembered, so a request that failed validation can be fixed and retried
        with the same key. Keys last 24 hours and are scoped to the client.
      </p>}
      whenToUse={[
        "Anything with a side effect that mustn't happen twice: payments, orders, messages, scores",
        "Clients on unreliable networks (phones), and any client that retries automatically",
        "Make it required where a duplicate would really hurt; optional elsewhere",
      ]}
    >
      <Demo title="1. A lost response, and the retry">
        <RetryDemo />
      </Demo>

      <Demo title="2. Without a key">
        <Explorer presets={[
          { label: "No key", method: "POST", path: "/api/scores", body: '{ "game": "demo", "initials": "NOK", "value": 1 }', note: "POST /api/scores requires the header: 400." },
          { label: "With a key", method: "POST", path: "/api/scores", headers: { "Idempotency-Key": '"explorer-demo-key"' }, body: '{ "game": "demo", "initials": "KEY", "value": 1 }', note: "Send it twice and look for Idempotent-Replayed. Then change the value and send again." },
        ]} />
      </Demo>

      <p className="text-sm text-muted">
        These are the leaderboards of the <a href="https://motion.djmiskey.com">Motion lab</a>&apos;s games: when a run ends, the
        game posts its score with a fresh key and retries with the same key if the network fails. (This page posts to a
        separate <code>demo</code> board.) Claiming the key is a single <code>INSERT … ON CONFLICT DO NOTHING</code>, so of two
        concurrent requests with one key, exactly one does the work.
      </p>

      <CodePeek file="api/idempotency.ts" />
      <CodePeek file="api/routes/scores.ts" />
    </FeaturePage>
  );
}
