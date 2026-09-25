import "server-only"
import { z } from "zod"
import { TERM_MAX_LENGTH } from "./input-limits"
import { readReferenceBody } from "./reference-http"

const CANDIDATES_PER_SOURCE = 5
const MAX_SOURCES = 32
const MAX_PARENTS = 50
const MAX_RESPONSE_BYTES = 128 * 1024
const REQUEST_TIMEOUT_MS = 15_000
const candidateMode = z.enum(["exact", "similar"])

const sourceKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const iri = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (/[\s<>"{}|\\^`]/u.test(value)) return false
    try {
      const url = new URL(value)
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  }, "Invalid ontology IRI")
const label = z.string().trim().min(1).max(2000)
const source = z.object({
  key: sourceKey,
  title: z.string().trim().min(1).max(500),
  version: z.string().trim().min(1).max(200).optional(),
  license: z.string().trim().min(1).max(500)
})

export const ontologyCandidatesInput = z
  .object({
    term: z.string().trim().min(1).max(TERM_MAX_LENGTH),
    mode: candidateMode.default("exact")
  })
  .strict()
export const ontologyHierarchyInput = z
  .object({ source: sourceKey, iri })
  .strict()

const candidatesResponse = z.object({
  query: z.string().trim().min(1).max(TERM_MAX_LENGTH),
  mode: candidateMode,
  sources: z
    .array(
      z.object({
        source,
        candidates: z
          .array(z.object({ iri, label, match: z.enum(["exact", "label"]) }))
          .min(1)
          .max(CANDIDATES_PER_SOURCE),
        truncated: z.boolean()
      })
    )
    .max(MAX_SOURCES)
})
const hierarchyResponse = z.object({
  source,
  entity: z.object({ iri, label }),
  parents: z
    .array(
      z.discriminatedUnion("predicate", [
        z.object({
          iri,
          label: label.optional(),
          predicate: z.literal(
            "http://www.w3.org/2000/01/rdf-schema#subClassOf"
          ),
          direction: z.literal("outgoing")
        }),
        z.object({
          iri,
          label: label.optional(),
          predicate: z.literal("http://www.w3.org/2004/02/skos/core#broader"),
          direction: z.literal("outgoing")
        }),
        z.object({
          iri,
          label: label.optional(),
          predicate: z.literal("http://www.w3.org/2004/02/skos/core#narrower"),
          direction: z.literal("incoming")
        })
      ])
    )
    .max(MAX_PARENTS),
  truncated: z.boolean(),
  hasAnonymousSuperclasses: z.boolean()
})

export type OntologyCandidates = z.infer<typeof candidatesResponse>
export type OntologyHierarchy = z.infer<typeof hierarchyResponse> & {
  browseUrl?: string
}
type TransportOptions = {
  baseUrl?: string
  publicUrl?: string
  fetcher?: typeof fetch
}

export class OntologyContextError extends Error {
  constructor(configured: boolean) {
    super(
      configured
        ? "Ontology context is unavailable or took too long to respond. Try again."
        : "Ontology lookup is not configured correctly."
    )
    this.name = "OntologyContextError"
  }
}

function configuredBase(value: string | undefined): URL {
  try {
    const url = new URL(value ?? "")
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error()
    url.pathname = url.pathname.replace(/\/?$/, "/")
    return url
  } catch {
    throw new OntologyContextError(false)
  }
}

/** Only the independently configured public base becomes a browser link. */
function browseUrl(
  publicBase: string | undefined,
  input: z.infer<typeof ontologyHierarchyInput>
) {
  if (!publicBase) return undefined
  try {
    const url = new URL("entity", configuredBase(publicBase))
    url.searchParams.set("source", input.source)
    url.searchParams.set("iri", input.iri)
    return url.href
  } catch {
    // A missing/invalid browser URL must not reveal the private service URL or
    // prevent an otherwise valid hierarchy preview.
    return undefined
  }
}

async function getJson(url: URL, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error("Unavailable")
  }
  return JSON.parse(
    await readReferenceBody(response, MAX_RESPONSE_BYTES)
  ) as unknown
}

/** Read-only discovery. Matching labels never establish a SAM mapping. */
export async function fetchOntologyCandidates(
  term: string,
  options: TransportOptions & { mode?: z.infer<typeof candidateMode> } = {}
): Promise<OntologyCandidates> {
  const input = ontologyCandidatesInput.parse({ term, mode: options.mode })
  const base = configuredBase(options.baseUrl ?? process.env.MATSCI_ONT_URL)
  const url = new URL("candidates", base)
  url.searchParams.set("q", input.term)
  url.searchParams.set("mode", input.mode)
  url.searchParams.set("limitPerSource", String(CANDIDATES_PER_SOURCE))
  try {
    const result = candidatesResponse.parse(
      await getJson(url, options.fetcher ?? fetch)
    )
    if (
      result.query.toLowerCase() !== input.term.toLowerCase() ||
      result.mode !== input.mode ||
      new Set(result.sources.map((group) => group.source.key)).size !==
        result.sources.length ||
      result.sources.some(
        (group) =>
          new Set(group.candidates.map((candidate) => candidate.iri)).size !==
            group.candidates.length ||
          group.candidates.some((candidate) => {
            const sameLabel =
              candidate.label.toLowerCase() === input.term.toLowerCase()
            return input.mode === "exact"
              ? candidate.match !== "exact" || !sameLabel
              : candidate.match !== "label" || sameLabel
          })
      )
    )
      throw new Error("Mismatched response")
    return result
  } catch {
    throw new OntologyContextError(true)
  }
}

/** Read asserted context for one selected source and publisher identifier. */
export async function fetchOntologyHierarchy(
  selection: z.infer<typeof ontologyHierarchyInput>,
  options: TransportOptions = {}
): Promise<OntologyHierarchy> {
  const input = ontologyHierarchyInput.parse(selection)
  const base = configuredBase(options.baseUrl ?? process.env.MATSCI_ONT_URL)
  const link = browseUrl(
    options.publicUrl ?? process.env.MATSCI_ONT_PUBLIC_URL,
    input
  )
  const url = new URL("hierarchy", base)
  url.searchParams.set("source", input.source)
  url.searchParams.set("iri", input.iri)
  try {
    const result = hierarchyResponse.parse(
      await getJson(url, options.fetcher ?? fetch)
    )
    if (result.source.key !== input.source || result.entity.iri !== input.iri)
      throw new Error("Mismatched response")
    return { ...result, ...(link ? { browseUrl: link } : {}) }
  } catch {
    throw new OntologyContextError(true)
  }
}
