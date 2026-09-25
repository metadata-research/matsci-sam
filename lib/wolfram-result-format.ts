import { wolframLookupOptionsSchema } from "./wolfram-query"

export type WolframAssumptionAlternative = {
  label: string
  value: string
}

export type WolframResultBlock =
  | { kind: "text"; text: string }
  | { kind: "properties"; rows: [string, string][] }
  | { kind: "table"; rows: string[][]; header?: string[] }

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
  if (/^(?:query|Wolfram\|Alpha website result for .+)$/i.test(title ?? ""))
    return "query"
  return "content"
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

const elementSymbols = new Set(
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(
    " "
  )
)
const subscriptDigits = "₀₁₂₃₄₅₆₇₈₉"
const variableSubscripts: Record<string, string> = { T_m: "Tₘ", c_p: "cₚ" }
const superscriptCharacters: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻"
}

/** Small, unambiguous presentation conversions. Unknown scientific syntax stays intact. */
export function wolframReadingText(text: string): string {
  // Never rewrite URLs, code spans, or common structured chemical identifiers.
  return text
    .split(/(https?:\/\/\S+|`[^`\n]*`|\b(?:InChI|InChIKey)=\S+)/g)
    .map((part, index) => {
      if (index % 2) return part
      return part
        .replace(/\b(?:[A-Z][a-z]?(?:_?\d+)?)+\b/g, (formula) => {
          if (!formula.includes("_")) return formula
          const symbols = formula.match(/[A-Z][a-z]?/g) ?? []
          return symbols.every((symbol) => elementSymbols.has(symbol))
            ? formula.replace(/_(\d+)/g, (_, digits: string) =>
                Array.from(
                  digits,
                  (digit) => subscriptDigits[Number(digit)]
                ).join("")
              )
            : formula
        })
        .replace(
          // A word boundary also matches inside decimal or fractional exponents.
          // Format complete integer powers only. Leave unsupported notation intact.
          /\b(\d+(?:\.\d+)?|cm|mm|nm|µm|μm|m|s|kg|g|K|mol|Pa|J|W|N|A|V|Hz)\^([+-]?\d+)\b(?![.\d^]|\s*\/\s*[+-]?(?:\d|\.\d))/g,
          (_, base: string, exponent: string) =>
            base +
            Array.from(
              exponent,
              (character) => superscriptCharacters[character]
            ).join("")
        )
        .replace(
          /\b(T_m|c_p)\b/g,
          (symbol) => variableSubscripts[symbol] ?? symbol
        )
    })
    .join("")
}

/** Remove only recognized provider instructions and non-text assets from the reading view. */
function readingLines(text: string): string[] {
  const lines: string[] = []
  let codeFence: string | null = null
  let codeBody = false
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (codeFence) {
      if (trimmed.startsWith(codeFence)) codeFence = null
      continue
    }
    const fence =
      /^(```+|~~~+)\s*(?:wolfram(?:\s+language)?|mathematica|wl)\s*$/i.exec(
        trimmed
      )
    if (fence) {
      codeFence = fence[1]
      continue
    }
    if (/^Wolfram Language code:\s*/i.test(trimmed)) {
      codeBody = !trimmed.replace(/^Wolfram Language code:\s*/i, "")
      continue
    }
    if (codeBody) {
      if (!trimmed) codeBody = false
      continue
    }
    if (
      /^image:\s*\S/i.test(trimmed) ||
      /^!\[[^\]]*\]\([^\r\n]+\)\s*$/.test(trimmed)
    )
      continue
    if (assumptionAlternative(trimmed)) continue
    lines.push(line)
  }
  return lines
}

function nativeRow(line: string): string[] | null {
  // Preserve blank continuation cells and all columns. A bare mathematical bar is not enough.
  const cells = line.split(/\s+\|\s+/)
  return cells.length >= 2 &&
    cells.some((cell) => cell.trim()) &&
    cells.every((cell) => !cell.includes("|"))
    ? cells.map((cell) => cell.trim())
    : null
}

function markdownRow(line: string): string[] | null {
  let trimmed = line.trim()
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1)
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|"))
    trimmed = trimmed.slice(0, -1)
  const cells = trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"))
  return cells.length >= 2 ? cells : null
}

function blocksFor(text: string, title: string | null): WolframResultBlock[] {
  const lines = readingLines(text)
  const blocks: WolframResultBlock[] = []
  let plain: string[] = []
  const flushText = () => {
    if (plain.some((line) => line.trim()))
      blocks.push({ kind: "text", text: plain.join("\n").trim() })
    plain = []
  }
  for (let index = 0; index < lines.length; ) {
    const header = markdownRow(lines[index])
    const divider =
      index + 1 < lines.length ? markdownRow(lines[index + 1]) : null
    if (
      header &&
      divider &&
      header.length === divider.length &&
      divider.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      flushText()
      index += 2
      const rows: string[][] = []
      while (index < lines.length) {
        const row = markdownRow(lines[index])
        if (!row) break
        rows.push(row)
        index++
      }
      blocks.push({ kind: "table", header, rows })
      continue
    }
    const start = index
    const rows: string[][] = []
    while (index < lines.length) {
      const row = nativeRow(lines[index])
      if (!row) break
      rows.push(row)
      index++
    }
    if (
      rows.length > 1 ||
      (rows.length === 1 &&
        /propert(?:y|ies)|identifiers|names and formulas/i.test(title ?? ""))
    ) {
      flushText()
      if (rows.every((row) => row.length === 2 && row.every(Boolean)))
        blocks.push({ kind: "properties", rows: rows as [string, string][] })
      else blocks.push({ kind: "table", rows })
    } else if (rows.length) plain.push(...lines.slice(start, index))
    else plain.push(lines[index++])
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
  let fenced = false
  for (const match of text.matchAll(/[^\r\n]*(?:\r?\n|$)/g)) {
    const line = match[0].replace(/\r?\n$/, "")
    const trimmed = line.trim()
    if (/^(?:```|~~~)/.test(trimmed)) fenced = !fenced
    const markdown =
      !fenced &&
      /^(?:#{1,6}\s+(.+?)\s*#*|\*\*(.+?)\*\*|__(.+?)__)\s*$/.exec(trimmed)
    const plain =
      !fenced &&
      /^([\p{L}\p{N}][\p{L}\p{N} ()/,&−–—'’.-]{0,99}):$/u.exec(trimmed)
    const website =
      !fenced && /^(Wolfram\|Alpha website result for .+):$/i.exec(trimmed)
    const inline =
      !fenced &&
      /^(Input interpretation|Assumptions?|Query):\s*(\S.*)$/i.exec(trimmed)
    const nextTitle = markdown
      ? (markdown[1] ?? markdown[2] ?? markdown[3]).replace(/:\s*$/, "")
      : (plain || website || inline || undefined)?.[1]
    // Keep machine labels inside their owning section, not as apparent content headings.
    if (nextTitle && !/^(?:image|Wolfram Language code)$/i.test(nextTitle)) {
      finish(match.index)
      title = nextTitle
      start = match.index
      bodyStart = inline
        ? match.index + line.indexOf(":") + 1
        : match.index + match[0].length
    }
    const alternative = !fenced && assumptionAlternative(trimmed)
    if (alternative && !seenAlternatives.has(alternative.value)) {
      seenAlternatives.add(alternative.value)
      alternatives.push(alternative)
    }
  }
  finish(text.length)
  return { sections, alternatives }
}

/** Partition by explicit source headings. No generated summary or inferred facts. */
export function wolframResultPresentation(
  sections: readonly WolframResultSection[]
): {
  interpretation: WolframResultSection[]
  assumptions: WolframResultSection[]
  overview: WolframResultSection[]
  more: WolframResultSection[]
  visual: WolframResultSection[]
} {
  const result = {
    interpretation: [] as WolframResultSection[],
    assumptions: [] as WolframResultSection[],
    overview: [] as WolframResultSection[],
    more: [] as WolframResultSection[],
    visual: [] as WolframResultSection[]
  }
  for (const section of sections) {
    if (section.kind === "query") continue
    if (!section.blocks.length) {
      if (
        /image:|!\[|Wolfram Language code:|```(?:wolfram|mathematica|wl)/i.test(
          section.text
        )
      )
        result.visual.push(section)
      continue
    }
    if (section.kind === "interpretation" || section.kind === "assumptions")
      result[section.kind].push(section)
    else if (
      /^(?:chemical names and formulas|basic properties|general properties|identity|definition|definitions|result|results|principal result|properties)$/i.test(
        section.title ?? ""
      )
    )
      result.overview.push(section)
    else result.more.push(section)
  }
  if (!result.overview.length && result.more.length)
    result.overview.push(result.more.shift()!)
  return result
}

function readingSection(section: WolframResultSection): string {
  if (section.kind === "query" || !section.blocks.length) return ""
  const body = section.blocks
    .map((block) => {
      if (block.kind === "text") return wolframReadingText(block.text)
      let previousProperty = ""
      const lines = block.rows.map((row) => {
        const property = row[0] || previousProperty
        if (row[0]) previousProperty = row[0]
        const value = row
          .slice(1)
          .map((cell, index) => {
            if (!cell) return ""
            const label =
              block.kind === "table" ? block.header?.[index + 1] : undefined
            return label ? `${label}: ${cell}` : cell
          })
          .filter(Boolean)
          .join("; ")
        const propertyHeading =
          block.kind === "table" ? block.header?.[0] : undefined
        const label = propertyHeading
          ? `${propertyHeading}: ${property}`
          : property
        // Identifiers are exact strings, even if they resemble scientific notation.
        return /identifier|SMILES|InChI|registry number/i.test(property)
          ? `${label}: ${value}`
          : wolframReadingText(`${label}: ${value}`)
      })
      return lines.join("\n")
    })
    .join("\n\n")
  return [section.title ? `${section.title}:` : "", body]
    .filter(Boolean)
    .join("\n")
}

/** Human-readable insertion. All original evidence remains in text/copyText. */
export function wolframSectionReadingText(
  section: WolframResultSection,
  sections: readonly WolframResultSection[]
): string {
  const selected = readingSection(section)
  if (!selected) return ""
  const context = sections.filter(
    (candidate) =>
      candidate !== section &&
      (candidate.kind === "interpretation" || candidate.kind === "assumptions")
  )
  return [...context.map(readingSection), selected].filter(Boolean).join("\n\n")
}

/** A raw copied property keeps the provider's interpretation and assumption caveats. */
export function wolframSectionCopyText(
  section: WolframResultSection,
  sections: readonly WolframResultSection[]
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
