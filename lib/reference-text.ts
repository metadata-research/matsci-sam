const subscript = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎"
const superscript = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾"
const digits = "0123456789+-=()"

/** Plain-text presentation only. Receipts, hashes and model inputs stay original. */
export function referenceText(reference: {
  sourceKey: string
  definition: string
}) {
  if (reference.sourceKey !== "chebi") return reference.definition
  return reference.definition
    .replace(
      /<(sub|sup)>([0-9+\-=()]+)<\/\1>/gi,
      (_, tag: string, value: string) =>
        Array.from(value, (character) =>
          (tag.toLowerCase() === "sub" ? subscript : superscript).charAt(
            digits.indexOf(character)
          )
        ).join("")
    )
    .replace(/<\/?(?:small|i|b|em|strong)>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (entity) => {
      const entities: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": " "
      }
      return entities[entity]
    })
}

/** The publisher's short identifier for a reference, from its IRI. */
export function referenceIdentifier(reference: {
  sourceKey: string
  sourceIri: string
}) {
  const name =
    reference.sourceIri.split(/[/#]/).filter(Boolean).at(-1) ??
    reference.sourceIri
  let decoded = name
  try {
    decoded = decodeURIComponent(name)
  } catch {
    // Keep the raw segment when it is not valid percent encoding.
  }
  return reference.sourceKey === "chebi"
    ? decoded.replace(/^CHEBI_/, "CHEBI:")
    : decoded
}

const LICENSE_URLS: Record<string, string> = {
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/",
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  MIT: "https://opensource.org/license/mit"
}

/** The licence text where a well-known licence is stated, or nothing. */
export function referenceLicenseUrl(license: string | null | undefined) {
  return license ? LICENSE_URLS[license] : undefined
}
