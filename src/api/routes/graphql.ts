import { execute, GraphQLError, parse, specifiedRules, validate } from "graphql";
import { Hono } from "hono";
import type { AuthEnv } from "../auth";
import { maxDepth, schema } from "../graphql";
import { rateLimit } from "../ratelimit";

// GraphQL over HTTP, written out by hand (the graphql package does the
// parsing, validation and execution). One endpoint, POST, JSON in and out.
// Status codes follow the GraphQL-over-HTTP spec with its own media type:
// a request that can't run at all (bad JSON, a syntax error, an unknown
// field) is a 400; once execution starts the answer is 200, and anything
// that went wrong is listed in "errors" next to whatever "data" succeeded.

const MAX_QUERY_LENGTH = 4000;
const MAX_DEPTH = 5;
const MEDIA_TYPE = "application/graphql-response+json; charset=utf-8";

export const graphqlApi = new Hono<AuthEnv>();

const respond = (status: 200 | 400 | 405, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": MEDIA_TYPE } });
const fail = (status: 400 | 405, message: string) => respond(status, { errors: [{ message }] });

graphqlApi.all("/graphql", rateLimit({ name: "graphql", windowSec: 60, limit: (c) => (c.get("auth") ? 240 : Number(process.env.LAB_WRITE_LIMIT ?? 60)) }), async (c) => {
  if (c.req.method !== "POST") {
    const res = fail(405, "Send queries with POST and a JSON body: { \"query\": \"…\", \"variables\": {…} }");
    res.headers.set("allow", "POST");
    return res;
  }
  let body: { query?: unknown; variables?: unknown; operationName?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return fail(400, "The body isn't JSON.");
  }
  if (typeof body.query !== "string" || !body.query.trim()) return fail(400, "Send a \"query\" string.");
  if (body.query.length > MAX_QUERY_LENGTH) return fail(400, `Queries are limited to ${MAX_QUERY_LENGTH} characters.`);
  const variables = body.variables ?? undefined;
  if (variables !== undefined && variables !== null && (typeof variables !== "object" || Array.isArray(variables))) return fail(400, "\"variables\" must be an object.");
  const operationName = typeof body.operationName === "string" ? body.operationName : undefined;

  let document;
  try {
    document = parse(body.query);
  } catch (e) {
    return respond(400, { errors: [(e as GraphQLError).toJSON()] });
  }
  const errors = validate(schema, document, specifiedRules);
  if (errors.length) return respond(400, { errors: errors.map((e) => e.toJSON()) });
  const depth = maxDepth(document, operationName);
  if (depth > MAX_DEPTH) return fail(400, `This query nests ${depth} levels deep; the limit is ${MAX_DEPTH}.`);

  const result = await execute({ schema, document, variableValues: variables as Record<string, unknown> | undefined, operationName, contextValue: { auth: c.get("auth") } });
  return respond(200, JSON.parse(JSON.stringify(result)));
});
