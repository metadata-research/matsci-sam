import { markGraphsDirty } from "@/lib/graph/projector";
import { getSession } from "@/lib/session";
import { initTRPC } from "@trpc/server";
import { cache } from "react";

export const createTRPCContext = cache(async () => {
  const session = await getSession();
  return { session };
});
// Avoid exporting the entire t-object
// since it's not very descriptive.
// For instance, the use of a t variable
// is common in i18n libraries.
const t = initTRPC.context<typeof createTRPCContext>().create({
  /**
   * @see https://trpc.io/docs/server/data-transformers
   */
  // transformer: superjson,
});

// Base router and procedure helpers
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const baseProcedure = t.procedure.use(async (opts) => {
  const result = await opts.next({
    ctx: {
      userId: opts.ctx.session.id,
    },
  });
  // Every successful mutation may have changed what the graphs state. The
  // mark is a flag; the projection runs later and cannot fail this call.
  if (opts.type === "mutation" && result.ok) markGraphsDirty();
  return result;
});
