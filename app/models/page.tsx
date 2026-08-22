import type { Metadata } from "next"
import Link from "next/link"
import { SparklesIcon } from "lucide-react"
import {
  aiModelsTable,
  db,
  definitionsTable,
  usersTable
} from "@yamz/db"
import { countDistinct, eq } from "drizzle-orm"
import { SITE_NAME } from "@/lib/site"
import { modelPath } from "@/lib/public-identifiers"

/*
 * The models that have contributed, each under the identity its contributions
 * record. The profile page carries the detail; this index makes /models
 * resolve, so a reader arriving from a model IRI can see the whole registry.
 */

export const metadata: Metadata = {
  title: `Models | ${SITE_NAME}`,
  description: `The language models that contribute to ${SITE_NAME}, each under the exact tag that makes its work reproducible.`
}

export default async function ModelsPage() {
  const models = await db
    .select({
      slug: aiModelsTable.slug,
      tag: aiModelsTable.tag,
      vendor: aiModelsTable.vendor,
      family: aiModelsTable.family,
      parameterSize: aiModelsTable.parameterSize,
      retiredAt: aiModelsTable.retiredAt,
      name: usersTable.name,
      definitions: countDistinct(definitionsTable.id)
    })
    .from(aiModelsTable)
    .innerJoin(usersTable, eq(usersTable.id, aiModelsTable.userId))
    .leftJoin(
      definitionsTable,
      eq(definitionsTable.authorId, aiModelsTable.userId)
    )
    .groupBy(aiModelsTable.userId, usersTable.name)
    .orderBy(usersTable.name)

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ai">
            <SparklesIcon className="size-3.5" aria-hidden />
            Language models
          </span>
          <h1 className="text-4xl font-bold">Models</h1>
          <p className="text-muted-foreground">
            A model that contributes is an author with a resolvable identity.
            A revision it produced records the exact tag it ran under, so its
            work can be traced to the version responsible.
          </p>
        </div>

        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No model has contributed yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {models.map((model) => {
              const detail = [
                model.vendor,
                model.family,
                model.parameterSize
                  ? `${model.parameterSize} parameters`
                  : null
              ]
                .filter(Boolean)
                .join(" · ")

              return (
                <li key={model.slug}>
                  <Link
                    href={modelPath(model.slug)}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border bg-card px-4 py-3 hover:border-primary"
                  >
                    <span className="space-x-2">
                      <span className="font-medium">{model.name}</span>
                      <code className="font-mono text-sm text-muted-foreground">
                        {model.tag}
                      </code>
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {detail}
                      {model.retiredAt && " · retired"}
                      {" · "}
                      {model.definitions === 1
                        ? "1 definition"
                        : `${model.definitions} definitions`}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
