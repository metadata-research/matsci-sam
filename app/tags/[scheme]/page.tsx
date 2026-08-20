import { conceptSchemesTable, conceptsTable, db } from "@yamz/db"
import { eq } from "drizzle-orm"
import Link from "next/link"
import { notFound, permanentRedirect } from "next/navigation"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import {
  conceptPath,
  conceptSchemeUri,
  tagsIndexPath
} from "@/lib/public-identifiers"
import { conceptsOfScheme } from "@/lib/kos-queries"

/*
 * /tags/<scheme>: a skos:ConceptScheme (topics, pspp, ...). The segment is
 * also where the legacy /tags/<id> tag URL lands: an all-digit segment can
 * never be a scheme slug (the schema forbids it), so it is looked up as a
 * legacy tag id and 308s to the concept that tag became -- through
 * replacedById when the tag was merged -- the way /terms/<id> 308s to
 * /vocabulary/<slug>.
 */

const isLegacyTagId = (segment: string) => /^[0-9]+$/.test(segment)

const redirectLegacyTag = async (segment: string) => {
  const legacyTagId = Number(segment)
  if (!Number.isSafeInteger(legacyTagId)) notFound()

  const [start] = await db
    .select({ id: conceptsTable.id, replacedById: conceptsTable.replacedById })
    .from(conceptsTable)
    .where(eq(conceptsTable.legacyTagId, legacyTagId))
    .limit(1)
  if (!start) notFound()

  // Follow replacement pointers to the final concept. The invariant keeps
  // this a single hop; the loop guard is for a broken chain, never for
  // normal data.
  let current = start
  for (let hop = 0; current.replacedById !== null && hop < 8; hop++) {
    const [next] = await db
      .select({
        id: conceptsTable.id,
        replacedById: conceptsTable.replacedById
      })
      .from(conceptsTable)
      .where(eq(conceptsTable.id, current.replacedById))
      .limit(1)
    if (!next) break
    current = next
  }

  const [target] = await db
    .select({ slug: conceptsTable.slug, schemeSlug: conceptSchemesTable.slug })
    .from(conceptsTable)
    .innerJoin(
      conceptSchemesTable,
      eq(conceptSchemesTable.id, conceptsTable.schemeId)
    )
    .where(eq(conceptsTable.id, current.id))
    .limit(1)
  if (!target) notFound()

  permanentRedirect(conceptPath(target.schemeSlug, target.slug))
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ scheme: string }>
}): Promise<Metadata> {
  const { scheme: segment } = await params
  if (isLegacyTagId(segment)) return { title: `Tags | ${SITE_NAME}` }
  const scheme = await db.query.conceptSchemesTable.findFirst({
    where: eq(conceptSchemesTable.slug, segment)
  })
  return { title: scheme ? `${scheme.title} | ${SITE_NAME}` : SITE_NAME }
}

export default async function ConceptSchemePage({
  params
}: {
  params: Promise<{ scheme: string }>
}) {
  const { scheme: segment } = await params
  if (isLegacyTagId(segment)) await redirectLegacyTag(segment)

  const scheme = await db.query.conceptSchemesTable.findFirst({
    where: eq(conceptSchemesTable.slug, segment)
  })
  if (!scheme) notFound()

  // Each scheme states the order its concepts are listed in: the sequence a
  // curator established, or alphabetical.
  const concepts = await conceptsOfScheme(scheme.slug, scheme.conceptOrder)

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <Link
            href={tagsIndexPath}
            className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-primary"
          >
            Tags
          </Link>
          <h1 className="text-4xl font-bold">{scheme.title}</h1>
          {scheme.description && (
            <p className="text-muted-foreground">{scheme.description}</p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              IRI
            </span>
            <code className="text-sm font-mono text-muted-foreground break-all select-all">
              {conceptSchemeUri(scheme.slug)}
            </code>
          </div>
        </div>

        {concepts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags yet.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {concepts.map((concept) => (
              <li key={concept.id}>
                <Link
                  href={conceptPath(scheme.slug, concept.slug)}
                  className="block h-full rounded-lg border bg-card p-4 space-y-1 hover:border-primary"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">
                      {concept.label}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {concept.terms === 1
                        ? "1 term"
                        : `${concept.terms} terms`}
                    </span>
                  </div>
                  {concept.definition && (
                    <p className="text-sm text-muted-foreground">
                      {concept.definition}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
