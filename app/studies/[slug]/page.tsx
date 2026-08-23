import { cache } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import { agreedDefinitions, studyBySlug } from "@/lib/study-queries"
import { studyState } from "@/lib/communities"
import { getCurrentUser } from "@/lib/current-user"
import {
  collectionPath,
  communityPath,
  definitionPath,
  studyRunPath,
  termPath
} from "@/lib/public-identifiers"
import { formatDate } from "@/lib/date"
import { trpc } from "@/trpc/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PublicProfileName } from "@/components/public-profile-name"

// Shared by generateMetadata and the body, so the page runs one query.
const loadStudy = cache(async (slug: string) => studyBySlug(slug))

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const study = await loadStudy(slug)

  return { title: study ? `${study.title} | ${SITE_NAME}` : SITE_NAME }
}

const STATE_LABEL = {
  draft: "Not open yet",
  open: "Open",
  closed: "Closed",
  retired: "Retired"
} as const

/*
 * A study, as its participants read it. This is the address that goes in a
 * reminder email, so it stays public and stays put: the instructions have to
 * be reachable a week after the invitation link was spent.
 *
 * The cohort is not listed here. Who is in a community is visible to its
 * members and to administrators, and routing round that rule through a study
 * page would publish exactly what it protects.
 */
export default async function StudyPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const study = await loadStudy(slug)
  if (!study) notFound()

  const state = studyState(study)

  // The walkthrough as this viewer sees it, for the resume card. A
  // signed-out viewer has no progress to resume, so nothing is read.
  const user = await getCurrentUser()
  const walkthrough = user ? await trpc.surveys.get({ studySlug: slug }) : null
  const walks =
    walkthrough !== null &&
    walkthrough.membership !== null &&
    state === "open" &&
    walkthrough.steps.length > 0
      ? walkthrough
      : null

  // The agreed definition of each term, for any study with terms. A closed
  // study shows the outcome of its round, the votes as they stood when it
  // closed; any other shows the list as it stands.
  const closedOn =
    state === "closed" && study.closesAt ? formatDate(study.closesAt) : null
  const outcome = await agreedDefinitions(
    study.collectionId,
    closedOn ? study.closesAt : null
  )
  const agreedNote = closedOn
    ? `The study closed on ${closedOn}.`
    : state === "open" && study.steps > 0
      ? "The list moves as positions are taken."
      : null

  return (
    <main className="px-4 py-8">
      <section className="max-w-3xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Study
          </div>
          <h1 className="text-4xl font-bold">{study.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{STATE_LABEL[state]}</Badge>
            <span>
              Run by{" "}
              <Link
                href={communityPath(study.communitySlug)}
                className="text-primary"
              >
                {study.communityTitle}
              </Link>
            </span>
          </div>
        </div>

        {walks && (
          <section className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Walkthrough
            </div>
            {walks.completedStepIds.length === 0 ? (
              <>
                <p className="text-sm">
                  {walks.steps.length} steps. Your place is kept between visits.
                </p>
                <Button asChild>
                  <Link href={studyRunPath(study.slug)}>
                    Start the walkthrough
                  </Link>
                </Button>
              </>
            ) : walks.resumePosition !== null ? (
              <Button asChild>
                <Link href={studyRunPath(study.slug)}>
                  Continue (step {walks.resumePosition} of {walks.steps.length})
                </Link>
              </Button>
            ) : (
              <>
                <p className="text-sm">You have finished the walkthrough.</p>
                <Button asChild variant="outline">
                  <Link href={studyRunPath(study.slug)}>
                    Open the walkthrough
                  </Link>
                </Button>
              </>
            )}
          </section>
        )}

        {state === "retired" && (
          <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
            This study has been retired. Its address still resolves, and what
            the cohort contributed is still in the vocabulary.
          </p>
        )}

        {study.welcome ? (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">What to do</h2>
            {/* Plain text, split on blank lines. Nothing typed here becomes
                markup, which is why the column is not markdown. */}
            {study.welcome.split(/\n\s*\n/).map((paragraph, index) => (
              <p key={index} className="whitespace-pre-line">
                {paragraph}
              </p>
            ))}
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">
            No instructions have been written for this study yet.
          </p>
        )}

        {outcome.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">
              {closedOn ? "Agreed" : "Agreed so far"}
            </h2>
            <p className="text-sm text-muted-foreground">
              For each term, the definition with the most support is the
              group&apos;s agreed definition{closedOn ? "" : " so far"}. A tie
              goes to the earlier candidate.
              {agreedNote && ` ${agreedNote}`}
            </p>
            <ol className="space-y-3">
              {outcome.map((term) => (
                <li
                  key={term.id}
                  className="space-y-2 rounded-md border border-border p-4"
                >
                  <Link
                    href={termPath(term.slug)}
                    className="block text-lg font-bold font-serif"
                  >
                    {term.term}
                  </Link>
                  {term.agreed ? (
                    <>
                      <p>{term.agreed.definition}</p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <PublicProfileName
                          user={term.agreed.author}
                          fallback="Unknown contributor"
                        />
                        <Link
                          href={definitionPath(
                            term.slug,
                            term.agreed.definitionNumber
                          )}
                          className="hover:underline"
                        >
                          Definition {term.agreed.definitionNumber}
                        </Link>
                        <span>Support {term.agreed.support}</span>
                        <span>
                          {term.alternatives === 0
                            ? "No alternative"
                            : term.alternatives === 1
                              ? "1 alternative"
                              : `${term.alternatives} alternatives`}
                        </span>
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No candidate yet.
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-xl font-semibold">The terms</h2>
          <p className="text-sm text-muted-foreground">
            This study works through{" "}
            <Link
              href={collectionPath(study.collectionSlug)}
              className="text-primary"
            >
              {study.collectionTitle}
            </Link>
            . Members of {study.communityTitle} who are working in it see those
            terms on Browse and Collections.
          </p>
        </section>

        {(study.opensAt || study.closesAt) && (
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">When</h2>
            <p className="text-sm text-muted-foreground">
              {study.opensAt && `Opens ${formatDate(study.opensAt)}. `}
              {study.closesAt && `Closes ${formatDate(study.closesAt)}. `}
              The dates say when the work is expected. Nothing is locked when
              they pass, and an invitation to a closed study stops working.
            </p>
          </section>
        )}
      </section>
    </main>
  )
}
