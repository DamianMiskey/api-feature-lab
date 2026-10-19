import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Auth } from "./auth";
import { board, GAMES, type Game } from "./routes/scores";
import { createTask, findTask, newestTasks, toTask } from "./routes/tasks";

// The same data as the REST endpoints, as tRPC procedures. There's no URL
// design and no schema file: a procedure is a function with a Zod input, and
// the client imports this router's *type* (AppRouter), so calling it from
// TypeScript is type-checked end to end. Rename a field here and the page
// that calls it stops compiling.
//
// Over the wire it's still HTTP: queries are GETs to /api/trpc/<path>?input=…,
// mutations are POSTs, and the client can batch several calls into one request.

const t = initTRPC.context<{ auth?: Auth }>().create();

const gameIds = Object.keys(GAMES) as [Game, ...Game[]];

export const appRouter = t.router({
  tasks: t.router({
    newest: t.procedure
      .input(z.object({ limit: z.number().int().min(1).max(50).default(5) }))
      .query(async ({ input }) => (await newestTasks(input.limit)).map(toTask)),
    byId: t.procedure
      .input(z.object({ id: z.uuid() }))
      .query(async ({ input }) => {
        const row = await findTask(input.id);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `There's no task ${input.id}.` });
        return toTask(row);
      }),
    create: t.procedure
      .input(z.strictObject({ title: z.string().trim().min(1, "Give the task a title").max(200) }))
      .mutation(async ({ input }) => toTask(await createTask(input))),
  }),
  scores: t.router({
    top: t.procedure
      .input(z.object({ game: z.enum(gameIds), limit: z.number().int().min(1).max(50).default(10) }))
      .query(({ input }) => board(input.game, input.limit)),
  }),
});

export type AppRouter = typeof appRouter;
