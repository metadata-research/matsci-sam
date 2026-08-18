/*
 * Escape a string as a Turtle / N-Triples literal. Shared by the SKOS and
 * PROV-O serializers so the two cannot disagree on what a safe literal is.
 *
 * Backslash first, then the quote and the C0 controls that would otherwise
 * end or corrupt the literal: newline, carriage return, tab, and every other
 * control character as a \uXXXX escape (Turtle ECHAR covers \t \n \r; the
 * rest use UCHAR). DEL (0x7f) is legal inside a literal and is left alone.
 */
export const lit = (value: string) =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
    )}"`
