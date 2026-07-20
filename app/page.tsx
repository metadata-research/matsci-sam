import { SearchSection } from "./search-section"
import { SITE_NAME } from "@/lib/site"
import { HydrateClient, trpc } from "@/trpc/server"
import Link from "next/link"
import { OAuthURL } from "@/lib/apis/google"
import { Icon } from "@iconify/react"
import { db, definitionsTable, termsTable } from "@yamz/db"
import { desc, eq, sql } from "drizzle-orm"
import { getSession } from "@/lib/session"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default async function Home() {
  await trpc.search.definitions.prefetch({ query: "", limit: 4 })
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
              The collaborative dictionary for materials science metadata.
              Designed for researchers and professionals, {SITE_NAME} provides a
              shared space to define, discuss, and refine key terms used
              across the materials science community. By contributing
              definitions, commenting, and voting, you help build a living,
              community-driven vocabulary that promotes clarity,
              interoperability, and shared understanding in materials
              research.
            </p>
          </section>

          {/* Get Started */}
          <section className="rounded-lg border bg-card p-6 space-y-4">
            <h2 className="text-2xl font-semibold font-serif">Get Started</h2>
            <p className="text-muted-foreground">
              Ready to explore the language of materials science? Use the
              search bar to discover terms, browse definitions, and see how
              the community describes key concepts in materials metadata. You
              can also contribute by refining existing entries or adding new
              terms to expand the shared vocabulary.
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
                      <Link href={OAuthURL}>Login</Link>
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
                      added {format(createdAt, "MMM d, yyyy")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Cards */}
          <section className="grid gap-4 md:grid-cols-3">
            <Link href="/add" className="block">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardHeader className="gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-primary shrink-0">
                      <Icon icon="lets-icons:upload" className="size-6" />
                    </span>
                    <CardTitle className="text-lg leading-snug">
                      Contribute a Definition
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Add a new term or propose your own definition for an
                    existing one, and help expand the shared vocabulary.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>

            <Link href="/terms" className="block">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardHeader className="gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-foreground shrink-0">
                      <Icon icon="ri:book-fill" className="size-6" />
                    </span>
                    <CardTitle className="text-lg leading-snug">
                      View All Terms
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Browse the full dictionary of materials science metadata
                    and compare how the community defines each term.
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>

            <Link href="/terms" className="block">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardHeader className="gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-ai shrink-0">
                      <Icon
                        icon="tdesign:cooperate-filled"
                        className="size-6"
                      />
                    </span>
                    <CardTitle className="text-lg leading-snug">
                      Join the Discussion
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Critique and appraise existing definitions, weigh in on
                    competing viewpoints, and help build consensus.
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
