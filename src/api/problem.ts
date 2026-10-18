import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Errors as RFC 9457 "Problem Details": one predictable JSON shape for every
// failure, with its own media type, so clients can handle errors generically.
export const Problem = z
  .object({
    type: z.string().openapi({ example: "https://api.djmiskey.com/problems/validation" }),
    title: z.string().openapi({ example: "Your request isn't valid" }),
    status: z.number().int().openapi({ example: 422 }),
    detail: z.string().optional(),
    instance: z.string().optional().openapi({ example: "/api/tasks" }),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .openapi("Problem");

export type Problem = z.infer<typeof Problem>;

const TITLES: Record<string, string> = {
  "bad-request": "The request couldn't be read",
  validation: "Your request isn't valid",
  "not-found": "Not found",
  "method-not-allowed": "Method not allowed",
  "precondition-failed": "The resource changed since you last read it",
  "unsupported-version": "That API version doesn't exist",
  unauthorized: "Authentication required",
  forbidden: "Not allowed with these credentials",
  "rate-limited": "Too many requests",
  unavailable: "Not available right now",
  internal: "Something went wrong on our side",
};

export function problem<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  kind: keyof typeof TITLES,
  extra: Pick<Problem, "detail" | "errors"> = {},
) {
  const body: Problem = {
    type: `https://api.djmiskey.com/problems/${kind}`,
    title: TITLES[kind],
    status,
    instance: new URL(c.req.url).pathname,
    ...extra,
  };
  // c.json keeps the response typed for the OpenAPI routes; the explicit
  // content-type replaces its default application/json.
  return c.json(body, status, { "content-type": "application/problem+json" });
}
