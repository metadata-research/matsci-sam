import {
  findNondefaultVocabulary,
  findVocabulary,
  findVocabularyTermRoute
} from "@/app/vocabulary/_data"
import {
  findDefinitionByPublicNumber,
  findDefinitionRevisionByPublicNumber,
  parsePositivePublicNumber
} from "@/lib/public-definition-resolution"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"
import {
  buildTermSkos,
  loadKos,
  loadSchemeDocument,
  renderSchemeTurtle,
  termTurtle
} from "@/lib/skos"
import { buildTermProvenance } from "@/lib/provenance"
import { provenanceTurtle } from "@/lib/provenance-rdf"
import { turtleJsonLd } from "@/lib/rdf-jsonld"
import { vocabularyDocument } from "@/lib/vocabulary-http"

export async function vocabularyDocumentResponse(
  path: string,
  format: string | null,
  history: boolean
) {
  const doc = vocabularyDocument(path)
  if (
    !doc ||
    doc.format ||
    doc.provenance ||
    !["ttl", "jsonld"].includes(format ?? "")
  )
    return new Response("Not found", { status: 404 })
  const parts = path.split("/").slice(2)
  const definitionIndex = parts.indexOf("definitions")
  const scope = definitionIndex < 0 ? parts : parts.slice(0, definitionIndex)
  let turtle: string
  const vocabulary =
    scope.length === 0
      ? await findVocabulary(DEFAULT_VOCABULARY_SLUG)
      : scope.length === 1
        ? await findNondefaultVocabulary(scope[0])
        : null
  if (vocabulary && definitionIndex < 0 && !history) {
    const document = await loadSchemeDocument()
    turtle = renderSchemeTurtle({
      ...document,
      vocabularies: document.vocabularies.filter(
        (v) => v.slug === vocabulary.slug
      ),
      records: document.records.filter(
        (t) => t.vocabularySlug === vocabulary.slug
      )
    })
  } else {
    if (!scope.length || scope.length > 2)
      return new Response("Not found", { status: 404 })
    const route = await findVocabularyTermRoute(
      scope.length === 2 ? scope[0] : DEFAULT_VOCABULARY_SLUG,
      scope.at(-1)!
    )
    if (!route) return new Response("Not found", { status: 404 })
    const { term } = route
    let revision = false
    if (definitionIndex >= 0) {
      const number = parsePositivePublicNumber(parts[definitionIndex + 1])
      const versionParam = parts[definitionIndex + 3]
      const version = versionParam
        ? parsePositivePublicNumber(versionParam)
        : null
      if (!number || (versionParam && !version))
        return new Response("Not found", { status: 404 })
      const found = version
        ? await findDefinitionRevisionByPublicNumber(
            term.slug,
            number,
            version,
            term.vocabularySlug
          )
        : await findDefinitionByPublicNumber(
            term.slug,
            number,
            term.vocabularySlug
          )
      if (!found) return new Response("Not found", { status: 404 })
      revision = !!version
    }
    if (history || revision) {
      const provenance = await buildTermProvenance(term.id, {
        anonymizeVoters: true
      })
      if (!provenance) return new Response("Not found", { status: 404 })
      turtle = provenanceTurtle(provenance)
    } else {
      const kos = await loadKos()
      const skos = await buildTermSkos(term.id, kos)
      if (!skos) return new Response("Not found", { status: 404 })
      turtle = termTurtle(skos, kos)
    }
  }
  const headers = {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  }
  return format === "jsonld"
    ? Response.json(turtleJsonLd(turtle), {
        headers: {
          ...headers,
          "Content-Type": "application/ld+json; charset=utf-8"
        }
      })
    : new Response(turtle, {
        headers: { ...headers, "Content-Type": "text/turtle; charset=utf-8" }
      })
}
