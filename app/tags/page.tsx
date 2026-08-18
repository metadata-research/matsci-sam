import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import { TagModal } from "@/components/tags/create-modal"
import { conceptSchemesTable, conceptsTable, db } from "@yamz/db"
import { and, asc, eq, sql } from "drizzle-orm"
import Link from "next/link"
import styles from "./tags.module.css"
import { LetterNav } from "@/components/letter-nav"
import { conceptPath } from "@/lib/public-identifiers"

export const metadata: Metadata = { title: `Tags | ${SITE_NAME}` }

// Community topics A-Z. Topics are concepts in the open `topics` scheme; the
// curated facet schemes are reached from term pages and /tags/<scheme>.
export default async function TagsPage() {
  const tags = await db
    .select({
      id: conceptsTable.id,
      name: conceptsTable.prefLabel,
      slug: conceptsTable.slug,
      schemeSlug: conceptSchemesTable.slug
    })
    .from(conceptsTable)
    .innerJoin(
      conceptSchemesTable,
      eq(conceptSchemesTable.id, conceptsTable.schemeId)
    )
    .where(
      and(
        eq(conceptSchemesTable.slug, "topics"),
        eq(conceptsTable.status, "approved")
      )
    )
    .orderBy(asc(sql`lower(${conceptsTable.prefLabel})`))

  // Group tags by first character
  const groups: Record<string, typeof tags> = {}
  for (const tag of tags) {
    const firstChar = tag.name?.[0]?.toUpperCase() || "#"
    const key = /[A-Z]/.test(firstChar) ? firstChar : "#"
    if (!groups[key]) groups[key] = []
    groups[key].push(tag)
  }

  // Sort groups: # first, then A-Z
  const sorted = Object.entries(groups).sort(([a], [b]) => {
    if (a === "#") return -1
    if (b === "#") return 1
    return a.localeCompare(b)
  })

  return (
    <main className={styles.page}>
      <LetterNav letters={sorted.map(([letter]) => letter)} />
      <section className={styles.headingRow}>
        <h1 className={styles.heading}>Tags</h1>
        <TagModal />
      </section>
      <div className={styles.sections}>
        {sorted.map(([letter, items]) => (
          <section
            key={letter}
            id={`letter-${letter}`}
            className={styles.letterGroup}
          >
            <h2 className={styles.letterHeader}>{letter}</h2>
            <div className={styles.cardGrid}>
              {items.map((tag) => (
                <Link
                  key={tag.id}
                  href={conceptPath(tag.schemeSlug, tag.slug)}
                  className={styles.card}
                >
                  {tag.name}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
