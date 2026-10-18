import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Explorer } from "@/components/Explorer";
import { Demo, FeaturePage } from "@/components/FeaturePage";

export const metadata: Metadata = { title: "ETags & caching" };

export default function CachingPage() {
  return (
    <FeaturePage
      title="ETags & caching"
      tagline="Don't resend what the client already has, and don't let two editors overwrite each other."
      docs="https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests"
      whatItIs={<p>
        An <strong>ETag</strong> is a fingerprint of a response, here a hash of its exact JSON. A client that keeps a copy sends
        the fingerprint back in <code>If-None-Match</code>; if nothing changed, the API answers <strong>304 Not Modified</strong>{" "}
        with no body. The same fingerprint guards writes: sent in <code>If-Match</code>, it means &quot;only save this if the
        task is still the version I read&quot;. If someone else saved in between, the API refuses with{" "}
        <strong>412 Precondition Failed</strong> instead of silently losing their change (optimistic concurrency).{" "}
        <code>Cache-Control: no-cache</code> lets browsers and proxies store responses, but only reuse them after checking the
        ETag with the API.
      </p>}
      whenToUse={[
        "Large or frequently polled resources (save bandwidth with 304s)",
        "Anything two people can edit at once: documents, settings, carts",
        "Mobile clients on slow or metered connections",
      ]}
    >
      <Demo title="Fingerprints, 304s and 412s">
        <Explorer
          presets={[
            { label: "Create", method: "POST", path: "/api/tasks", body: '{ "title": "Shared document" }', note: "Make a task to work with. The response already carries its ETag." },
            { label: "Get", method: "GET", path: "/api/tasks/{id}", note: "200 with the task, its ETag and Cache-Control: no-cache." },
            { label: "Get, if changed", method: "GET", path: "/api/tasks/{id}", headers: { "If-None-Match": "{etag}" }, note: "Sends the ETag back: 304 Not Modified, no body. Nothing was resent." },
            { label: "Save, if unchanged", method: "PATCH", path: "/api/tasks/{id}", body: '{ "title": "Edited safely" }', headers: { "If-Match": "{etag}" }, note: "The ETag matches, so the save goes through, and the response has the new ETag." },
            { label: "Save with an old ETag", method: "PATCH", path: "/api/tasks/{id}", body: '{ "title": "Overwrite!" }', headers: { "If-Match": '"an-etag-from-before"' }, note: "Like a second editor who read the task before the last save: 412, nothing overwritten." },
            { label: "List, if changed", method: "GET", path: "/api/tasks?limit=3", headers: { "If-None-Match": "{etag}" }, note: "Lists have ETags too. Send this twice: the second time it's a 304 (unless someone added a task)." },
          ]}
        />
      </Demo>

      <p className="text-sm text-muted">
        These ETags are <em>strong</em> (a hash of the exact bytes), so each representation has its own: the version 2 shape of
        the same task (see Versioning) has a different ETag. The If-Match check and the update are one atomic SQL statement
        (<code>WHERE id = … AND updated_at = …</code>), so a save that lands between the check and the write still can&apos;t be
        overwritten.
      </p>

      <CodePeek file="api/http.ts" />
      <CodePeek file="api/routes/tasks.ts" />
    </FeaturePage>
  );
}
