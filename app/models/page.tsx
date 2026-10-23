import { readableTermId } from "@/lib/community-access"
import { currentContentViewer } from "@/lib/content-access"
import type { Metadata } from "next"
import Link from "next/link"
import { SparklesIcon } from "lucide-react"
import { aiModelsTable, db, definitionsTable, usersTable } from "@yamz/db"
import { and, countDistinct, eq } from "drizzle-orm"
import { SITE_NAME } from "@/lib/site"
import { modelPath } from "@/lib/public-identifiers"
import { listedTermId } from "@/lib/term-visibility"
import { snapshotAssistantConfigs } from "@/lib/llm/assistant-profiles"
import { modelIdentity } from "@/lib/llm/model-identity"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/*
 * Include supported assistants before they have a recorded contribution.
 * Only registered identities have profile links and definition counts.
 * Counts include model-authored definitions, not assisted submissions.
 */

export const metadata: Metadata = {
  title: `AI models | ${SITE_NAME}`,
  description: `Explore AI assistants, vocabulary-trained search, and upcoming vocabulary creation in ${SITE_NAME}.`
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
      and(
        eq(definitionsTable.authorId, aiModelsTable.userId),
        listedTermId(definitionsTable.termId),
        readableTermId(definitionsTable.termId, await currentContentViewer())
      )
    )
    .groupBy(aiModelsTable.userId, usersTable.name)
    .orderBy(usersTable.name)

  const configuredModel = snapshotAssistantConfigs().defaultConfig?.model
  const supportedTags = new Set([
    "wolfram-agent-one",
    ...(configuredModel ? [configuredModel] : [])
  ])
  const recordedTags = new Set(models.map((model) => model.tag))
  const entries = [
    ...models.map((model) => ({
      ...model,
      href: modelPath(model.slug)
    })),
    ...[...supportedTags]
      .filter((tag) => !recordedTags.has(tag))
      .map((tag) => {
        const identity = modelIdentity(tag)
        return {
          ...identity,
          name: identity.displayName,
          retiredAt: null,
          definitions: null,
          href: null
        }
      })
  ].sort((a, b) => (a.name ?? a.tag).localeCompare(b.name ?? b.tag))

  return (
    <main className="px-4 py-8">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-ai">
            <SparklesIcon className="size-3.5" aria-hidden />
            Models &amp; tools
          </span>
          <h1 className="text-4xl font-bold">AI models</h1>
        </div>

        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Model author:</strong> The model
            writes the original entry and gets author credit.
          </p>
          <p>
            <strong className="text-foreground">AI assistant:</strong> A model
            helps you write. You remain the author, and the model&apos;s help is
            credited.
          </p>
        </div>

        <ul className="space-y-2">
          {entries.map((model) => {
            const detail = [
              model.vendor,
              model.family,
              model.parameterSize ? `${model.parameterSize} parameters` : null
            ]
              .filter(Boolean)
              .join(" · ")

            const content = (
              <>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium">
                    {model.name?.replace(/^MatBot /, "") ?? model.tag}
                  </span>
                  <code className="break-all font-mono text-sm text-muted-foreground">
                    {model.tag}
                  </code>
                </span>
                <span className="text-xs text-muted-foreground">
                  {detail}
                  {model.retiredAt && " · retired"}
                  {" · "}
                  {model.definitions === null
                    ? "AI assistant"
                    : model.definitions === 1
                      ? "1 model-authored definition"
                      : `${model.definitions} model-authored definitions`}
                </span>
              </>
            )
            const className =
              "flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between"

            return (
              <li key={model.tag}>
                {model.href ? (
                  <Link
                    href={model.href}
                    className={`${className} hover:border-primary`}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className={className}>{content}</div>
                )}
              </li>
            )
          })}
        </ul>

        <Card>
          <CardHeader className="gap-3">
            <Badge variant="outline" className="w-fit">
              Coming soon
            </Badge>
            <CardTitle>
              <h2 className="text-xl">Vocabulary-trained search</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed">
            <p>
              <strong>ChEBI LoRA</strong> is a small add-on trained on terms and
              definitions from scientific vocabularies. It adapts search models
              to help you find relevant terms by meaning, even when you use
              different words.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-3">
            <Badge variant="outline" className="w-fit">
              Coming soon
            </Badge>
            <CardTitle>
              <h2 className="text-xl">From a topic to a draft vocabulary</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">
            <p>
              Generate a draft vocabulary from a topic or source material, then
              review and refine it with your community.
            </p>
            <p className="text-muted-foreground">
              For now, try AI assistance when{" "}
              <Link
                href="/add"
                className="text-primary underline underline-offset-4"
              >
                adding a single term
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
