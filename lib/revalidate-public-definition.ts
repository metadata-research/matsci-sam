import "server-only"

import { db, termsTable } from "@yamz/db"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { definitionPath, revisionPath, termPath } from "./public-identifiers"

export async function revalidatePublicDefinition({
  definitionId,
  definitionNumber,
  termId,
  version
}: {
  definitionId: number
  definitionNumber: number
  termId: number
  version?: number
}) {
  const term = await db.query.termsTable.findFirst({
    columns: { slug: true },
    where: eq(termsTable.id, termId)
  })
  if (!term) return

  revalidatePath(termPath(term.slug))
  revalidatePath(definitionPath(term.slug, definitionNumber))
  if (version)
    revalidatePath(revisionPath(term.slug, definitionNumber, version))

  // Compatibility aliases are permanent redirects, but retain this until
  // clients have had a full deprecation window.
  revalidatePath(`/definition/${definitionId}`)
}
