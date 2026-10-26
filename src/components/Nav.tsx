"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeSwitch } from "@djmiskey/lab-tokens/ThemeSwitch";
import { categories, features } from "@/lib/features";
import { cx } from "./ui";

// The sidebar is a Client Component so it can highlight the current page
// (usePathname). On narrow screens it becomes a wrapping row of links above
// the content. Pages on the roadmap are listed on the home page only.
export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line bg-surface px-3 py-4 md:sticky md:top-0 md:block md:h-screen md:overflow-y-auto md:border-r md:border-b-0">
      <Link href="/" className="flex w-full items-center gap-2 px-2 pb-1 font-bold text-fg no-underline md:pb-4">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4 3 12l5 8M16 4l5 8-5 8M14 4l-4 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span>API Lab</span>
      </Link>
      {categories.map((cat) => {
        const ready = features.filter((f) => f.category === cat && f.ready);
        if (!ready.length) return null;
        return (
          <div key={cat} className="contents md:block">
            <div className="hidden px-2 pt-3 pb-1 text-xs tracking-wider text-muted uppercase md:block">{cat}</div>
            {ready.map((f) => (
              <Link
                key={f.slug}
                href={`/${f.slug}`}
                aria-current={path === `/${f.slug}` ? "page" : undefined}
                className={cx(
                  "block rounded-md border border-line px-2 py-1 text-sm no-underline md:border-0 md:text-[15px]",
                  path === `/${f.slug}` ? "bg-accent text-white" : "text-fg hover:bg-code",
                )}
              >
                {f.name}
              </Link>
            ))}
          </div>
        );
      })}
      <div className="mt-4 w-full border-t border-line px-2 pt-3"><ThemeSwitch /></div>
      <a href="/api/openapi.json" className="mt-2 block w-full px-2 text-sm">openapi.json ↗</a>
    </nav>
  );
}
