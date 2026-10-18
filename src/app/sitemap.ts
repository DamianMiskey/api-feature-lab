import type { MetadataRoute } from "next";
import { features } from "@/lib/features";
import { SITE_URL } from "@/lib/site";

// Generated from the feature registry, so a new page appears here as soon
// as it's marked ready.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "monthly", priority: 1 },
    ...features.filter((f) => f.ready).map((f) => ({ url: `${SITE_URL}/${f.slug}`, changeFrequency: "monthly" as const, priority: 0.8 })),
  ];
}
