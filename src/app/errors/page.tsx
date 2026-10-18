import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Explorer } from "@/components/Explorer";
import { Demo, FeaturePage } from "@/components/FeaturePage";

export const metadata: Metadata = { title: "Validation & errors" };

export default function ErrorsPage() {
  return (
    <FeaturePage
      title="Validation & errors"
      tagline="Reject bad input precisely, and fail in one predictable shape."
      docs="https://www.rfc-editor.org/rfc/rfc9457.html"
      whatItIs={<p>
        Every request is checked against a <strong>Zod schema</strong> before the handler runs: types, lengths, allowed
        fields. When something fails, the API answers with <strong>Problem Details</strong> (RFC 9457): JSON with a{" "}
        <code>type</code>, <code>title</code>, <code>status</code> and <code>detail</code>, sent as{" "}
        <code>application/problem+json</code>. Validation failures add an <code>errors</code> list with the path of each bad
        field, so a form can put each message next to its input. One shape for every error means a client needs one error
        handler, not one per endpoint.
      </p>}
      whenToUse={[
        "Any API that accepts input from someone else",
        "Forms that should show errors next to the right field",
        "Clients in several languages that need to handle errors the same way",
      ]}
    >
      <Demo title="Break it on purpose">
        <Explorer
          presets={[
            { label: "Two bad fields", method: "POST", path: "/api/tasks", body: '{ "title": "", "done": "yes" }', note: "422: both problems at once, each with its path." },
            { label: "Typo in a field", method: "POST", path: "/api/tasks", body: '{ "titel": "Oops" }', note: "Unknown fields are rejected (strictObject), so a typo isn't silently dropped." },
            { label: "Not JSON", method: "POST", path: "/api/tasks", body: "{ title: Oops", note: "400: the body can't even be parsed. Different from 422, where it parses but is wrong." },
            { label: "Bad id", method: "GET", path: "/api/tasks/42", note: "The id must be a UUID: 422 from validation, never a 500 from the database." },
            { label: "Missing task", method: "GET", path: "/api/tasks/00000000-0000-4000-8000-000000000000", note: "404, in the same Problem shape." },
            { label: "Bad query", method: "GET", path: "/api/tasks?done=maybe", note: "Query parameters are validated too: the path is query.done." },
            { label: "No such route", method: "GET", path: "/api/nope", note: "Even Hono's own 404 is a Problem." },
          ]}
        />
      </Demo>

      <p className="text-sm text-muted">
        400 or 422? <strong>400 Bad Request</strong> when the request can&apos;t be read (malformed JSON, wrong content type),{" "}
        <strong>422 Unprocessable Content</strong> when it can be read but isn&apos;t valid. Many APIs use 400 for both; keeping
        them apart tells the client whether the bug is in how it encodes requests or in the data itself.
      </p>

      <CodePeek file="api/problem.ts" />
      <CodePeek file="api/validation.ts" />
      <CodePeek file="api/app.ts" />
    </FeaturePage>
  );
}
