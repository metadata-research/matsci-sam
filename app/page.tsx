import { SearchSection } from "./search-section"
import { HydrateClient, trpc } from "@/trpc/server"
import Link from "next/link"
import { OAuthURL } from "@/lib/apis/google"
import { Icon } from "@iconify/react"
import { db, definitionsTable, termsTable } from "@yamz/db"
import { desc, eq, sql } from "drizzle-orm"
import { getSession } from "@/lib/session"
import { lightFormat } from "date-fns"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default async function Home() {
  await trpc.search.definitions.prefetch({ query: "", limit: 4 })
  const sesh = await getSession()

  const latestTerms = await db
    .select({
      id: termsTable.id,
      term: termsTable.term,
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
              Welcome to the MatSci YAMZ
            </h1>
            <p className="text-muted-foreground">
              The collaborative dictionary for materials science metadata.
              Designed for researchers and professionals, YAMZ provides a
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
            <div className="flex flex-wrap items-center gap-3">
              <SearchSection hideResults />
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
            <div className="h-px bg-border mb-2" />
            <ul>
              {latestTerms.map(({ id, term, count, createdAt }) => (
                <li key={id}>
                  <Link
                    href={`/terms/${id}`}
                    className="flex items-baseline gap-2 rounded-md px-3 py-2 hover:bg-accent transition-colors"
                  >
                    <span className="font-serif text-lg">{term}</span>
                    <span className="text-sm text-muted-foreground">
                      ({count})
                    </span>
                    <span className="ml-auto text-sm text-muted-foreground">
                      added {lightFormat(createdAt, "yyyy/MM/dd")}
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
                <CardContent className="space-y-3">
                  <span className="text-primary">
                    <Icon icon="lets-icons:upload" width={44} height={44} />
                  </span>
                  <div className="text-lg font-semibold">
                    Contribute a Definition
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Explore the growing dictionary of materials science
                    metadata. Search for definitions across materials,
                    properties, and processes. See how experts describe and
                    organize key scientific concepts. Compare community
                    contributions and discover related terms. Learn from
                    real-world examples and evolving terminology in the field.
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/terms" className="block">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardContent className="space-y-3">
                  <span className="text-foreground">
                    <Icon icon="ri:book-fill" width={44} height={44} />
                  </span>
                  <div className="text-lg font-semibold">View All Terms</div>
                  <p className="text-sm text-muted-foreground">
                    Explore the growing dictionary of materials science
                    metadata. Search for definitions across materials,
                    properties, and processes. See how experts describe and
                    organize key scientific concepts. Compare community
                    contributions and discover related terms. Engage with the
                    community by critiquing definitions, appraising or
                    debating terms, and contributing to consensus on materials
                    science metadata.
                  </p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/terms" className="block">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardContent className="space-y-3">
                  <span className="text-ai">
                    <Icon
                      icon="tdesign:cooperate-filled"
                      width={44}
                      height={44}
                    />
                  </span>
                  <div className="text-lg font-semibold">
                    Join the Discussion
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Support the growth of the materials science metadata
                    community. Review and critique existing definitions for
                    clarity and precision. Appraise and discuss differing
                    viewpoints to strengthen shared understanding. Provide
                    references or datasets that enrich term accuracy and
                    context. Collaborate toward consensus to advance
                    standardization in materials science metadata.
                  </p>
                </CardContent>
              </Card>
            </Link>
          </section>

          {/* About */}
          <section className="space-y-4">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              About Us
            </span>
            <h2 className="text-2xl font-semibold font-serif">Who We Are</h2>
            <p className="text-muted-foreground">
              MatSci YAMZ is a community-driven initiative from Drexel
              University&apos;s Metadata Research Center that standardizes the
              complex language of materials science to accelerate global
              discovery. By integrating expert crowdsourcing with
              human-in-the-loop AI, the platform provides a collaborative
              &ldquo;Metadata Zoo&rdquo; where researchers define, discuss,
              and vote on terminology in real time. This ensures that
              scientific data adheres to FAIR principles, making it Findable,
              Accessible, Interoperable, and Reusable for both human
              researchers and machine-learning applications.
            </p>

            <hr />

            <h3 className="text-xl font-semibold font-serif">
              Mission Statement
            </h3>
            <p className="text-muted-foreground">
              The mission of MatSci-YAMZ is to strengthen the semantic
              infrastructure across materials science by providing a
              collaborative, AI-supported space for defining and refining
              disciplinary terminology. The MatSci-YAMZ hybrid model
              integrates crowdsourcing and human-in-the-loop AI, and enables
              researchers to collaboratively build and vote on persistent
              controlled vocabulary terms. MatSci-YAMZ supports semantic
              transparency and advances metadata standards development,
              interdisciplinary communication, and AI-ready research.
            </p>

            <hr />

            <h3 className="text-xl font-semibold font-serif">Our Team</h3>
            <div className="flex gap-4 items-start">
              <img
                src="https://drexel.edu/~/media/Images/cci/Faculty/Greenberg_Small.ashx?h=188&w=124&hash=0D28C7AE5AE230487F8321021C6263F290601CA5"
                alt="Jane Greenberg"
                className="rounded-md w-[110px] shrink-0"
              />
              <p className="text-muted-foreground">
                Jane Greenberg is the Alice B. Kroeger Professor and Director
                of the{" "}
                <Link
                  href="https://mrc.cci.drexel.edu/"
                  className="text-primary"
                >
                  Metadata Research Center
                </Link>{" "}
                at the College of Computing &amp; Informatics, Drexel
                University. Her research activities focus on metadata,
                knowledge organization/semantics, linked data, data science,
                and information economics. She serves on the advisory board of
                the Dublin Core Metadata Initiative (DCMI) and the steering
                committee for the NSF Northeast Big Data Innovation Hub
                (NEBDIH).
              </p>
            </div>

            <div className="flex gap-4 items-start">
              <p className="text-muted-foreground">
                Scott McClellan is a doctoral candidate at Drexel University
                studying materials science researchers{"'"} use of metadata in
                repositories. He also works with ontologies and controlled
                vocabulary construction to improve FAIR-ness of data for
                scientific research. Prior to coming to Drexel, he studied
                modern American poetry and literature.
              </p>
              <img
                src="https://drexel.edu/~/media/Images/cci/PhDStudents/McClellan_Scott_sitecore.ashx?h=167&w=110&hash=259783F2DD86B998AF4A45E9449D4882B7DE8078"
                alt="Scott McClellan"
                className="rounded-md w-[110px] shrink-0"
              />
            </div>

            <p className="text-muted-foreground">
              Learn more about our team at the{" "}
              <Link href="https://mrc.cci.drexel.edu/" className="text-primary">
                Metadata Research Center
              </Link>
              .
            </p>
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
