export type WolframAssumptionAlternative = {
  label: string
  value: string
}

export type WolframResultBlock =
  | { kind: "text"; text: string }
  | { kind: "properties"; rows: [string, string][] }

export type WolframResultSection = {
  title: string | null
  kind: "interpretation" | "assumptions" | "query" | "content"
  text: string
  /** Source text, including the heading and any local qualifications. */
  copyText: string
  blocks: WolframResultBlock[]
}

function sectionKind(title: string | null): WolframResultSection["kind"] {
  if (/^input interpretation$/i.test(title ?? "")) return "interpretation"
  if (/^assumptions?$/i.test(title ?? "")) return "assumptions"
  if (/^query$/i.test(title ?? "")) return "query"
  return "content"
}

function propertyRow(line: string): [string, string] | null {
  // Require spaced separators and two nonempty columns; retain other shapes.
  const cells = line.split(/\s+\|\s+/)
  return cells.length === 2 &&
    cells.every((cell) => cell.trim() && !cell.includes("|"))
    ? [cells[0].trim(), cells[1].trim()]
    : null
}

function assumptionAlternative(
  line: string
): WolframAssumptionAlternative | null {
  const match =
    /^(?:[-*]\s+)?To use (.+?),?\s+set assumption\s*=\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'<>`]+))\s*$/i.exec(
      line.trim()
    )
  if (!match) return null
  const value = match[2] ?? match[3] ?? match[4]
  const validated = wolframLookupOptionsSchema.safeParse({
    assumptions: [value]
  })
  return validated.success && validated.data.assumptions[0] === value
    ? { label: match[1].replace(/,\s*$/, ""), value }
    : null
}

function blocksFor(text: string, title: string | null): WolframResultBlock[] {
  const lines = text.split(/\r?\n/).map((line) => {
    const alternative = assumptionAlternative(line)
    return alternative
      ? `Alternative interpretation: ${alternative.label}`
      : line
  })
  const blocks: WolframResultBlock[] = []
  let plain: string[] = []
  const flushText = () => {
    if (plain.some((line) => line.trim()))
      blocks.push({ kind: "text", text: plain.join("\n") })
    plain = []
  }
  for (let index = 0; index < lines.length; ) {
    const start = index
    const rows: [string, string][] = []
    while (index < lines.length) {
      const row = propertyRow(lines[index])
      if (!row) break
      rows.push(row)
      index++
    }
    // A single ambiguous bar stays text unless the source names properties.
    if (
      rows.length > 1 ||
      (rows.length === 1 && /propert(?:y|ies)/i.test(title ?? ""))
    ) {
      flushText()
      blocks.push({ kind: "properties", rows })
    } else if (rows.length) {
      plain.push(...lines.slice(start, index))
    } else {
      plain.push(lines[index++])
    }
  }
  flushText()
  return blocks
}

/** Presentation only: never rewrite the stored response or infer missing units. */
export function parseWolframResult(text: string): {
  sections: WolframResultSection[]
  alternatives: WolframAssumptionAlternative[]
} {
  const sections: WolframResultSection[] = []
  const alternatives: WolframAssumptionAlternative[] = []
  const seenAlternatives = new Set<string>()
  let title: string | null = null
  let start = 0
  let bodyStart = 0
  const finish = (end: number) => {
    const body = text.slice(bodyStart, end).trim()
    const copyText = text.slice(start, end).trim()
    if (copyText)
      sections.push({
        title,
        kind: sectionKind(title),
        text: body,
        copyText,
        blocks: blocksFor(body, title)
      })
  }
  for (const match of text.matchAll(/[^\r\n]*(?:\r?\n|$)/g)) {
    const line = match[0].replace(/\r?\n$/, "")
    const trimmed = line.trim()
    // Accept only explicit plain-text headings; unfamiliar output stays text.
    const heading = /^([\p{L}\p{N}][\p{L}\p{N} ()/,&−–—'’.-]{0,99}):$/u.exec(
      trimmed
    )
    const inline =
      /^(Input interpretation|Assumptions?|Query):\s*(\S.*)$/i.exec(trimmed)
    if (heading || inline) {
      finish(match.index)
      title = (heading ?? inline)![1]
      start = match.index
      bodyStart = inline
        ? match.index + line.indexOf(":") + 1
        : match.index + match[0].length
    }
    const alternative = assumptionAlternative(trimmed)
    if (alternative && !seenAlternatives.has(alternative.value)) {
      seenAlternatives.add(alternative.value)
      alternatives.push(alternative)
    }
  }
  finish(text.length)
  return { sections, alternatives }
}

/** A copied property keeps the provider's interpretation and assumption caveats. */
export function wolframSectionCopyText(
  section: WolframResultSection,
  sections: WolframResultSection[]
): string {
  const context = sections.filter(
    (candidate) =>
      candidate !== section &&
      (candidate.kind === "interpretation" || candidate.kind === "assumptions")
  )
  return [
    ...context.map((candidate) => candidate.copyText),
    section.copyText
  ].join("\n\n")
}
import { wolframLookupOptionsSchema } from "./wolfram-query"
