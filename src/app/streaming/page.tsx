import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Demo, FeaturePage } from "@/components/FeaturePage";
import { LiveBoard } from "./LiveBoard";

export const metadata: Metadata = { title: "Streaming (SSE)" };

export default function StreamingPage() {
  return (
    <FeaturePage
      title="Streaming (SSE)"
      tagline="Server-Sent Events: a live leaderboard over plain HTTP."
      docs="https://html.spec.whatwg.org/multipage/server-sent-events.html"
      whatItIs={<p>
        Server-Sent Events keep one HTTP response open and write messages into it as things happen: lines of{" "}
        <code>event:</code>, <code>data:</code> and <code>id:</code>, with a blank line between messages
        (<code>text/event-stream</code>). The browser&apos;s <code>EventSource</code> reads them, and if the connection
        drops it <strong>reconnects by itself</strong>, sending the last id it saw as <code>Last-Event-ID</code> so the server
        can carry on from there. Simpler than WebSockets (one direction, ordinary HTTP, no extra protocol), and enough
        whenever only the server has news.
      </p>}
      whenToUse={[
        "Live updates the server pushes: scores, notifications, build logs, progress bars",
        "Streaming AI responses token by token (most AI APIs use SSE)",
        "Not when the client sends a stream back too: that's a WebSocket's job",
      ]}
    >
      <Demo title="1. A live leaderboard">
        <LiveBoard />
        <p className="text-sm text-muted">
          Connect, then post a score (or open this page in a second window and post from there): the board arrives again the
          moment the score is stored. Each stream lasts 25 seconds; watch the browser reconnect with <code>Last-Event-ID</code>{" "}
          and pick up where it left off. The game boards are live too: they change when someone finishes a run on the{" "}
          <a href="https://motion.djmiskey.com">Motion lab</a>.
        </p>
      </Demo>

      <p className="text-sm text-muted">
        A serverless function has no memory shared with the function that stored the score, so the stream polls the event log
        once a second for anything after its last id: the same event log the webhooks are sent from. Streams end after 25
        seconds and this page stops listening after two minutes, because an open stream keeps a function running.
      </p>

      <CodePeek file="api/routes/scores.ts" />
    </FeaturePage>
  );
}
