import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Content Security Policy: everything loads from this site. Prerendered pages
// carry Next.js's inline scripts, so script-src allows 'unsafe-inline' (see
// the Vercel lab's Security page for the nonce version). API responses get a
// stricter policy of their own below.
const policy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // The Portability page also asks the Cloudflare Workers copy of the API.
  "connect-src 'self' https://api-cf.djmiskey.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Cache Components: pages are static shells; the API runs per request.
  cacheComponents: true,
  poweredByHeader: false,
  // The shared look (@djmiskey/lab-tokens) ships TypeScript source.
  transpilePackages: ["@djmiskey/lab-tokens"],
  // PGlite (local and test database) ships WebAssembly and data files that
  // must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders, { key: "Content-Security-Policy", value: policy }] },
      // JSON never needs to load anything: the strictest policy there is.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }] },
    ];
  },
};

export default nextConfig;
