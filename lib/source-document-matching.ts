import { createHash } from "node:crypto"
import {
  SOURCE_MATCHER_VERSION,
  SOURCE_MAX_ALIASES,
  SOURCE_MAX_CHARACTERS,
  type SourceDocumentCheck,
  type SourceLocation,
  type SourceMatch,
  type SourcePage,
  type SourcePassage
} from "./source-document-types"

const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const word = /[\p{L}\p{N}\p{M}\p{Pc}]/u

/** Normalize for comparison while mapping every output unit to displayed text. */
export function normalizeSourceText(text: string) {
  let normalized = ""
  const starts: number[] = []
  const ends: number[] = []
  let skipUntil = -1
  for (const item of new Intl.Segmenter("und", {
    granularity: "grapheme"
  }).segment(text)) {
    const start = item.index
    const end = start + item.segment.length
    if (start < skipUntil) continue
    const value = item.segment.normalize("NFC").toLowerCase()
    if (value === "\u00ad") {
      const wrap = /^[ \t]*(?:\r\n?|\n)[ \t]*/u.exec(text.slice(end))
      if (wrap) skipUntil = end + wrap[0].length
      continue
    }
    if (/^\s+$/u.test(value)) {
      if (normalized.endsWith(" ")) ends[ends.length - 1] = end
      else {
        normalized += " "
        starts.push(start)
        ends.push(end)
      }
      continue
    }
    normalized += value
    for (let index = 0; index < value.length; index++) {
      starts.push(start)
      ends.push(end)
    }
  }
  return { text: normalized, starts, ends }
}

function previousCharacter(text: string, index: number) {
  if (!index) return ""
  const last = text.charCodeAt(index - 1)
  return text.slice(
    last >= 0xdc00 && last <= 0xdfff ? Math.max(0, index - 2) : index - 1,
    index
  )
}

function nextCharacter(text: string, index: number) {
  return index < text.length
    ? String.fromCodePoint(text.codePointAt(index)!)
    : ""
}

export function sourceLocations(
  pages: SourcePage[],
  start: number,
  end: number
) {
  return pages
    .filter((page) => page.start < end && page.end > start)
    .map(
      (page): SourceLocation => ({
        page: page.page,
        method: page.method,
        label: page.label,
        start: Math.max(page.start, start),
        end: Math.min(page.end, end)
      })
    )
}

export function checkSourceDocument({
  text,
  pages,
  term,
  aliases = []
}: {
  text: string
  pages: SourcePage[]
  term: string
  aliases?: string[]
}): SourceDocumentCheck {
  if (!text.trim() || text.length > SOURCE_MAX_CHARACTERS)
    throw new Error("Check a readable source within the text limit.")
  if (
    !term.trim() ||
    term.trim().length > 200 ||
    aliases.length > SOURCE_MAX_ALIASES
  )
    throw new Error("Provide a term and at most 20 explicit aliases.")
  if (aliases.some((alias) => !alias.trim() || alias.trim().length > 200))
    throw new Error("Each alias must contain between 1 and 200 characters.")
  if (
    !pages.length ||
    pages.some(
      (page, index) =>
        !Number.isSafeInteger(page.start) ||
        !Number.isSafeInteger(page.end) ||
        page.start < 0 ||
        page.end < page.start ||
        page.end > text.length ||
        (index > 0 && page.start < pages[index - 1].end)
    )
  )
    throw new Error(
      "The source locations are invalid. Process the source again."
    )
  const normalized = normalizeSourceText(text)
  const digest = hash(text)
  const seen = new Set<string>()
  const names = [term, ...aliases].flatMap((name, index) => {
    const key = normalizeSourceText(name).text.trim()
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [{ key, label: name.trim(), isAlias: index !== 0 }]
  })
  const matches: SourceMatch[] = []
  for (const name of names) {
    let from = 0
    while (from < normalized.text.length) {
      const index = normalized.text.indexOf(name.key, from)
      if (index < 0) break
      from = index + Math.max(1, name.key.length)
      const endIndex = index + name.key.length
      if (
        word.test(previousCharacter(normalized.text, index)) ||
        word.test(nextCharacter(normalized.text, endIndex))
      )
        continue
      const start = normalized.starts[index]
      const end = normalized.ends[endIndex - 1]
      matches.push({
        id: hash(
          `${SOURCE_MATCHER_VERSION}:${digest}:${start}:${end}:${name.key}`
        ),
        start,
        end,
        text: text.slice(start, end),
        matchedTerm: name.label,
        isAlias: name.isAlias,
        page:
          pages.find((page) => page.start <= start && page.end > start)?.page ??
          null
      })
      if (matches.length > 2000)
        throw new Error(
          "This source contains too many term occurrences. Use a shorter source."
        )
    }
  }
  matches.sort(
    (a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id)
  )
  const passages: SourcePassage[] = []
  // Partition the transcript without overlap. Prefer paragraph boundaries;
  // long paragraphs split near whitespace, never through a matched phrase.
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + 1200)
    if (end < text.length) {
      const window = text.slice(start, end)
      const paragraph = window.lastIndexOf("\n\n")
      const space = window.search(/\s+\S*$/u)
      if (paragraph >= 300) end = start + paragraph + 2
      else if (space >= 300) end = start + space + 1
      const near = matches.find(
        (match) => match.start < end + 100 && match.end > end - 100
      )
      if (near) {
        const before = near.start - 150
        end =
          before > start + 300 ? before : Math.min(text.length, near.end + 150)
      }
      // Moving a boundary around a match can land inside a word, including a
      // Unicode grapheme. Extend to whitespace before resolving match overlap.
      while (end < text.length && !/\s/u.test(text[end])) end++
      // Multiple aliases may overlap the adjusted boundary.
      let crossing = matches.find(
        (match) => match.start < end && match.end > end
      )
      while (crossing) {
        end = crossing.end
        crossing = matches.find((match) => match.start < end && match.end > end)
      }
    }
    if (text.slice(start, end).trim()) {
      const passageMatches = matches.filter(
        (match) => match.start < end && match.end > start
      )
      passages.push({
        id: hash(`${SOURCE_MATCHER_VERSION}:${digest}:${start}:${end}`),
        start,
        end,
        text: text.slice(start, end),
        locations: sourceLocations(pages, start, end),
        matchIds: passageMatches.map((match) => match.id)
      })
    }
    start = end
  }
  return {
    term: term.trim(),
    aliases: names.filter((name) => name.isAlias).map((name) => name.label),
    matches,
    passages,
    matcherVersion: SOURCE_MATCHER_VERSION
  }
}
