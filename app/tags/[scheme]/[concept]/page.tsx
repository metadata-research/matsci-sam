import { TermDefinition } from "@/components/term/preview"
import { Card } from "@/components/ui/card"
import {
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionsTable,
  statementsTable,
  termsTable
} from "@yamz/db"
import { and, asc, eq, isNull } from "drizzle-orm"
import Link from "next/link"
import { notFound, permanentRedirect } from "next/navigation"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import {
  conceptPath,
  conceptSchemePath,
  conceptUri,
  definitionPath,
  termPath
} from "@/lib/public-identifiers"
import { MAPPING_PREDICATES } from "@/lib/kos"
import { conceptRelations } from "@/lib/kos-queries"

/*
 * /tags/<scheme>/<concept>: the skos:Concept IRI a tag or facet is published
 * under. Lists the terms that carry it as a facet (term-level statements)
 * and the definitions that carry it as a topic (definition-level). A merged
 * concept 308s to its replacement; a retired concept without one is a
 * tombstone.
 */

const loadConcept = async (schemeSlug: string, conceptSlug: string) => {
  const [row] = await db
    .select({
      id: conceptsTable.id,
      slug: conceptsTable.slug,
      label: conceptsTable.prefLabel,
      altLabels: conceptsTable.altLabels,
      definition: conceptsTable.definition,
      scopeNote: conceptsTable.scopeNote,
      createdById: conceptsTable.createdById,
      status: conceptsTable.status,
      replacedById: conceptsTable.replacedById,
      schemeId: conceptSchemesTable.id,
      schemeSlug: conceptSchemesTable.slug,
      schemeTitle: conceptSchemesTable.title,
      schemeBridgeable: conceptSchemesTable.bridgeable
    })
    .from(conceptsTable)
    .innerJoin(
      conceptSchemesTable,
      eq(conceptSchemesTable.id, conceptsTable.schemeId)
    )
    .where(
      and(
        eq(conceptSchemesTable.slug, schemeSlug),
        eq(conceptsTable.slug, conceptSlug)
      )
    )
    .limit(1)
  return row ?? null
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ scheme: string; concept: string }>
}): Promise<Metadata> {
  const { scheme, concept } = await params
  const row = await loadConcept(scheme, concept)
  return { title: row ? `${row.label} | ${SITE_NAME}` : SITE_NAME }
}

export default async function ConceptPage({
  params
}: {
  params: Promise<{ scheme: string; concept: string }>
}) {
  const { scheme, concept: conceptSlug } = await params
  const concept = await loadConcept(scheme, conceptSlug)
  if (!concept) notFound()

  if (concept.status === "retired" && concept.replacedById !== null) {
    const [replacement] = await db
      .select({
        slug: conceptsTable.slug,
        schemeSlug: conceptSchemesTable.slug
      })
      .from(conceptsTable)
      .innerJoin(
        conceptSchemesTable,
        eq(conceptSchemesTable.id, conceptsTable.schemeId)
      )
      .where(eq(conceptsTable.id, concept.replacedById))
      .limit(1)
    if (replacement)
      permanentRedirect(conceptPath(replacement.schemeSlug, replacement.slug))
  }

  const iri = conceptUri(concept.schemeSlug, concept.slug)

  if (concept.status === "retired") {
    return (
      <main className="max-w-2xl mx-auto w-full px-4 py-8 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Link href={conceptSchemePath(concept.schemeSlug)}>
            {concept.schemeTitle}
          </Link>
        </p>
        <h1 className="text-2xl font-bold">{concept.label}</h1>
        <p className="text-sm text-muted-foreground">
          This tag has been retired. It is kept so its identifier still
          resolves; nothing is filed under it.
        </p>
        <code className="text-sm font-mono text-muted-foreground break-all select-all">
          {iri}
        </code>
      </main>
    )
  }

  const [relations, mappings, facetTerms, taggedDefinitions] =
    await Promise.all([
      conceptRelations(concept.id),
      db
        .select({
          predicate: statementsTable.predicate,
          iri: statementsTable.objectIri,
          termSlug: termsTable.slug,
          termLabel: termsTable.term
        })
        .from(statementsTable)
        .leftJoin(termsTable, eq(termsTable.id, statementsTable.objectTermId))
        .where(
          and(
            eq(statementsTable.subjectConceptId, concept.id),
            isNull(statementsTable.retractedAt)
          )
        )
        .orderBy(asc(statementsTable.id)),
      db
        .select({
          id: termsTable.id,
          term: termsTable.term,
          slug: termsTable.slug
        })
        .from(statementsTable)
        .innerJoin(termsTable, eq(termsTable.id, statementsTable.subjectTermId))
        .where(
          and(
            eq(statementsTable.predicate, "dcterms:subject"),
            eq(statementsTable.objectConceptId, concept.id),
            isNull(statementsTable.retractedAt)
          )
        )
        .orderBy(asc(termsTable.term)),
      db
        .select({ definition: definitionsTable, term: termsTable })
        .from(statementsTable)
        .innerJoin(
          definitionsTable,
          eq(definitionsTable.id, statementsTable.subjectDefinitionId)
        )
        .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
        .where(
          and(
            eq(statementsTable.predicate, "dcterms:subject"),
            eq(statementsTable.objectConceptId, concept.id),
            isNull(statementsTable.retractedAt)
          )
        )
        .orderBy(asc(termsTable.term), asc(definitionsTable.definitionNumber))
    ])

  const mappingRows = mappings.filter(
    (m): m is (typeof mappings)[number] & { iri: string } =>
      m.iri !== null &&
      (MAPPING_PREDICATES as readonly string[]).includes(m.predicate)
  )
  // The bridge: this tag and that term are the same concept. One at most.
  const bridge = mappings.find(
    (m) => m.predicate === "skos:exactMatch" && m.termSlug !== null
  )

  return (
    <main className="max-w-2xl mx-auto w-full px-4 py-8 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Link href={conceptSchemePath(concept.schemeSlug)}>
          {concept.schemeTitle}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{concept.label}</h1>
      {concept.definition && (
        <p className="text-muted-foreground">{concept.definition}</p>
      )}
      {concept.scopeNote && (
        <p className="text-sm text-muted-foreground">
          <span className="text-xs font-semibold uppercase tracking-[0.12em]">
            Scope
          </span>{" "}
          {concept.scopeNote}
        </p>
      )}
      {concept.altLabels.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Also known as {concept.altLabels.join(", ")}
        </p>
      )}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          IRI
        </span>
        <code className="text-sm font-mono text-muted-foreground break-all select-all">
          {iri}
        </code>
      </div>
      {/* The bridge, if this tag is also a term of the vocabulary. Rendered
          before the external mappings because it is the same concept rather
          than a correspondence to another vocabulary. */}
      {bridge && bridge.termSlug && (
        <p className="text-sm text-muted-foreground">
          Also a term in this vocabulary:{" "}
          <Link
            href={termPath(bridge.termSlug)}
            className="font-serif text-base text-primary"
          >
            {bridge.termLabel}
          </Link>
        </p>
      )}
      {/* Curated knowledge-organization layer: a concept may assert SKOS
          mappings to classes in external ontologies (see lib/kos.ts) */}
      {mappingRows.map((m) => (
        <p
          key={`${m.predicate}-${m.iri}`}
          className="text-sm text-muted-foreground"
        >
          {m.predicate}{" "}
          <a
            href={m.iri}
            className="text-primary font-mono break-all"
            rel="noreferrer"
          >
            {m.iri}
          </a>
        </p>
      ))}

      {(relations.broader.length > 0 || relations.narrower.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Broader and narrower</h2>
          {relations.broader.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Broader:{" "}
              {relations.broader.map((related, index) => (
                <span key={related.id}>
                  {index > 0 && ", "}
                  <Link
                    href={conceptPath(concept.schemeSlug, related.slug)}
                    className="text-primary"
                  >
                    {related.label}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {relations.narrower.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Narrower:{" "}
              {relations.narrower.map((related, index) => (
                <span key={related.id}>
                  {index > 0 && ", "}
                  <Link
                    href={conceptPath(concept.schemeSlug, related.slug)}
                    className="text-primary"
                  >
                    {related.label}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      {facetTerms.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Terms</h2>
          <ul className="flex flex-wrap gap-2">
            {facetTerms.map((t) => (
              <li key={t.id}>
                <Link
                  href={termPath(t.slug)}
                  className="inline-block rounded-md border px-3 py-1 font-serif text-sm hover:text-primary"
                >
                  {t.term}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* A facet reaches terms and a topic reaches definitions, so one of
          these two sections is always empty. Render only the one with
          something in it. */}
      {taggedDefinitions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            Definitions tagged with {concept.label}
          </h2>
          {taggedDefinitions.map(({ definition, term }) => (
            <Link
              key={definition.id}
              href={definitionPath(term.slug, definition.definitionNumber)}
            >
              <Card className="!p-2">
                <h3 className="font-serif text-lg font-semibold">
                  {term.term}
                </h3>
                <TermDefinition definition={definition} />
              </Card>
            </Link>
          ))}
        </section>
      )}

      {taggedDefinitions.length === 0 && facetTerms.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing is filed under this tag yet.
        </p>
      )}
    </main>
  )
}
