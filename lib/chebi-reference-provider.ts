import { createHash } from "node:crypto"
import { z } from "zod"
import { readReferenceBody } from "./reference-http"

export const normalizeReferenceTerm = (term: string) =>
  term.trim().toLowerCase()
export const REFERENCE_RESULT_LIMIT = 5
const MAX_RESPONSE_BYTES = 128 * 1024

const entrySchema = z.object({
  term: z.string().trim().min(1).max(500),
  definition: z.string().trim().min(1).max(16000),
  source: z.string().trim().min(1).max(500),
  sourceIri: z
    .string()
    .regex(/^http:\/\/purl\.obolibrary\.org\/obo\/CHEBI_[0-9]+$/),
  sourceKey: z.literal("chebi"),
  version: z.string().trim().min(1).max(100),
  license: z.literal("CC-BY-4.0")
})
export type ChebiReference = z.infer<typeof entrySchema> & {
  contentHash: string
}

/** The only network destination is operator configuration, never user input. */
export async function retrieveChebiDefinitions(
  term: string,
  config = process.env.MATSCI_ONT_URL,
  fetcher: typeof fetch = fetch
): Promise<ChebiReference[]> {
  if (!config)
    throw new Error(
      "ChEBI lookup is not configured. You can continue writing your definition."
    )
  const base = new URL(config)
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("ChEBI lookup is not configured correctly.")
  const url = new URL("grounding", base.href.replace(/\/?$/, "/"))
  url.searchParams.set("q", term.trim())
  url.searchParams.set("sources", "chebi")
  url.searchParams.set("limit", String(REFERENCE_RESULT_LIMIT))
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" }
    })
    if (!response.ok || !response.body) throw new Error("Unavailable")
    const raw = await readReferenceBody(response, MAX_RESPONSE_BYTES)
    const body = z
      .object({
        query: z.string(),
        results: z.array(z.unknown()).max(REFERENCE_RESULT_LIMIT)
      })
      .parse(JSON.parse(raw))
    if (normalizeReferenceTerm(body.query) !== normalizeReferenceTerm(term))
      throw new Error("Wrong query")
    const seen = new Set<string>()
    return body.results.flatMap((result) => {
      // Imported non-ChEBI classes and entries without definitions are not candidates.
      const parsed = entrySchema.safeParse(result)
      if (!parsed.success || seen.has(parsed.data.sourceIri)) return []
      seen.add(parsed.data.sourceIri)
      return [
        {
          ...parsed.data,
          contentHash: createHash("sha256")
            .update(JSON.stringify(parsed.data))
            .digest("hex")
        }
      ]
    })
  } catch {
    // Do not expose configured endpoints, credentials, or upstream bodies.
    throw new Error(
      "ChEBI is unavailable or took too long to respond. Try again, or continue writing."
    )
  }
}

// A bounded per-process guard. No open transaction while waiting on ONT.
const requests = new Map<
  string,
  { at: number; count: number; pending: boolean }
>()
export function beginReferenceLookup(
  userId: number,
  now = Date.now(),
  provider = "chebi"
) {
  const key = `${provider}:${userId}`
  for (const [id, state] of requests)
    if (!state.pending && now - state.at >= 60_000) requests.delete(id)
  const state = requests.get(key)
  if (state?.pending || (state && state.count >= 5) || requests.size >= 100)
    throw new Error("Please wait before retrieving another reference lookup.")
  const current = state ?? { at: now, count: 0, pending: false }
  current.count += 1
  current.pending = true
  requests.set(key, current)
  return () => {
    current.pending = false
  }
}
