import {
  findDefinitionAtRank,
  parsePositivePublicNumber
} from "@/lib/public-definition-resolution"
import { definitionPath, rankPath, termPath } from "@/lib/public-identifiers"
import { NextResponse } from "next/server"
import { findTermRouteAlias, findVocabularyTerm } from "./_data"

export async function redirectDefinitionAtRank(
  request: Request,
  vocabularySlug: string,
  termSlug: string,
  rankParam: string
) {
  const rank = parsePositivePublicNumber(rankParam)
  if (!rank) return new Response("Not found", { status: 404 })

  const definition = await findDefinitionAtRank(termSlug, rank, vocabularySlug)
  if (!definition) {
    const alias = await findTermRouteAlias(vocabularySlug, termSlug)
    if (!alias) return new Response("Not found", { status: 404 })

    return NextResponse.redirect(
      new URL(rankPath(alias.slug, rank, alias.vocabularySlug), request.url),
      308
    )
  }

  const response = NextResponse.redirect(
    new URL(
      definitionPath(
        definition.termSlug,
        definition.definitionNumber,
        definition.termVocabularySlug
      ),
      request.url
    ),
    307
  )
  response.headers.set("Cache-Control", "no-store")
  return response
}

export async function redirectTermProvenance(
  request: Request,
  vocabularySlug: string,
  termSlug: string
) {
  const term = await findVocabularyTerm(vocabularySlug, termSlug)
  if (!term) {
    const alias = await findTermRouteAlias(vocabularySlug, termSlug)
    if (!alias) return new Response("Not found", { status: 404 })

    return NextResponse.redirect(
      new URL(
        termPath(alias.slug, alias.vocabularySlug) + "/provenance",
        request.url
      ),
      308
    )
  }

  return NextResponse.redirect(
    new URL("/terms/" + term.id + "/provenance.ttl", request.url),
    308
  )
}
