import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { collectionsIndexPath, vocabularyPath } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import { allVocabularies } from "@/app/vocabulary/_data"

export const metadata: Metadata = {
  title: `Vocabularies | ${SITE_NAME}`,
  description: "Named vocabularies of terms and definitions on MatSci-SAM."
}

export default async function VocabulariesPage() {
  const vocabularies = await allVocabularies()

  return (
    <main className="px-4 py-8">
      <section className="mx-auto w-full max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-4xl font-bold">Vocabularies</h1>
          <p className="text-muted-foreground">
            A vocabulary names a body of terms and their definitions. Each term
            belongs to one vocabulary.{" "}
            <Link
              href={collectionsIndexPath}
              className="text-primary hover:underline"
            >
              Collections
            </Link>{" "}
            select terms from one or more vocabularies.
          </p>
        </header>

        {vocabularies.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {vocabularies.map((vocabulary) => (
              <li key={vocabulary.slug}>
                <Link
                  href={vocabularyPath(vocabulary.slug)}
                  className="block h-full rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{vocabulary.title}</span>
                    {vocabulary.isDefault ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : null}
                    {vocabulary.retiredAt ? (
                      <Badge variant="outline">Retired</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {vocabulary.count === 1
                      ? "1 term"
                      : `${vocabulary.count} terms`}
                  </p>
                  {vocabulary.description ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {vocabulary.description}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No vocabularies have been created.
          </p>
        )}
      </section>
    </main>
  )
}
