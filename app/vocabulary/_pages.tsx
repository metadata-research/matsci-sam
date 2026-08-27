import { DefinitionList } from "@/app/terms/[termId]/definitions"
import { Badge } from "@/components/ui/badge"
import { FacetEditor } from "@/components/tags/facet-editor"
import { TermFacets, TermFacetsFallback } from "@/components/tags/term-facets"
import { getCurrentUser } from "@/lib/current-user"
import { facetOptions } from "@/lib/kos-queries"
import {
  conceptSchemeJsonLd,
  definedTermJsonLd,
  termIdsWithActiveBroader
} from "@/lib/skos"
import {
  termPath,
  termActivityPath,
  termUri,
  vocabularyPath,
  vocabularyUri
} from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import { HydrateClient, trpc } from "@/trpc/server"
import { db, definitionsTable } from "@yamz/db"
import { desc, eq } from "drizzle-orm"
import { ActivityIcon, NetworkIcon } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"
import {
  findVocabulary,
  otherVocabularies,
  vocabularyReferences,
  vocabularyTerms,
  type VocabularyPageRecord
} from "./_data"

const definitionCount = (count: number) =>
  count === 1 ? "1 definition" : count + " definitions"

export async function VocabularySchemePage({
  vocabulary
}: {
  vocabulary: VocabularyPageRecord
}) {
  const [terms, notTop, references, catalog] = await Promise.all([
    vocabularyTerms(vocabulary.slug),
    termIdsWithActiveBroader(),
    vocabulary.isDefault
      ? Promise.resolve([])
      : vocabularyReferences(vocabulary.slug),
    vocabulary.isDefault ? otherVocabularies() : Promise.resolve([])
  ])
  const title = vocabulary.isDefault
    ? SITE_NAME + " Vocabulary"
    : vocabulary.title + " vocabulary"
  const description =
    vocabulary.description ??
    (vocabulary.isDefault
      ? "A community-built controlled vocabulary for materials science metadata."
      : "Terms defined within the " +
        vocabulary.title +
        " community vocabulary.")
  const schemeIri = vocabularyUri(vocabulary.slug)
  const structuredData = {
    ...conceptSchemeJsonLd(
      terms.filter((term) => !notTop.has(term.id)),
      vocabulary.slug
    ),
    "dcterms:title": title,
    "dcterms:description": description
  }
  const jsonLd = JSON.stringify(structuredData).replace(/</g, "\\u003c")

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <main className="px-4 py-8">
        <div className="mx-auto w-full max-w-4xl space-y-8">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Concept scheme
              </span>
              {vocabulary.retiredAt ? (
                <Badge variant="outline">Retired</Badge>
              ) : null}
            </div>
            <h1 className="text-4xl font-bold">{title}</h1>
            <p className="text-muted-foreground">{description}</p>
            {vocabulary.community ? (
              <p className="text-sm text-muted-foreground">
                Owned by the{" "}
                <Link
                  href={"/communities/" + vocabulary.community.slug}
                  className="text-primary hover:underline"
                >
                  {vocabulary.community.title} community
                </Link>
                .
              </p>
            ) : null}
          </header>

          <section className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-muted-foreground">Scheme IRI</span>
              <code className="break-all font-mono">{schemeIri}</code>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-muted-foreground">Concept IRI</span>
              <code className="break-all font-mono">
                {schemeIri}/&lt;term&gt;
              </code>
            </div>
            <p className="pt-1 text-muted-foreground">
              Terms defined here keep this namespace. Referenced terms retain
              the identifier of their source vocabulary.
            </p>
          </section>

          <section aria-labelledby="vocabulary-terms-heading">
            <div className="mb-1 flex items-baseline justify-between gap-4">
              <h2
                id="vocabulary-terms-heading"
                className="text-2xl font-semibold"
              >
                Terms
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({terms.length})
                </span>
              </h2>
              {vocabulary.isDefault ? (
                <Link href="/terms" className="text-sm text-primary">
                  Browse alphabetically
                </Link>
              ) : null}
            </div>
            <div className="mb-2 h-px bg-border" />
            {terms.length ? (
              <ul>
                {terms.map((term) => (
                  <li key={term.id}>
                    <Link
                      href={termPath(term.slug, term.vocabularySlug)}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-3 py-2 transition-colors hover:bg-accent"
                    >
                      <span className="font-serif text-lg">{term.term}</span>
                      <code className="text-xs font-mono text-muted-foreground">
                        /{term.slug}
                      </code>
                      <span className="ml-auto text-sm text-muted-foreground">
                        {definitionCount(term.count)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                No terms have been defined in this vocabulary yet.
                {references.length
                  ? " The references below remain defined in their source vocabularies."
                  : ""}
              </div>
            )}
          </section>

          {references.length ? (
            <section aria-labelledby="vocabulary-references-heading">
              <div className="mb-1 flex items-baseline justify-between gap-4">
                <h2
                  id="vocabulary-references-heading"
                  className="text-2xl font-semibold"
                >
                  Referenced terms
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({references.length})
                  </span>
                </h2>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                These terms appear in this community&apos;s collections but are
                defined in another vocabulary. Following one opens its source
                record.
              </p>
              <ul className="space-y-1">
                {references.map((term) => (
                  <li key={term.id}>
                    <Link
                      href={termPath(term.slug, term.vocabularySlug)}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 transition-colors hover:bg-accent"
                    >
                      <span className="font-serif text-lg">{term.term}</span>
                      <Badge variant="outline">Reference</Badge>
                      <span className="text-xs text-muted-foreground">
                        Source: {term.vocabularyTitle}
                      </span>
                      <span className="ml-auto text-sm text-muted-foreground">
                        {definitionCount(term.count)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {catalog.length ? (
            <section aria-labelledby="other-vocabularies-heading">
              <h2
                id="other-vocabularies-heading"
                className="mb-3 text-2xl font-semibold"
              >
                Community vocabularies
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {catalog.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={vocabularyPath(item.slug)}
                      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{item.title}</span>
                        {item.retiredAt ? (
                          <Badge variant="outline">Retired</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.count === 1
                          ? "1 local term"
                          : item.count + " local terms"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
    </>
  )
}

export type VocabularyTermRecord = NonNullable<
  Awaited<ReturnType<typeof import("./_data").findVocabularyTerm>>
>

export async function VocabularyTermPage({
  term
}: {
  term: VocabularyTermRecord
}) {
  const prefetches = Promise.all([
    trpc.definitions.list.prefetch({ termId: term.id }),
    trpc.tags.facets.prefetch({ termId: term.id })
  ])
  const userPromise = getCurrentUser()
  const topDefinitionPromise = db.query.definitionsTable.findFirst({
    where: eq(definitionsTable.termId, term.id),
    orderBy: [
      desc(definitionsTable.score),
      desc(definitionsTable.createdAt),
      desc(definitionsTable.definitionNumber)
    ]
  })
  const [, user, topDefinition] = await Promise.all([
    prefetches,
    userPromise,
    topDefinitionPromise
  ])
  const isCurator = user?.role === "admin"
  const options = isCurator ? await facetOptions() : []
  const baseJsonLd = definedTermJsonLd(term, topDefinition?.definition)
  const jsonLd = JSON.stringify({
    ...baseJsonLd,
    inDefinedTermSet: {
      ...baseJsonLd.inDefinedTermSet,
      name: term.vocabularyTitle,
      url: vocabularyUri(term.vocabularySlug)
    }
  }).replace(/</g, "\\u003c")

  return (
    <HydrateClient>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <main className="px-4 py-8">
        <section className="mx-auto w-full max-w-4xl">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>Source vocabulary</span>
            <Link
              href={vocabularyPath(term.vocabularySlug)}
              className="font-medium text-primary hover:underline"
            >
              {term.vocabularyTitle}
            </Link>
            {term.vocabularyRetiredAt ? (
              <Badge variant="outline">Retired</Badge>
            ) : null}
          </div>
          <div className="mb-1 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="font-serif text-4xl font-bold">{term.term}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link
                href={termActivityPath(term.slug, term.vocabularySlug)}
                className="flex items-center gap-1 text-primary"
              >
                <ActivityIcon className="size-4" aria-hidden /> Changes &amp;
                activity
              </Link>
              <Link
                href={"/terms/" + term.id + "/provenance"}
                className="flex items-center gap-1 text-primary"
              >
                <NetworkIcon className="size-4" /> Provenance
              </Link>
              <span className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <a
                  href={"/terms/" + term.id + "/skos.ttl"}
                  className="hover:text-primary"
                >
                  SKOS
                </a>
                <a
                  href={"/terms/" + term.id + "/skos.jsonld"}
                  className="hover:text-primary"
                >
                  JSON-LD
                </a>
              </span>
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              IRI
            </span>
            <code className="break-all text-sm font-mono text-muted-foreground select-all">
              {termUri(term.slug, term.vocabularySlug)}
            </code>
          </div>

          <div className="mb-6">
            <Suspense fallback={<TermFacetsFallback />}>
              <TermFacets termId={term.id}>
                {isCurator ? (
                  <FacetEditor termId={term.id} options={options} />
                ) : null}
              </TermFacets>
            </Suspense>
          </div>

          <div className="space-y-2">
            <DefinitionList
              termId={term.id}
              termSlug={term.slug}
              termVocabularySlug={term.vocabularySlug}
            />
          </div>
        </section>
      </main>
    </HydrateClient>
  )
}

export async function VocabularySourceLabel({
  vocabularySlug
}: {
  vocabularySlug: string
}) {
  const vocabulary = await findVocabulary(vocabularySlug)
  if (!vocabulary) return null

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6 text-sm text-muted-foreground">
      Source vocabulary:{" "}
      <Link
        href={vocabularyPath(vocabulary.slug)}
        className="font-medium text-primary hover:underline"
      >
        {vocabulary.title}
      </Link>
    </div>
  )
}
