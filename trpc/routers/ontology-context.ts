import { TRPCError } from "@trpc/server"
import {
  fetchOntologyCandidates,
  fetchOntologyHierarchy,
  OntologyContextError,
  ontologyCandidatesInput,
  ontologyHierarchyInput
} from "@/lib/ontology-context"
import { baseProcedure, createTRPCRouter } from "../init"

async function preview<T>(lookup: () => Promise<T>): Promise<T> {
  try {
    return await lookup()
  } catch (error) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message:
        error instanceof OntologyContextError
          ? error.message
          : "Ontology context could not be retrieved. Try again."
    })
  }
}

// Public read-only context. No receipt, mapping, citation or model request is
// created by either query, and no browser-provided URL is used as an endpoint.
export const ontologyContextRouter = createTRPCRouter({
  candidates: baseProcedure
    .meta({ marksGraphs: false })
    .input(ontologyCandidatesInput)
    .query(({ input }) =>
      preview(() => fetchOntologyCandidates(input.term, { mode: input.mode }))
    ),
  hierarchy: baseProcedure
    .meta({ marksGraphs: false })
    .input(ontologyHierarchyInput)
    .query(({ input }) => preview(() => fetchOntologyHierarchy(input)))
})
