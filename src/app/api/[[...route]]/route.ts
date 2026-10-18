import { handle } from "hono/vercel";
import { app } from "@/api/app";

// Next.js hands every /api/* request to the Hono app. One handler per HTTP
// method; Hono does the routing from there.
const handler = handle(app);
export { handler as DELETE, handler as GET, handler as HEAD, handler as OPTIONS, handler as PATCH, handler as POST, handler as PUT };
