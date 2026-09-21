import { Lexer, walkTokens } from "marked"
import type { InferenceMetadata, ProviderReportedSource } from "./llm/types"

const MAX_SOURCES = 10
const MAX_CANDIDATES = 100
const MAX_URL_LENGTH = 2048
const MAX_TITLE_LENGTH = 200
const MAX_OUTPUT_LENGTH = 10000

function sanitizedSource(value: unknown): ProviderReportedSource | undefined {
  if (!value || typeof value !== "object") return
  const { url, title } = value as { url?: unknown; title?: unknown }
  if (
    typeof url !== "string" ||
    url.length > MAX_URL_LENGTH ||
    !/^https?:\/\//i.test(url) ||
    /[\s\\\u0000-\u001f\u007f]/u.test(url)
  )
    return
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.href.length > MAX_URL_LENGTH
  )
    return
  const safeTitle =
    typeof title === "string" &&
    title.trim().length > 0 &&
    title.length <= MAX_TITLE_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(title) &&
    !/^\[?\d+\]?$/.test(title.trim())
      ? title.trim()
      : undefined
  return { url: parsed.href, ...(safeTitle ? { title: safeTitle } : {}) }
}

function sanitizedSources(value: unknown): ProviderReportedSource[] {
  if (!Array.isArray(value)) return []
  const sources: ProviderReportedSource[] = []
  const seen = new Set<string>()
  for (const candidate of value.slice(0, MAX_CANDIDATES)) {
    const source = sanitizedSource(candidate)
    if (!source || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
    if (sources.length === MAX_SOURCES) break
  }
  return sources
}

/**
 * Read reported links, never fetch them or infer which facts they support.
 * Legacy fallback must receive the original provider output, not a later human
 * publication. Explicit stored metadata (including []) takes precedence.
 */
export function providerReportedSources(
  inference: InferenceMetadata | null | undefined,
  output: string
): ProviderReportedSource[] {
  if (inference?.reportedSources !== undefined)
    return sanitizedSources(inference.reportedSources)
  if (
    inference?.provider !== "wolfram-agent-one" ||
    output.length > MAX_OUTPUT_LENGTH
  )
    return []

  const candidates: ProviderReportedSource[] = []
  let inFooter = false
  try {
    for (const token of Lexer.lex(output)) {
      if (token.type === "heading") {
        if (inFooter) break
        inFooter = token.text.trim() === "Wolfram Sources"
        continue
      }
      if (!inFooter) continue
      if (token.type === "hr") break
      // Markdown lexing excludes links embedded in code or raw HTML. Restrict
      // extraction to the known footer's prose/lists, not arbitrary answer links.
      if (token.type !== "list" && token.type !== "paragraph") continue
      walkTokens([token], (child) => {
        if (child.type !== "link" || candidates.length >= MAX_CANDIDATES) return
        candidates.push({
          url: child.href,
          title: child.title ?? child.text
        })
      })
      if (candidates.length >= MAX_CANDIDATES) break
    }
  } catch {
    // Optional metadata extraction must never reject a valid final answer.
    return []
  }
  return sanitizedSources(candidates)
}
