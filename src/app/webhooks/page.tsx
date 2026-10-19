import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Demo, FeaturePage } from "@/components/FeaturePage";
import { backoff, MAX_ATTEMPTS } from "@/api/webhooks";
import { WebhookDemo } from "./WebhookDemo";

export const metadata: Metadata = { title: "Webhooks" };

const waits = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => `${backoff(i + 1)}s`).join(", ");

export default function WebhooksPage() {
  return (
    <FeaturePage
      title="Webhooks"
      tagline="Signed deliveries with retries and verification."
      docs="https://www.standardwebhooks.com"
      whatItIs={<p>
        A webhook turns polling around: when something happens, the API sends an HTTP POST to a URL the subscriber registered.
        Subscribers&apos; servers go down, so the sender <strong>retries</strong> with exponential backoff (here {waits}) and,
        after {MAX_ATTEMPTS} attempts, marks the delivery <strong>failed</strong> instead of trying forever. Every message is{" "}
        <strong>signed</strong> in the Standard Webhooks format: an HMAC-SHA256 over the message id, a timestamp and the exact
        body, with a secret only the two sides share. The subscriber checks the signature (proving it came from the API),
        the timestamp (refusing old captured messages), and the message id (a redelivery after a lost 200 is processed once).
      </p>}
      whenToUse={[
        "Telling other systems about events as they happen: payments, builds, new scores",
        "Instead of clients polling for changes that are rare",
        "Not for the browser: webhooks call servers. For live pages, see Streaming (SSE)",
      ]}
    >
      <Demo title="1. Subscribe an inbox and send it events">
        <WebhookDemo />
        <p className="text-sm text-muted">
          With the inbox set to refuse twice, a ping is refused (503), retried after 2 seconds (503 again), then 4 seconds later
          accepted. The demo inboxes also receive every <code>score.submitted</code> event for an hour, including real scores
          from the Motion lab&apos;s games. The forged message is turned away by the signature check (401).
        </p>
      </Demo>

      <p className="text-sm text-muted">
        Deliveries are queued in Postgres when the event is recorded. In a production system a worker or queue would send them;
        Vercel&apos;s free cron runs only once a day, so here the first attempt happens straight away and later ones whenever the
        delivery log is read, which the page above does every second while something is pending. The inboxes are part of this
        same API, so deliveries never leave it: nothing is ever sent to an address a visitor typed in.
      </p>

      <CodePeek file="api/webhooks.ts" />
      <CodePeek file="api/routes/webhooks.ts" />
    </FeaturePage>
  );
}
