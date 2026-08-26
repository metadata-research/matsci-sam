import {
  findDefinitionPublicIdentity,
  parsePositivePublicNumber
} from "@/lib/public-definition-resolution"
import { definitionPath, revisionPath } from "@/lib/public-identifiers"
import { notFound, permanentRedirect } from "next/navigation"

export default async function LegacyDefinitionPage({
  params,
  searchParams
}: {
  params: Promise<{ definitionId: string }>
  searchParams: Promise<{ version?: string }>
}) {
  const { definitionId: definitionIdParam } = await params
  const { version: versionParam } = await searchParams
  const definitionId = parsePositivePublicNumber(definitionIdParam)
  const version =
    versionParam !== undefined
      ? parsePositivePublicNumber(versionParam)
      : undefined

  if (!definitionId || (versionParam !== undefined && !version)) notFound()

  const definition = await findDefinitionPublicIdentity(definitionId)
  if (!definition) notFound()

  permanentRedirect(
    version
      ? revisionPath(
          definition.termSlug,
          definition.definitionNumber,
          version,
          definition.termVocabularySlug
        )
      : definitionPath(
          definition.termSlug,
          definition.definitionNumber,
          definition.termVocabularySlug
        )
  )
}
