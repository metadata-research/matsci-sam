import { db, termsTable } from "@yamz/db"
import { eq } from "drizzle-orm"
import { termActivityPath } from "@/lib/public-identifiers"
import { notFound, permanentRedirect } from "next/navigation"

export default async function LegacyTermActivityPage({
  params
}: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await params
  const id = Number(termId)
  if (!Number.isSafeInteger(id) || id < 1) notFound()

  const term = await db.query.termsTable.findFirst({
    columns: { slug: true, vocabularySlug: true },
    where: eq(termsTable.id, id)
  })
  if (!term) notFound()
  permanentRedirect(termActivityPath(term.slug, term.vocabularySlug))
}
