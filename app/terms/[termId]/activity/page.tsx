import { vocabularyContentVisible } from "@/lib/community-access"
import { currentContentViewer } from "@/lib/content-access"
import { db, termsTable } from "@yamz/db"
import { and, eq } from "drizzle-orm"
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

  const [term] = await db
    .select()
    .from(termsTable)
    .where(
      and(
        eq(termsTable.id, id),
        vocabularyContentVisible(
          termsTable.vocabularySlug,
          await currentContentViewer()
        )
      )
    )
    .limit(1)
  if (!term) notFound()
  permanentRedirect(termActivityPath(term.slug, term.vocabularySlug))
}
