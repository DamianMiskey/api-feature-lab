// Single source of truth for the dashboard: every technique in the lab,
// grouped by category. `ready: false` marks a page on the roadmap; it shows
// on the home page but has no route yet.
export type Category = "Foundations" | "HTTP semantics" | "Auth" | "Reliability" | "API styles" | "Platform";

export type Feature = {
  slug: string;
  name: string;
  category: Category;
  summary: string;
  phase: number;
  ready: boolean;
};

export const features: Feature[] = [
  { slug: "rest", name: "REST basics", category: "Foundations", phase: 1, ready: true,
    summary: "Resources, methods and status codes, on a live tasks API." },
  { slug: "errors", name: "Validation & errors", category: "Foundations", phase: 1, ready: true,
    summary: "Zod schemas and RFC 9457 Problem Details for every failure." },
  { slug: "openapi", name: "OpenAPI docs", category: "Foundations", phase: 1, ready: true,
    summary: "A spec generated from the code, rendered as documentation." },

  { slug: "pagination", name: "Pagination", category: "HTTP semantics", phase: 2, ready: true,
    summary: "Cursor pagination that stays correct while data changes." },
  { slug: "caching", name: "ETags & caching", category: "HTTP semantics", phase: 2, ready: true,
    summary: "304 Not Modified, conditional updates and Cache-Control." },
  { slug: "versioning", name: "Versioning", category: "HTTP semantics", phase: 2, ready: true,
    summary: "Evolving an API without breaking its clients." },

  { slug: "api-keys", name: "API keys & JWT", category: "Auth", phase: 3, ready: true,
    summary: "Hashed keys, signed tokens and scopes." },
  { slug: "rate-limits", name: "Rate limiting", category: "Auth", phase: 3, ready: true,
    summary: "429s with Retry-After and RateLimit headers." },

  { slug: "idempotency", name: "Idempotency keys", category: "Reliability", phase: 4, ready: false,
    summary: "Retry a POST safely: the second one changes nothing." },
  { slug: "webhooks", name: "Webhooks", category: "Reliability", phase: 4, ready: false,
    summary: "Signed deliveries with retries and verification." },
  { slug: "streaming", name: "Streaming (SSE)", category: "Reliability", phase: 4, ready: false,
    summary: "Server-Sent Events for live progress." },

  { slug: "styles", name: "REST vs tRPC vs GraphQL", category: "API styles", phase: 5, ready: false,
    summary: "The same data through three API styles." },

  { slug: "portability", name: "One API, two platforms", category: "Platform", phase: 6, ready: false,
    summary: "The same Hono app on Vercel and Cloudflare Workers." },
];

export const categories = [...new Set(features.map((f) => f.category))];
export const getFeature = (slug: string) => features.find((f) => f.slug === slug);
