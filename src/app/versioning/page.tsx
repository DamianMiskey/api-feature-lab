import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Explorer } from "@/components/Explorer";
import { Demo, FeaturePage } from "@/components/FeaturePage";

export const metadata: Metadata = { title: "Versioning" };

export default function VersioningPage() {
  return (
    <FeaturePage
      title="Versioning"
      tagline="Change an API without breaking the clients already using it."
      docs="https://www.rfc-editor.org/rfc/rfc9745.html"
      whatItIs={<p>
        Adding a field is safe; renaming or removing one breaks every client that relied on it. So breaking changes ship as a
        new <strong>version</strong> next to the old one. Version 2 of a task here replaces <code>done: true</code> with{" "}
        <code>status: &quot;done&quot;</code> and adds a <code>self</code> link. Clients choose it either in the{" "}
        <strong>URL</strong> (<code>/api/v2/tasks</code>: obvious and easy to cache) or with a <strong>header</strong>{" "}
        (<code>API-Version: 2</code> on the same URL: cleaner URLs, but caches must be told with <code>Vary</code>). When an old
        version is on its way out, its responses say so: <code>Deprecation</code> (RFC 9745), <code>Sunset</code> (RFC 8594) and
        a <code>Link</code> to its successor.
      </p>}
      whenToUse={[
        "Before any change that renames, removes or retypes a field",
        "Public APIs whose clients you can't update yourself",
        "Mobile apps, where old versions stay installed for years",
      ]}
    >
      <Demo title="One task, two versions">
        <Explorer
          presets={[
            { label: "Create", method: "POST", path: "/api/tasks", body: '{ "title": "Versioned task" }', note: "A task to look at in both shapes." },
            { label: "Version 1", method: "GET", path: "/api/tasks/{id}", note: "The default: done is a boolean. The API-Version response header says which version answered." },
            { label: "Version 2 by header", method: "GET", path: "/api/tasks/{id}", headers: { "API-Version": "2" }, note: "Same URL, different shape. Vary: API-Version tells caches the header matters." },
            { label: "Version 2 by URL", method: "GET", path: "/api/v2/tasks/{id}", note: "The version in the path instead." },
            { label: "Unknown version", method: "GET", path: "/api/tasks/{id}", headers: { "API-Version": "9" }, note: "A version that doesn't exist is a 400 Problem, not a silent fallback." },
            { label: "Deprecated v0", method: "GET", path: "/api/v0/tasks", note: "Still answers, but announces when it was deprecated, when it stops working, and where to go instead." },
          ]}
        />
      </Demo>

      <p className="text-sm text-muted">
        Version 0 never existed before this page: it&apos;s kept as a demonstration of what a retiring version&apos;s responses
        look like. Its sunset date is fictional, and it will keep working.
      </p>

      <CodePeek file="api/routes/tasks.ts" />
    </FeaturePage>
  );
}
