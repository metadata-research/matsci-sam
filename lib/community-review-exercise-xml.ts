import { SaxesParser } from "saxes"
import {
  MAX_REVIEW_EXERCISE_XML_LENGTH,
  type ReviewExerciseXmlStatus
} from "./community-review-exercise-types"

/** Checks syntax only. No DTD, resolver, schema fetch or entity expansion. */
export function validateReviewExerciseXml(
  xml: string
): ReviewExerciseXmlStatus {
  if (xml.length > MAX_REVIEW_EXERCISE_XML_LENGTH)
    throw new Error("The XML is too long. Use 200,000 characters or fewer.")
  if (!xml.trim()) return "empty"
  const parser = new SaxesParser({ xmlns: true })
  let depth = 0,
    nodes = 0,
    placeholder = false
  const inspect = (value: string) => {
    if (/\bFILL\*?\b/.test(value)) placeholder = true
  }
  parser.on("doctype", () => {
    throw new Error(
      "Remove the document type declaration. DTDs and custom entities are not supported."
    )
  })
  parser.on("processinginstruction", () => {
    throw new Error("Remove XML processing instructions before saving.")
  })
  parser.on("opentag", (node) => {
    if (++depth > 64 || ++nodes > 5000)
      throw new Error("The XML structure is too large or deeply nested.")
    for (const attribute of Object.values(node.attributes))
      inspect(attribute.value)
  })
  parser.on("closetag", () => {
    depth--
  })
  parser.on("text", inspect)
  parser.on("cdata", inspect)
  parser.on("error", () => {
    throw new Error(
      `The XML is not well-formed near line ${parser.line}, column ${parser.column}. Check tags and escaped characters.`
    )
  })
  parser.write(xml).close()
  return placeholder ? "template" : "well_formed"
}
