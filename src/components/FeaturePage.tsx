import type { ReactNode } from "react";

// The boxed look shared by explanation panels and demos.
export const panel = "rounded-xl border border-line bg-surface px-5 py-4";

// Standard frame for every feature page: what it is, when to use it, then the live demo.
export function FeaturePage({
  title,
  tagline,
  whatItIs,
  whenToUse,
  docs,
  children,
}: {
  title: string;
  tagline: string;
  whatItIs: ReactNode;
  whenToUse: string[];
  docs: string;
  children: ReactNode;
}) {
  return (
    <article>
      <header className="mb-6">
        <h1>{title}</h1>
        <p className="m-0 text-[1.05rem] text-muted">{tagline}</p>
      </header>
      <div className="mb-6 grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <section className={panel}>
          <h2>What it is</h2>
          <div className="[&_p]:m-0">{whatItIs}</div>
        </section>
        <section className={panel}>
          <h2>When to use it</h2>
          <ul className="mb-2">{whenToUse.map((w) => <li key={w}>{w}</li>)}</ul>
          <a className="text-sm" href={docs} target="_blank" rel="noreferrer">Official docs ↗</a>
        </section>
      </div>
      {children}
    </article>
  );
}

// A boxed live demo with a title.
export function Demo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${panel} mb-4`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
