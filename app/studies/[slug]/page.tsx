import { cache } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import { studyBySlug } from "@/lib/study-queries"
import { studyState } from "@/lib/communities"
import { getCurrentUser } from "@/lib/current-user"
import {
  collectionPath,
  communityPath,
  studyRunPath
} from "@/lib/public-identifiers"
import { formatDate } from "@/lib/date"
import { studyWindowExplanation } from "@/lib/study-presentation"
import { trpc } from "@/trpc/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { studyActivityActionLabel } from "@/components/studies/progress"
import { StudyActionButton } from "@/components/studies/action-button"

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
 * reminder email, so it stays public and stays put. It provides context and
 * entry to the activity; the activity presents its instructions as step 1.
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

  const activityActionLabel = walks
    ? studyActivityActionLabel(
        walks.completedStepIds.length,
        walks.resumePosition,
        walks.steps.length
      )
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
              Study activity
            </div>
            {activityActionLabel ? (
              <>
                {walks.completedStepIds.length === 0 && (
                  <p className="text-sm">
                    {walks.steps.length} steps. Your place is kept between
                    visits.
                  </p>
                )}
                <StudyActionButton href={studyRunPath(study.slug)}>
                  {activityActionLabel}
                </StudyActionButton>
              </>
            ) : (
              <>
                <p className="text-sm">You have finished the study activity.</p>
                <Button asChild variant="outline">
                  <Link href={studyRunPath(study.slug)}>
                    Review completed study
                  </Link>
                </Button>
              </>
            )}
          </section>
        )}

        {/* Why the walkthrough card is absent, which the card itself cannot
            say. A signed-out reader is told how to take part; a reader who
            is signed in but outside the community is told that is the
            reason. */}
        {!walks && state === "open" && study.steps > 0 && !user && (
          <section className="space-y-3 rounded-md border border-border p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Study activity
            </div>
            <p className="text-sm">
              {study.steps} steps. Sign in to take part. Your place is kept
              between visits.
            </p>
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </section>
        )}

        {!walks &&
          state === "open" &&
          study.steps > 0 &&
          user &&
          walkthrough !== null &&
          walkthrough.membership === null && (
            <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              The study activity is for members of {study.communityTitle}. An
              invitation from the community is the way in.
            </p>
          )}

        {state === "retired" && (
          <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
            This study has been retired. Its address still resolves, and what
            the cohort contributed is still in the vocabulary.
          </p>
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
              {studyWindowExplanation(study.steps)}
            </p>
          </section>
        )}

        {activityActionLabel && (
          <div className="border-t border-border pt-6">
            <StudyActionButton href={studyRunPath(study.slug)}>
              {activityActionLabel}
            </StudyActionButton>
          </div>
        )}
      </section>
    </main>
  )
}
