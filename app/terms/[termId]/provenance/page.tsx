import { vocabularyContentVisible } from "@/lib/community-access"
import { currentContentViewer } from "@/lib/content-access"
import { notFound } from "next/navigation"
import { TermProvenancePage } from "@/components/provenance/page"
import { db, termsTable } from "@yamz/db"
import { and, eq } from "drizzle-orm"
import type { Metadata } from "next"
import { cache } from "react"
import { termPath } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"

const findTerm = cache(async (termId: string) => {
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
  return term
})

export async function generateMetadata({
  params
}: {
  params: Promise<{ termId: string }>
}): Promise<Metadata> {
  const { termId } = await params
  const term = await findTerm(termId)
  return {
    title: `Provenance: ${term.term} | ${SITE_NAME}`,
    robots: term.hiddenAt ? { index: false, follow: false } : undefined,
    alternates: {
      canonical: termPath(term.slug, term.vocabularySlug) + "/provenance"
    }
  }
}

export default async function PublicTermProvenancePage({
  params
}: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await params
  const term = await findTerm(termId)
  return (
    <TermProvenancePage
      termId={term.id}
      hiddenAt={term.hiddenAt}
      hiddenReason={term.hiddenReason}
    />
  )
}
