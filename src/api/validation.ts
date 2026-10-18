import type { Hook } from "@hono/zod-openapi";
import { problem } from "./problem";

// Called by every route when its params, query or body fail their Zod schema:
// answer 422 with one entry per problem, pointing at the field ("title",
// "query.done") so a form can show the message next to the right input.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validationHook: Hook<any, any, any, any> = (result, c) => {
  if (result.success) return;
  const errors = result.error.issues.map((i) => ({
    path: [result.target === "json" ? null : result.target, ...i.path].filter((p) => p !== null).join(".") || result.target,
    message: i.message,
  }));
  return problem(c, 422, "validation", { detail: `${errors.length} field${errors.length === 1 ? "" : "s"} need${errors.length === 1 ? "s" : ""} fixing.`, errors });
};
