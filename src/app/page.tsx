import Link from "next/link";
import { panel } from "@/components/FeaturePage";
import { cx } from "@/components/ui";
import { categories, features } from "@/lib/features";

export default function Home() {
  const ready = features.filter((f) => f.ready).length;
  return (
    <article>
      <header className="mb-6">
        <h1>API Feature Lab</h1>
        <p className="m-0 text-[1.05rem] text-muted">
          Backend API design, one technique per page. Every page calls a real endpoint of this site&apos;s own API, shows the
          raw request and response, and the code behind it. A sibling of the <a href="https://vercel.djmiskey.com">Vercel</a>,{" "}
          <a href="https://lab.djmiskey.com">Cloudflare</a> and <a href="https://motion.djmiskey.com">Motion</a> labs.{" "}
          {ready} of {features.length} built so far.
        </p>
      </header>
      <section className={cx(panel, "mb-4 [&_li+li]:mt-1.5")}>
        <h2>How it&apos;s built</h2>
        <ul>
          <li><strong>Hono</strong> serves everything under <code>/api</code>: small, typed, and built on web-standard Request and Response, so it runs on any platform.</li>
          <li><strong>Zod</strong> schemas validate every request and generate the <a href="/openapi">OpenAPI document</a>, so docs and code can&apos;t drift.</li>
          <li><strong>Postgres</strong> through Drizzle: Neon in production, PGlite (Postgres in WebAssembly) locally and in tests.</li>
          <li><strong>Next.js</strong> renders these pages; the API is mounted into it with one route file.</li>
        </ul>
      </section>
      {categories.map((cat) => (
        <section key={cat} className="mt-7">
          <h2>{cat}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {features.filter((f) => f.category === cat).map((f) => {
              const body = (
                <>
                  <span className="font-semibold">{f.name}</span>
                  <span className="text-sm text-muted">{f.summary}</span>
                  <span className={cx("self-start rounded-full px-2 py-px text-xs", f.ready ? "bg-accent text-white" : "bg-code text-muted")}>{f.ready ? "Live" : `Phase ${f.phase}`}</span>
                </>
              );
              const tile = "flex flex-col gap-1 rounded-xl border border-line bg-surface px-4 py-3.5 text-fg no-underline";
              return f.ready
                ? <Link key={f.slug} href={`/${f.slug}`} className={cx(tile, "hover:border-accent")}>{body}</Link>
                : <div key={f.slug} className={tile}>{body}</div>;
            })}
          </div>
        </section>
      ))}
    </article>
  );
}
