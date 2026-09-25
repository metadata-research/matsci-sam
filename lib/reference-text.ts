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
