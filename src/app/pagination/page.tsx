import type { Metadata } from "next";
import { CodePeek } from "@/components/CodePeek";
import { Explorer } from "@/components/Explorer";
import { Demo, FeaturePage } from "@/components/FeaturePage";
import { OffsetVsCursor } from "./OffsetVsCursor";

export const metadata: Metadata = { title: "Pagination" };

export default function PaginationPage() {
  return (
    <FeaturePage
      title="Pagination"
      tagline="Hand out a long list in pages that stay correct while the data changes."
      docs="https://www.rfc-editor.org/rfc/rfc8288.html"
      whatItIs={<p>
        <strong>Offset</strong> pagination (<code>?offset=40&amp;limit=20</code>) is easy, but counts rows from the top: if
        someone adds or deletes a row while you page, you skip or repeat items, and deep pages get slow because the database
        still walks past every skipped row. <strong>Cursor</strong> (keyset) pagination asks for &quot;the next 20 after this
        one&quot;: each page returns an opaque <code>nextCursor</code> that encodes the last row&apos;s sort key (here{" "}
        <code>created_at</code> plus <code>id</code> as a tie-breaker), and the query uses the index to jump straight there. The
        same next-page URL is also sent in an RFC 8288 <code>Link</code> header, so generic clients can follow it.
      </p>}
      whenToUse={[
        "Feeds, timelines and logs where new items keep arriving",
        "Large tables, where OFFSET gets slower the deeper you go",
        "Offset still fits small, stable lists that need \"jump to page 7\"",
      ]}
    >
      <Demo title="1. Offset vs cursor, with an insert in between">
        <OffsetVsCursor />
      </Demo>

      <Demo title="2. Page through by hand">
        <Explorer
          presets={[
            { label: "First page", method: "GET", path: "/api/tasks?limit=3", note: "Note nextCursor in the body and the Link header." },
            { label: "Next page", method: "GET", path: "/api/tasks?limit=3&cursor={cursor}", note: "Sends back the cursor from the previous response. nextCursor is null on the last page." },
            { label: "Open tasks only", method: "GET", path: "/api/tasks?limit=3&done=false", note: "Filters combine with paging; the Link header keeps the filter." },
            { label: "Forged cursor", method: "GET", path: "/api/tasks?cursor=hello", note: "Cursors are opaque: one the API didn't issue is a 422." },
            { label: "Page too big", method: "GET", path: "/api/tasks?limit=500", note: "The page size is capped at 50." },
          ]}
        />
      </Demo>

      <CodePeek file="api/routes/tasks.ts" />
      <CodePeek file="api/http.ts" />
    </FeaturePage>
  );
}
