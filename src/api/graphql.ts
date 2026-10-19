import {
  type DocumentNode, getOperationAST, GraphQLBoolean, GraphQLEnumType, GraphQLError, GraphQLID, GraphQLInt, GraphQLList,
  GraphQLNonNull, type GraphQLNullableType, GraphQLObjectType, GraphQLSchema, GraphQLString, Kind, type SelectionSetNode,
} from "graphql";
import { board, GAMES, type Game } from "./routes/scores";
import { createTask, findTask, newestTasks, toTask } from "./routes/tasks";

// The same data as the REST endpoints, as one GraphQL schema. The client
// writes a query naming exactly the fields it wants, across as many types as
// it likes, and gets one JSON response of the same shape: no over-fetching,
// and one round trip instead of several. The cost moves to the server, which
// has to guard against queries that ask for too much (see maxDepth).

const nonNull = <T extends GraphQLNullableType>(type: T) => new GraphQLNonNull(type);
const list = <T extends GraphQLNullableType>(type: T) => nonNull(new GraphQLList(nonNull(type)));

const Task = new GraphQLObjectType({
  name: "Task",
  fields: {
    id: { type: nonNull(GraphQLID) },
    title: { type: nonNull(GraphQLString) },
    done: { type: nonNull(GraphQLBoolean) },
    createdAt: { type: nonNull(GraphQLString), description: "ISO 8601" },
    updatedAt: { type: nonNull(GraphQLString) },
  },
});

const GameEnum = new GraphQLEnumType({
  name: "Game",
  values: Object.fromEntries(Object.entries(GAMES).map(([id, g]) => [id, { value: id, description: g.name }])),
});

const ScoreEntry = new GraphQLObjectType({
  name: "ScoreEntry",
  fields: {
    rank: { type: nonNull(GraphQLInt) },
    id: { type: nonNull(GraphQLID) },
    initials: { type: nonNull(GraphQLString) },
    value: { type: nonNull(GraphQLInt), description: "Points, or milliseconds for Marble Maze" },
    createdAt: { type: nonNull(GraphQLString) },
  },
});

const Leaderboard = new GraphQLObjectType({
  name: "Leaderboard",
  fields: {
    game: { type: nonNull(GameEnum) },
    name: { type: nonNull(GraphQLString) },
    unit: { type: nonNull(GraphQLString) },
    better: { type: nonNull(GraphQLString), description: "higher or lower" },
    entries: { type: list(ScoreEntry) },
  },
});

const limitArg = (fallback: number) => ({ type: GraphQLInt, defaultValue: fallback, description: "1–50" });
const checkLimit = (limit: number) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new GraphQLError("limit must be between 1 and 50", { extensions: { code: "BAD_USER_INPUT" } });
  return limit;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: {
      tasks: {
        type: list(Task), description: "The newest tasks", args: { limit: limitArg(5) },
        resolve: async (_, { limit }) => (await newestTasks(checkLimit(limit))).map(toTask),
      },
      task: {
        type: Task, description: "One task, or null", args: { id: { type: nonNull(GraphQLID) } },
        resolve: async (_, { id }) => {
          if (!UUID.test(id)) throw new GraphQLError("id must be a UUID", { extensions: { code: "BAD_USER_INPUT" } });
          const row = await findTask(id);
          return row ? toTask(row) : null;
        },
      },
      leaderboard: {
        type: nonNull(Leaderboard), args: { game: { type: nonNull(GameEnum) }, limit: limitArg(10) },
        resolve: (_, { game, limit }) => board(game as Game, checkLimit(limit)),
      },
    },
  }),
  mutation: new GraphQLObjectType({
    name: "Mutation",
    fields: {
      createTask: {
        type: nonNull(Task), args: { title: { type: nonNull(GraphQLString) } },
        resolve: async (_, { title }) => {
          const trimmed = String(title).trim();
          if (trimmed.length < 1 || trimmed.length > 200) throw new GraphQLError("title must be 1–200 characters", { extensions: { code: "BAD_USER_INPUT" } });
          return toTask(await createTask({ title: trimmed }));
        },
      },
    },
  }),
});

/**
 * How deeply the operation nests, following fragments. This schema is
 * shallow, but a graph with cycles (a user's friends' friends' friends…) lets
 * one small query ask for an enormous amount of work, so GraphQL servers cap
 * depth (and often a cost score) before executing anything.
 */
export function maxDepth(document: DocumentNode, operationName?: string | null) {
  const fragments = new Map(document.definitions.flatMap((d) => (d.kind === Kind.FRAGMENT_DEFINITION ? [[d.name.value, d] as const] : [])));
  const depth = (set: SelectionSetNode | undefined, seen: Set<string>): number => {
    if (!set) return 0;
    let deepest = 0;
    for (const s of set.selections) {
      // Introspection (__schema, __type…) is bounded by the schema itself, and
      // tools' standard introspection query nests deeply, so it isn't counted.
      if (s.kind === Kind.FIELD) { if (!s.name.value.startsWith("__")) deepest = Math.max(deepest, 1 + depth(s.selectionSet, seen)); }
      else if (s.kind === Kind.INLINE_FRAGMENT) deepest = Math.max(deepest, depth(s.selectionSet, seen));
      else if (!seen.has(s.name.value)) deepest = Math.max(deepest, depth(fragments.get(s.name.value)?.selectionSet, new Set([...seen, s.name.value])));
    }
    return deepest;
  };
  return depth(getOperationAST(document, operationName)?.selectionSet, new Set());
}
