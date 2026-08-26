import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { SparklesIcon } from "lucide-react"
import {
  aiModelsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { and, countDistinct, desc, eq, sql } from "drizzle-orm"
import { SITE_NAME } from "@/lib/site"
import { definitionPath, modelUri } from "@/lib/public-identifiers"

/*
 * A model's profile.
 *
 * A model that contributes is a user, so it appears as an author everywhere a
 * person does. This page says which model that author is: the exact tag it
 * runs under, who publishes it, and what it has contributed. The tag is the
 * identity, because a generation is only reproducible against the exact
 * version; the name above it is presentation.
 *
 * Unlike a person's profile there is no visibility setting, since a model has
 * no privacy interest to protect and cannot consent to publication.
 */

const loadModel = async (slug: string) => {
  const [row] = await db
    .select({
      userId: aiModelsTable.userId,
      slug: aiModelsTable.slug,
      tag: aiModelsTable.tag,
      vendor: aiModelsTable.vendor,
      family: aiModelsTable.family,
      parameterSize: aiModelsTable.parameterSize,
      retiredAt: aiModelsTable.retiredAt,
      name: usersTable.name
    })
    .from(aiModelsTable)
    .innerJoin(usersTable, eq(usersTable.id, aiModelsTable.userId))
    .where(eq(aiModelsTable.slug, slug))
    .limit(1)
  return row ?? null
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const model = await loadModel(slug)
  if (!model) return { title: SITE_NAME }

  return {
    title: `${model.name} | ${SITE_NAME}`,
    description: `${model.name} is the ${model.tag} model. Its ${SITE_NAME} contributions and the prompts it ran under.`
  }
}

export default async function ModelPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const model = await loadModel(slug)
  if (!model) notFound()

  const [authored, prompts] = await Promise.all([
    db
      .select({
        id: definitionsTable.id,
        definitionNumber: definitionsTable.definitionNumber,
        term: termsTable.term,
        termSlug: termsTable.slug,
        termVocabularySlug: termsTable.vocabularySlug,
        createdAt: definitionsTable.createdAt
      })
      .from(definitionsTable)
      .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
      .where(eq(definitionsTable.authorId, model.userId))
      .orderBy(desc(definitionsTable.createdAt))
      .limit(50),
    // Which prompt versions this model worked under. The hash is what makes
    // a generation reproducible when the prompt text behind a key changes.
    db
      .select({
        promptKey: definitionRevisionsTable.prompt,
        model: definitionRevisionsTable.model,
        revisions: countDistinct(definitionRevisionsTable.id)
      })
      .from(definitionRevisionsTable)
      .where(
        and(
          eq(definitionRevisionsTable.model, model.tag),
          sql`${definitionRevisionsTable.prompt} IS NOT NULL`
        )
      )
      .groupBy(definitionRevisionsTable.prompt, definitionRevisionsTable.model)
  ])

  const detail = [
    model.vendor,
    model.family,
    model.parameterSize ? `${model.parameterSize} parameters` : null
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ai">
            <SparklesIcon className="size-3.5" aria-hidden />
            Language model
          </span>
          <h1 className="text-4xl font-bold">{model.name}</h1>
          <p className="text-muted-foreground">{detail}</p>
          {model.retiredAt && (
            <p className="text-sm text-muted-foreground">
              No longer in service. Its contributions remain attributed to it.
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted-foreground">Model</span>
            <code className="font-mono select-all">{model.tag}</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted-foreground">IRI</span>
            <code className="font-mono break-all select-all">
              {modelUri(model.slug)}
            </code>
          </div>
          <p className="text-muted-foreground pt-1">
            The model name is what every revision records, so a definition can
            be traced to the exact version that produced it.
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Definitions authored
          </h2>
          {authored.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This model has not authored a definition on its own.
            </p>
          ) : (
            <ul className="space-y-2">
              {authored.map((definition) => (
                <li key={definition.id}>
                  <Link
                    href={definitionPath(
                      definition.termSlug,
                      definition.definitionNumber,
                      definition.termVocabularySlug
                    )}
                    className="flex items-baseline justify-between gap-2 rounded-lg border bg-card px-4 py-3 hover:border-primary"
                  >
                    <span className="font-serif">{definition.term}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      Definition {definition.definitionNumber}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {prompts.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Prompts it ran under
            </h2>
            <ul className="space-y-2">
              {prompts.map((prompt, index) => (
                <li
                  key={index}
                  className="rounded-lg border bg-card px-4 py-3 text-sm"
                >
                  <p className="text-muted-foreground line-clamp-3">
                    {prompt.promptKey}
                  </p>
                  <p className="text-xs text-muted-foreground pt-1">
                    {prompt.revisions === 1
                      ? "1 revision"
                      : `${prompt.revisions} revisions`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  )
}
