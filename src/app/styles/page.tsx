import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Demo, FeaturePage, panel } from "@/components/FeaturePage";
import { Compare } from "./Compare";

export const metadata: Metadata = { title: "REST vs tRPC vs GraphQL" };

const ROWS: [string, string, string, string][] = [
  ["Contract", "URLs, methods and status codes, described by OpenAPI", "The router's TypeScript type, shared with the client", "A typed schema, queried by the client"],
  ["Who decides the response's shape", "The server, per endpoint", "The server, per procedure", "The client, per query"],
  ["Several things at once", "One request each (or a purpose-built endpoint)", "Batched into one HTTP request", "One query, any mix of fields"],
  ["Errors", "HTTP status + Problem Details", "HTTP status + tRPC's error envelope", "400 if it can't run; else 200 with an errors list beside the data"],
  ["HTTP caching", "Built in: GET, ETags, CDNs", "GET queries, but long URLs", "Mostly POST: needs persisted queries or client caches"],
  ["Clients", "Anything that speaks HTTP", "TypeScript (others can, without the types)", "Anything, best with a GraphQL client"],
  ["Watch out for", "Many round trips; over-fetching", "Ties the client to the server's code", "Expensive queries: limit depth and cost"],
];

export default function StylesPage() {
  return (
    <FeaturePage
      title="REST vs tRPC vs GraphQL"
      tagline="The same data through three API styles."
      docs="https://graphql.org/learn/"
      whatItIs={<p>
        All three run on this same API, over the same database. <strong>REST</strong> (every other page in this lab) names
        resources with URLs and lets HTTP do the rest: methods, status codes, caching. <strong>tRPC</strong> drops the URL
        design: the server exports TypeScript functions, and the client calls them with full type checking, because it imports
        the router&apos;s type; calls made together are batched into one request. <strong>GraphQL</strong> publishes a typed
        schema, and each client writes a query for exactly the fields it needs, across any number of types, answered in one
        round trip. None of them is best: they trade simplicity, type safety and flexibility differently.
      </p>}
      whenToUse={[
        "REST: public APIs, anything cacheable, clients in any language",
        "tRPC: a TypeScript front end and back end in one codebase",
        "GraphQL: many clients needing different slices of rich, connected data",
      ]}
    >
      <Demo title="1. Ask the same question three ways">
        <Compare />
        <p className="text-sm text-muted">
          GraphQL&apos;s answers are smaller because the query names only the fields it shows. For the dashboard, REST takes three
          requests, tRPC batches its three calls into one, and GraphQL asks for everything in one query. The mistake shows three
          error styles: REST&apos;s 422 Problem, tRPC&apos;s 400 with its own error envelope, and GraphQL&apos;s 400 from
          validating the query against the schema. (The tRPC call couldn&apos;t even be written without a cast: TypeScript knows
          &quot;pong&quot; isn&apos;t a game.)
        </p>
      </Demo>

      <section className={`${panel} mb-4`}>
        <h2>2. Side by side</h2>
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-1.5 pr-3 font-semibold" scope="col"><span className="sr-only">Aspect</span></th>
                <th className="py-1.5 pr-3 font-semibold" scope="col">REST</th>
                <th className="py-1.5 pr-3 font-semibold" scope="col">tRPC</th>
                <th className="py-1.5 font-semibold" scope="col">GraphQL</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([aspect, ...cells]) => (
                <tr key={aspect} className="border-b border-line align-top">
                  <th className="py-1.5 pr-3 text-left font-semibold" scope="row">{aspect}</th>
                  {cells.map((c, i) => <td key={i} className="py-1.5 pr-3">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-sm text-muted">
        Endpoints: tRPC at <code>/api/trpc/&lt;procedure&gt;</code> (queries as GET, mutations as POST), GraphQL at{" "}
        <code>POST /api/graphql</code> (try <code>{"{ __schema { types { name } } }"}</code>: the schema describes itself).
        Both reuse the REST endpoints&apos; database code and rate limits. The GraphQL handler is written out by hand around
        the reference <code>graphql</code> package, with a length and nesting limit checked before anything runs.
      </p>

      <CodePeek file="api/trpc.ts" />
      <CodePeek file="api/graphql.ts" />
      <CodePeek file="api/routes/graphql.ts" />
      <CodePeek file="app/styles/Compare.tsx" />
    </FeaturePage>
  );
}
