import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { features } from "@/lib/features";
import { SITE_URL } from "@/lib/site";

describe("feature registry", () => {
  it("has unique slugs", () => {
    const slugs = features.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has a page for every ready feature, and none for roadmap ones", () => {
    for (const f of features) {
      expect(existsSync(path.join(__dirname, "..", "src", "app", f.slug, "page.tsx")), f.slug).toBe(f.ready);
    }
  });
});

describe("robots.txt and sitemap.xml", () => {
  it("keeps crawlers out of the API and lists every ready page on the custom domain", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.disallow).toEqual(["/api/"]);
    const urls = sitemap().map((e) => e.url);
    expect(urls).toHaveLength(1 + features.filter((f) => f.ready).length);
    expect(urls.every((u) => u.startsWith(SITE_URL))).toBe(true);
  });
});
