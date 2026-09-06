import {
  findDefinitionAtRank,
  parsePositivePublicNumber
} from "@/lib/public-definition-resolution"
import { definitionPath, rankPath } from "@/lib/public-identifiers"
import { publicRedirect } from "@/lib/public-redirect"
import { findVocabularyTermRoute } from "./_data"

export async function redirectDefinitionAtRank(
  _request: Request,
  vocabularySlug: string,
  termSlug: string,
  rankParam: string
) {
  const rank = parsePositivePublicNumber(rankParam)
  if (!rank) return new Response("Not found", { status: 404 })
  const route = await findVocabularyTermRoute(vocabularySlug, termSlug)
  if (!route) return new Response("Not found", { status: 404 })
  if (route.isAlias)
    return publicRedirect(
      rankPath(route.term.slug, rank, route.term.vocabularySlug),
      308
    )
  const definition = await findDefinitionAtRank(termSlug, rank, vocabularySlug)
  if (!definition) return new Response("Not found", { status: 404 })
  return publicRedirect(
    definitionPath(
      definition.termSlug,
      definition.definitionNumber,
      definition.termVocabularySlug
    )
  )
}
