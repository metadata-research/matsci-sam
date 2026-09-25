import Link from "next/link"
import { and, eq, isNull } from "drizzle-orm"
import {
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionsTable,
  statementsTable
} from "@yamz/db"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  conceptPath,
  definitionPath,
  revisionPath,
  termActivityPath,
  termPath,
  vocabularyPath
} from "@/lib/public-identifiers"
import { formatDate } from "@/lib/date"
import type { TermMetadataRecord } from "@/lib/term-metadata"
import { MetadataEditor } from "./metadata-editor"

export async function TermMetadataPage({
  record
}: {
  record: TermMetadataRecord
}) {
  const { term, definitions } = record
  const [facets, topics] = await Promise.all([
    db
      .select({
        id: conceptsTable.id,
        label: conceptsTable.prefLabel,
        slug: conceptsTable.slug,
        schemeSlug: conceptSchemesTable.slug,
        schemeTitle: conceptSchemesTable.title
      })
      .from(statementsTable)
      .innerJoin(
        conceptsTable,
        eq(conceptsTable.id, statementsTable.objectConceptId)
      )
      .innerJoin(
        conceptSchemesTable,
        eq(conceptSchemesTable.id, conceptsTable.schemeId)
      )
      .where(
        and(
          eq(statementsTable.subjectTermId, term.id),
          eq(statementsTable.predicate, "dcterms:subject"),
          isNull(statementsTable.retractedAt)
        )
      ),
    db
      .select({
        id: conceptsTable.id,
        label: conceptsTable.prefLabel,
        slug: conceptsTable.slug,
        schemeSlug: conceptSchemesTable.slug,
        definitionNumber: definitionsTable.definitionNumber
      })
      .from(statementsTable)
      .innerJoin(
        definitionsTable,
        eq(definitionsTable.id, statementsTable.subjectDefinitionId)
      )
      .innerJoin(
        conceptsTable,
        eq(conceptsTable.id, statementsTable.objectConceptId)
      )
      .innerJoin(
        conceptSchemesTable,
        eq(conceptSchemesTable.id, conceptsTable.schemeId)
      )
      .where(
        and(
          eq(definitionsTable.termId, term.id),
          eq(statementsTable.predicate, "dcterms:subject"),
          isNull(statementsTable.retractedAt)
        )
      )
  ])

  return (
    <main className="px-4 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            href={termPath(term.slug, term.vocabularySlug)}
            className="w-fit text-sm text-primary hover:underline"
          >
            Back to {term.term}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Dictionary concept</Badge>
            <span className="text-sm text-muted-foreground">
              Metadata record
            </span>
          </div>
          <h1 className="font-serif text-4xl font-bold">{term.term}</h1>
          <p className="max-w-3xl text-muted-foreground">
            Describe how this term is used or link it to a metadata field.
          </p>
          <nav
            aria-label="Metadata resources"
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-primary"
          >
            <Link href="/metadata/fields" className="hover:underline">
              Browse metadata fields
            </Link>
            <Link href="/metadata/examples" className="hover:underline">
              See examples
            </Link>
            <Link
              href={termActivityPath(term.slug, term.vocabularySlug)}
              className="hover:underline"
            >
              Changes &amp; activity
            </Link>
          </nav>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0">
            <MetadataEditor initialRecord={record} />
          </div>
          <aside
            className="flex min-w-0 flex-col gap-5"
            aria-label="Existing dictionary information"
          >
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Already recorded</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Vocabulary</dt>
                    <dd>
                      <Link
                        className="text-primary hover:underline"
                        href={vocabularyPath(term.vocabularySlug)}
                      >
                        {term.vocabularyTitle}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{formatDate(term.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Identifier</dt>
                    <dd className="break-all font-mono text-xs">{term.iri}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Definitions</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {definitions.length ? (
                  definitions.map((definition) => {
                    const current = definition.revisions.find(
                      (revision) => revision.isCurrent
                    )
                    return (
                      <div
                        key={definition.id}
                        className="flex flex-col gap-1 text-sm"
                      >
                        <Link
                          href={definitionPath(
                            term.slug,
                            definition.definitionNumber,
                            term.vocabularySlug
                          )}
                          className="font-medium text-primary hover:underline"
                        >
                          Definition {definition.definitionNumber}
                        </Link>
                        {current ? (
                          <p className="line-clamp-4">{current.definition}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {definition.authorName ?? "Contributor"}
                          {current ? (
                            <>
                              {" "}
                              ·{" "}
                              <Link
                                className="underline"
                                href={revisionPath(
                                  term.slug,
                                  definition.definitionNumber,
                                  current.version,
                                  term.vocabularySlug
                                )}
                              >
                                Revision {current.version}
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </div>
                    )
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No definitions have been published.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Classification</h2>
                </CardTitle>
                <CardDescription>
                  Facets describe the term. Topics describe individual
                  definitions.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                <div className="flex flex-col gap-2">
                  <p className="font-medium">Term facets</p>
                  <div className="flex flex-wrap gap-2">
                    {facets.length ? (
                      facets.map((facet) => (
                        <Badge key={facet.id} variant="secondary" asChild>
                          <Link
                            href={conceptPath(facet.schemeSlug, facet.slug)}
                            title={facet.schemeTitle}
                          >
                            {facet.label}
                          </Link>
                        </Badge>
                      ))
                    ) : (
                      <p className="text-muted-foreground">None assigned</p>
                    )}
                  </div>
                </div>
                {topics.length ? (
                  <div className="flex flex-col gap-2">
                    <p className="font-medium">Definition topics</p>
                    {topics.map((topic) => (
                      <p key={`${topic.definitionNumber}-${topic.id}`}>
                        <Link
                          className="text-primary hover:underline"
                          href={conceptPath(topic.schemeSlug, topic.slug)}
                        >
                          {topic.label}
                        </Link>
                        <span className="text-muted-foreground">
                          {" "}
                          · Definition {topic.definitionNumber}
                        </span>
                      </p>
                    ))}
                  </div>
                ) : null}
                <Link
                  href={termPath(term.slug, term.vocabularySlug)}
                  className="text-primary hover:underline"
                >
                  Open term and source tools
                </Link>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  )
}
