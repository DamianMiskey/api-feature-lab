import type { ExecutionContext } from "hono";
import { app } from "../src/api/app";

// The same Hono app as on Vercel (src/api/app.ts), deployed as a Cloudflare
// Worker. Hono only deals in standard Request and Response objects, so the
// whole entry point is this one function. The rest of the difference lives
// in wrangler.jsonc: environment variables, secrets, and an alias that keeps
// PGlite (the local database) out of the bundle.
const worker = {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    // Only the API runs here; the pages are on Vercel. Someone opening the
    // bare domain gets the page that explains this copy, not a 404.
    if (new URL(request.url).pathname === "/") return Response.redirect("https://api.djmiskey.com/portability", 302);
    // Rate limits key anonymous clients by x-real-ip. On Vercel its network
    // sets that header; here Cloudflare's equivalent is CF-Connecting-IP, so
    // copy it over, replacing anything the client sent itself.
    const headers = new Headers(request.headers);
    headers.set("x-real-ip", request.headers.get("cf-connecting-ip") ?? "unknown");
    headers.delete("x-forwarded-for");
    return app.fetch(new Request(request, { headers }), env, ctx);
  },
};

export default worker;
