import type { Metadata } from "next"
import Link from "next/link"
import { SITE_NAME } from "@/lib/site"
import { TagModal } from "@/components/tags/create-modal"
import { LetterNav } from "@/components/letter-nav"
import {
  collectionsWithCounts,
  conceptsOfScheme,
  facetSchemes,
  topicConcepts
} from "@/lib/kos-queries"
import {
  collectionPath,
  conceptPath,
  conceptSchemePath
} from "@/lib/public-identifiers"

export const metadata: Metadata = { title: `Tags | ${SITE_NAME}` }

/*
 * The knowledge-organization index. Curated facets come first because they
 * classify the term concept and there are only a few of them, then community
 * topics alphabetically, then collections. Every card links to the page that
 * publishes the identifier for that tag.
 */

const count = (n: number, singular: string, plural = `${singular}s`) =>
  `${n} ${n === 1 ? singular : plural}`

const groupByLetter = <T extends { label: string }>(items: T[]) => {
  const groups: Record<string, T[]> = {}
  for (const item of items) {
    const first = item.label?.[0]?.toUpperCase() || "#"
    const key = /[A-Z]/.test(first) ? first : "#"
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }

  return Object.entries(groups).sort(([a], [b]) => {
    if (a === "#") return -1
    if (b === "#") return 1
    return a.localeCompare(b)
  })
}

export default async function TagsPage() {
  const [schemes, topics, collections] = await Promise.all([
    facetSchemes(),
    topicConcepts(),
    collectionsWithCounts()
  ])

  // One extra query per curated scheme. There is one today, and the page is
  // revalidated rather than rendered per request.
  const facetGroups = await Promise.all(
    schemes.map(async (scheme) => ({
      scheme,
      concepts: await conceptsOfScheme(scheme.slug, "seeded")
    }))
  )

  const letters = groupByLetter(topics)

  return (
    <main className="px-4 py-8">
      <LetterNav letters={letters.map(([letter]) => letter)} />
      <div className="max-w-4xl w-full mx-auto space-y-12">
        <section className="flex items-center justify-between gap-4">
          <h1 className="text-4xl font-bold">Tags</h1>
          <TagModal />
        </section>

        {facetGroups.map(({ scheme, concepts }) => (
          <section key={scheme.id} className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Link
                  href={conceptSchemePath(scheme.slug)}
                  className="hover:text-primary"
                >
                  {scheme.title}
                </Link>
              </h2>
              {scheme.description && (
                <p className="text-sm text-muted-foreground">
                  {scheme.description}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {concepts.map((concept) => (
                <Link
                  key={concept.id}
                  href={conceptPath(scheme.slug, concept.slug)}
                  className="rounded-lg border bg-card p-4 space-y-1 hover:border-primary"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">
                      {concept.label}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {count(concept.terms, "term")}
                    </span>
                  </div>
                  {concept.definition && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {concept.definition}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Topics
            </h2>
            <p className="text-sm text-muted-foreground">
              Community tags applied to definitions.
            </p>
          </div>

          {topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No topics yet.</p>
          ) : (
            letters.map(([letter, items]) => (
              <section
                key={letter}
                id={`letter-${letter}`}
                className="space-y-2 scroll-mt-16"
              >
                <h3 className="text-2xl">{letter}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((topic) => (
                    <Link
                      key={topic.id}
                      href={conceptPath("topics", topic.slug)}
                      className="rounded-lg border bg-card px-3 py-2 hover:border-primary"
                    >
                      <span className="block truncate">{topic.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {count(topic.terms, "term")}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))
          )}
        </section>

        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Collections
            </h2>
            <p className="text-sm text-muted-foreground">
              Curated named sets of terms.
            </p>
          </div>
          {collections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No collections have been published.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {collections.map((collection) => (
                <Link
                  key={collection.id}
                  href={collectionPath(collection.slug)}
                  className="rounded-lg border bg-card p-4 space-y-1 hover:border-primary"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">
                      {collection.title}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {count(collection.members, "term")}
                    </span>
                  </div>
                  {collection.description && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {collection.description}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
