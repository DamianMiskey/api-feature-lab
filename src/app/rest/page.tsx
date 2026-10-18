import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Explorer } from "@/components/Explorer";
import { Demo, FeaturePage } from "@/components/FeaturePage";

export const metadata: Metadata = { title: "REST basics" };

const CODES = [
  ["200 OK", "Here's what you asked for (GET), or the updated resource (PATCH)."],
  ["201 Created", "Something new exists. The Location header says where."],
  ["204 No Content", "Done, nothing to send back (DELETE)."],
  ["400 Bad Request", "The request couldn't even be read, such as broken JSON."],
  ["404 Not Found", "No resource at that URL."],
  ["422 Unprocessable Content", "Readable, but invalid: a missing title, a wrong type."],
];

export default function RestPage() {
  return (
    <FeaturePage
      title="REST basics"
      tagline="Resources, methods and status codes, on a live tasks API."
      docs="https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods"
      whatItIs={<p>
        A REST API is organised around <strong>resources</strong>, each with a URL: <code>/api/tasks</code> is the collection,{" "}
        <code>/api/tasks/&#123;id&#125;</code> is one task. The <strong>HTTP method</strong> says what to do: <code>GET</code>{" "}
        reads, <code>POST</code> creates, <code>PATCH</code> changes some fields, <code>DELETE</code> removes. The{" "}
        <strong>status code</strong> says how it went, before anyone reads the body. GET is <em>safe</em> (changes nothing), and
        GET, PATCH with the same body, and DELETE are <em>idempotent</em>: sending them twice leaves things as sending them once.
      </p>}
      whenToUse={[
        "Public APIs that other teams or companies call",
        "CRUD over data with clear nouns (tasks, orders, users)",
        "Anything that benefits from HTTP caching and standard tooling",
      ]}
    >
      <Demo title="Try the tasks API">
        <Explorer
          presets={[
            { label: "List", method: "GET", path: "/api/tasks", note: "The collection: the newest tasks first." },
            { label: "Create", method: "POST", path: "/api/tasks", body: '{ "title": "Learn about status codes" }', note: "201 Created, with a Location header pointing at the new task." },
            { label: "Get one", method: "GET", path: "/api/tasks/{id}", note: "One resource, by the id from Create." },
            { label: "Mark done", method: "PATCH", path: "/api/tasks/{id}", body: '{ "done": true }', note: "PATCH sends only the fields that change." },
            { label: "Delete", method: "DELETE", path: "/api/tasks/{id}", note: "204 No Content. Send it again and you get 404: the task is gone either way." },
            { label: "Only done", method: "GET", path: "/api/tasks?done=true", note: "Query parameters filter a collection." },
          ]}
        />
      </Demo>

      <Demo title="The status codes used here">
        <dl className="m-0 grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
          {CODES.map(([code, meaning]) => <div key={code} className="contents"><dt className="font-mono text-sm font-semibold">{code}</dt><dd className="m-0 text-sm">{meaning}</dd></div>)}
        </dl>
      </Demo>

      <p className="text-sm text-muted">
        The tasks are real rows in Postgres, shared by everyone visiting the lab (only the newest 200 are kept), so be kind in
        what you write.
      </p>

      <CodePeek file="api/routes/tasks.ts" />
      <CodePeek file="app/api/[[...route]]/route.ts" />
    </FeaturePage>
  );
}
