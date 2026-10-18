import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Every page is open to crawlers; the API itself (/api/) has nothing to index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
