import { SearchSection } from "./search-section"
import { SITE_NAME } from "@/lib/site"
import { HydrateClient } from "@/trpc/server"
import Link from "next/link"
import {
  BookOpenIcon,
  FilePlus2Icon,
  MessagesSquareIcon
} from "lucide-react"
import { db, definitionsTable, termsTable } from "@yamz/db"
import { desc, eq, sql } from "drizzle-orm"
import { getSession } from "@/lib/session"
import { formatDate } from "@/lib/date"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default async function Home() {
  const sesh = await getSession()

  const latestTerms = await db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      createdAt: termsTable.createdAt,
      count: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(termsTable)
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .groupBy(termsTable.id)
    .orderBy(desc(termsTable.createdAt))
    .limit(4)

  return (
    <HydrateClient>
      <main className="px-4 py-8">
        <div className="max-w-4xl w-full mx-auto space-y-12">
          {/* Welcome */}
          <section className="space-y-4">
            <h1 className="text-4xl font-bold font-serif">
              Welcome to the {SITE_NAME}
            </h1>
            <p className="text-muted-foreground">
              {SITE_NAME}, short for Semantic Alignment and Standardization, is
              a web-based metadata dictionary developed by the{" "}
              <a
                href="https://mrc.cci.drexel.edu/"
                className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary"
              >
                Metadata Research Center at Drexel University
              </a>
              . The system uses expert crowdsourcing and human-in-the-group AI
              to develop consensus terminology for materials science.
              Consistent terminology improves the discovery and reuse of
              materials science data.
            </p>
          </section>

          {/* Get Started */}
          <section className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-2xl font-semibold font-serif">Get Started</h2>
            <p className="text-muted-foreground">
              Search the vocabulary to compare definitions and examples of
              use. Sign in to submit a term or definition, vote and comment on
              existing definitions, or request AI-assisted refinement. These
              activities help the community evaluate alternatives and develop
              consensus.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <SearchSection hideResults />
              <div className="flex items-center gap-6">
                <Separator
                  orientation="vertical"
                  className="hidden data-[orientation=vertical]:h-8 sm:block"
                />
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">or</span>
                  {sesh.id ? (
                    <Button asChild>
                      <Link href="/add">Define a term</Link>
                    </Button>
                  ) : (
                    <Button asChild>
                      <Link href="/api/login">Login</Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Latest terms */}
          <section>
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-2xl font-semibold font-serif">
                Latest terms
              </h2>
              <Link href="/terms" className="text-sm text-primary">
                Browse all terms
              </Link>
            </div>
            <Separator className="mb-2" />
            <ul>
              {latestTerms.map(({ id, term, slug, count, createdAt }) => (
                <li key={id}>
                  <Link
                    href={`/vocabulary/${slug}`}
                    className="group flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-3 py-2 hover:bg-accent transition-colors"
                  >
                    <span className="font-serif text-lg group-hover:underline">
                      {term}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {count === 1 ? "1 definition" : `${count} definitions`}
                    </span>
                    <span aria-hidden className="text-sm text-muted-foreground/50">
                      &middot;
                    </span>
                    <span className="text-sm text-muted-foreground">
                      added {formatDate(createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Process and standards */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold font-serif">
              How {SITE_NAME} Works
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              <article className="space-y-2">
                <h3 className="text-lg font-semibold">
                  Human-in-the-Group Refinement
                </h3>
                <p className="text-muted-foreground">
                  Authors can ask a locally hosted language model to revise a
                  definition or respond to feedback. The author accepts the
                  suggestion, keeps the original, or requests another pass. An
                  accepted suggestion is published as a separate definition
                  attributed to the author and the named model.
                </p>
                <Link
                  href="/docs/ai-refinement"
                  className="inline-block text-sm text-primary hover:underline"
                >
                  Read about AI refinement
                </Link>
              </article>
              <article className="space-y-2">
                <h3 className="text-lg font-semibold">
                  Metadata and Provenance
                </h3>
                <p className="text-muted-foreground">
                  Each term is published as a Simple Knowledge Organization
                  System (SKOS) record with Dublin Core attribution. W3C PROV-O
                  records comments, votes, edits, and AI-assisted revisions.{" "}
                  {SITE_NAME} publishes the content and curation history of the
                  vocabulary according to the FAIR (Findable, Accessible,
                  Interoperable, Reusable) principles. This workflow supports
                  data description and the reuse of results promoted by the
                  Materials Genome Initiative.
                </p>
                <Link
                  href="/docs/metadata-access"
                  className="inline-block text-sm text-primary hover:underline"
                >
                  View metadata and provenance documentation
                </Link>
              </article>
            </div>
          </section>

          {/* Cards */}
          <section className="grid gap-4 md:grid-cols-3">
            <Link href="/add" className="block">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardHeader className="gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <FilePlus2Icon
                        className="size-5"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </span>
                    <CardTitle className="text-lg leading-snug">
                      Contribute a Definition
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Submit a term, definition, and examples of use, or add
                    another definition to an existing term.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>

            <Link href="/terms" className="block">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardHeader className="gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <BookOpenIcon
                        className="size-5"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </span>
                    <CardTitle className="text-lg leading-snug">
                      View All Terms
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Browse the vocabulary, compare definitions, and inspect the
                    metadata and provenance published for each term.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>

            <Link href="/discussion" className="block">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardHeader className="gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <MessagesSquareIcon
                        className="size-5"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </span>
                    <CardTitle className="text-lg leading-snug">
                      Join the Discussion
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Vote and comment on definitions to help the community
                    evaluate alternatives and develop consensus.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </section>

          {/* Footer */}
          <footer className="border-t pt-6 flex flex-wrap items-center justify-between gap-6">
            <img
              src="https://mrc.cci.drexel.edu/wp-content/uploads/2020/09/MRCPrimaryTransparent-01-e1600272545375.png"
              alt="Drexel University Metadata Research Center"
              className="h-14 w-auto dark:bg-white dark:rounded-md dark:p-1"
            />
            <div className="flex items-center gap-2">
              <img
                src="/NSF_Logo.jpg"
                alt="National Science Foundation"
                className="h-12 w-auto rounded-full"
              />
              <span className="text-sm text-muted-foreground">
                OAC#2118201
              </span>
            </div>
          </footer>
        </div>
      </main>
    </HydrateClient>
  )
}
