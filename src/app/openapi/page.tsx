import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { app } from "@/api/app";
import { CodePeek } from "@/components/CodePeek";
import { Demo, FeaturePage } from "@/components/FeaturePage";
import { cx } from "@/components/ui";

export const metadata: Metadata = { title: "OpenAPI docs" };

type Schema = Record<string, unknown>;
type Operation = {
  summary?: string;
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean; description?: string; schema?: Schema }[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: Schema }> }>;
};
type Doc = { info: { title: string; version: string }; paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };

// The same document the API serves at /api/openapi.json, produced by asking
// the Hono app for it in-process at build time. Rendered here as plain HTML:
// no third-party docs script for the CSP to allow.
async function spec(): Promise<Doc> {
  "use cache";
  cacheLife("max");
  return (await app.request("/api/openapi.json")).json();
}

const METHOD_BG: Record<string, string> = { get: "bg-get", post: "bg-post", patch: "bg-patch", delete: "bg-delete" };
const ref = (s?: Schema) => (s && typeof s.$ref === "string" ? s.$ref.split("/").pop() : undefined);
const describe = (s?: Schema) => ref(s) ?? (s?.type === "object" ? "object" : String(s?.type ?? ""));

export default async function OpenApiPage() {
  const doc = await spec();
  const operations = Object.entries(doc.paths).flatMap(([path, ops]) => Object.entries(ops).map(([method, op]) => ({ path, method, op })));
  return (
    <FeaturePage
      title="OpenAPI docs"
      tagline="One description of the API, generated from the code that runs it."
      docs="https://spec.openapis.org/oas/v3.1.0"
      whatItIs={<p>
        <strong>OpenAPI</strong> is a standard, machine-readable description of an HTTP API: its paths, methods, parameters,
        bodies and responses. Here it isn&apos;t written by hand: <code>@hono/zod-openapi</code> builds it from the same Zod
        schemas and route definitions that validate requests, so a field can&apos;t be added to the code and forgotten in the
        docs. The document is served at <a href="/api/openapi.json"><code>/api/openapi.json</code></a>; tools can generate typed
        clients, mock servers and tests from it, and this page renders it as reference docs.
      </p>}
      whenToUse={[
        "Any API with consumers outside your own codebase",
        "Generating typed clients (openapi-typescript, Orval) instead of hand-writing them",
        "Contract tests and mock servers from one source of truth",
      ]}
    >
      <Demo title={`${doc.info.title} ${doc.info.version}`}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {operations.map(({ path, method, op }) => (
            <details key={`${method} ${path}`} className="rounded-lg border border-line bg-bg">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                <span className={cx("rounded px-1.5 py-0.5 font-mono text-xs font-bold text-white uppercase", METHOD_BG[method])}>{method}</span>
                <code className="bg-transparent px-0">{path}</code>
                <span className="text-sm text-muted">{op.summary}</span>
              </summary>
              <div className="grid gap-2 border-t border-line px-3 py-2 text-sm">
                {op.parameters?.length ? (
                  <div><strong>Parameters</strong>
                    <ul>{op.parameters.map((p) => <li key={p.name}><code>{p.name}</code> ({p.in}{p.required ? ", required" : ""}): {describe(p.schema)}{p.description ? `. ${p.description}` : ""}</li>)}</ul>
                  </div>
                ) : null}
                {op.requestBody && (
                  <div><strong>Body</strong>: {Object.entries(op.requestBody.content).map(([type, c]) => <span key={type}><code>{describe(c.schema)}</code> as <code>{type}</code></span>)}</div>
                )}
                <div><strong>Responses</strong>
                  <ul>{Object.entries(op.responses).map(([code, r]) => (
                    <li key={code}><code>{code}</code> {r.description}{r.content ? Object.entries(r.content).map(([type, c]) => <span key={type}>: <code>{describe(c.schema)}</code> as <code>{type}</code></span>) : null}</li>
                  ))}</ul>
                </div>
              </div>
            </details>
          ))}
        </div>
        <h3>Schemas</h3>
        {/* minmax(0,1fr): wide JSON scrolls inside its box instead of widening the page. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {Object.entries(doc.components.schemas).map(([name, schema]) => (
            <details key={name} className="rounded-lg border border-line bg-bg">
              <summary className="cursor-pointer px-3 py-2 font-mono text-sm">{name}</summary>
              <pre className="m-0 max-h-80 overflow-auto border-t border-line px-3 py-2 font-mono text-xs" tabIndex={0}>{JSON.stringify(schema, null, 2)}</pre>
            </details>
          ))}
        </div>
      </Demo>

      <CodePeek file="api/app.ts" />
      <CodePeek file="api/routes/tasks.ts" />
    </FeaturePage>
  );
}
