import { createHash } from "node:crypto"
import { z } from "zod"
import { readReferenceBody } from "./reference-http"
import {
  buildWolframQuery,
  DEFAULT_WOLFRAM_OPTIONS,
  wolframLookupOptionsSchema,
  type WolframLookupOptions,
  type WolframLookupRequest
} from "./wolfram-query"

export const WOLFRAM_RESULTS_ENDPOINT =
  "https://services.wolfram.com/api/cag/v1/WolframAlphaResult"
const envelope = z.object({
  result: z.string().max(60000),
  code: z.number().int(),
  success: z.boolean(),
  uuid: z.string().max(100).optional()
})

/** Reopen exact request metadata; older receipts did not save their parameters. */
export function wolframRequestFromEndpoint(
  endpoint: string | null,
  term: string,
  context: string | null
): WolframLookupRequest | undefined {
  if (!endpoint) return
  try {
    const url = new URL(endpoint)
    if (
      `${url.origin}${url.pathname}` !== WOLFRAM_RESULTS_ENDPOINT ||
      url.username ||
      url.password
    )
      return
    const input = url.searchParams.get("input")
    const units = url.searchParams.get("units")
    if (!input || !units) return
    const savedContext = context ?? ""
    const parsed = wolframLookupOptionsSchema.safeParse({
      units,
      assumptions: url.searchParams.getAll("assumption")
    })
    if (
      parsed.success &&
      buildWolframQuery(term, savedContext).toLowerCase() ===
        input.toLowerCase()
    )
      return { input, context: savedContext, options: parsed.data }
  } catch {
    // An old or malformed endpoint must not invent historical query options.
  }
}

/** CAG Results, not Agent One: preserve factual context and its assumptions. */
export async function retrieveWolframResources(
  term: string,
  context = "",
  apiKey = process.env.WOLFRAM_API_KEY,
  fetcher: typeof fetch = fetch,
  options: WolframLookupOptions = DEFAULT_WOLFRAM_OPTIONS
) {
  if (!apiKey?.trim())
    throw new Error(
      "Wolfram lookup is not configured. You can still use ChEBI or write your definition."
    )
  const selectedOptions = wolframLookupOptionsSchema.parse(options)
  const query = buildWolframQuery(term, context)
  const url = new URL(WOLFRAM_RESULTS_ENDPOINT)
  url.searchParams.set("input", query)
  url.searchParams.set("units", selectedOptions.units)
  for (const assumption of selectedOptions.assumptions)
    url.searchParams.append("assumption", assumption)
  try {
    const response = await fetcher(url, {
      headers: {
        Authorization: apiKey,
        Accept: "application/json, text/plain"
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000)
    })
    if (response.status === 401 || response.status === 403)
      throw new Error("WOLFRAM_AUTH")
    if (!response.ok && response.status !== 501) throw new Error("Unavailable")
    const raw = await readReferenceBody(response)
    let text = raw
    let responseUuid: string | null = null
    let noResult = response.status === 501
    // The documented Results output is plain text; CAG installations may
    // wrap it in the same JSON envelope as Context. Do not guess other fields.
    if (
      response.headers.get("content-type")?.includes("json") ||
      raw.trimStart().startsWith("{")
    ) {
      const body = envelope.parse(JSON.parse(raw))
      if (body.code === 401 || body.code === 403)
        throw new Error("WOLFRAM_AUTH")
      if (body.code !== 200 && body.code !== 501)
        throw new Error("Invalid result")
      text = body.result
      responseUuid = body.uuid ?? null
      noResult = noResult || body.code === 501 || !body.success
    }
    if (/^\s*(?:<!doctype html|<html)/i.test(text) || text.length > 60000)
      throw new Error("Invalid result")
    noResult ||= !text.trim() || /^\s*No results?(?: found)?\.?\s*$/i.test(text)
    const sourceUrl = new URL("https://www.wolframalpha.com/input")
    sourceUrl.searchParams.set("i", query)
    sourceUrl.searchParams.set("units", selectedOptions.units)
    for (const assumption of selectedOptions.assumptions)
      sourceUrl.searchParams.append("assumption", assumption)
    const reference = {
      term: term.trim(),
      definition: text.trim(),
      source: "Wolfram|Alpha",
      sourceIri: sourceUrl.href,
      sourceKey: "wolfram",
      kind: "context",
      usageStatus: "prototype",
      version: responseUuid ?? "live retrieval",
      license: null
    }
    return {
      endpoint: url.href,
      request: {
        input: query,
        context: context.trim(),
        options: selectedOptions
      } satisfies WolframLookupRequest,
      responseUuid,
      responseBody: raw,
      responseHash: createHash("sha256").update(raw).digest("hex"),
      references: noResult
        ? []
        : [
            {
              ...reference,
              contentHash: createHash("sha256")
                .update(JSON.stringify(reference))
                .digest("hex")
            }
          ]
    }
  } catch (error) {
    if (error instanceof Error && error.message === "WOLFRAM_AUTH")
      throw new Error(
        "Wolfram rejected the configured API key. ChEBI and manual writing are still available."
      )
    throw new Error(
      "Wolfram is unavailable or took too long to respond. Try again, or continue writing."
    )
  }
}
