import { cache, type ReactNode } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import { studyBySlug } from "@/lib/study-queries"
import { membershipIn } from "@/lib/community-queries"
import { getCurrentUser } from "@/lib/current-user"
import { studyState } from "@/lib/communities"
import {
  communityPath,
  studyPath,
  studyRunPath
} from "@/lib/public-identifiers"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { formatDate } from "@/lib/date"
import { getQueryClient, HydrateClient, trpc } from "@/trpc/server"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Walkthrough } from "@/components/studies/walkthrough"
import { renderDoc } from "@/lib/docs"
import { studyHelpFromHtml } from "@/lib/study-help"
import { JoinStudy } from "@/components/studies/join-study"
import { allowsStudySelfEnrollment } from "@/lib/study-protocol"

// Shared by generateMetadata and the body, so the page runs one query.
const loadStudy = cache(async (slug: string) => studyBySlug(slug))

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const study = await loadStudy(slug)

  return {
    title: study
      ? `Study activity for ${study.title} | ${SITE_NAME}`
      : SITE_NAME
  }
}

// What a prefetch put in the query client, so the page can prefetch what the
// resume step renders without running the walkthrough queries twice. The
// helpers file each query under its procedure path and its input, and the
// read is by that exact key: a partial key matches nothing.
const prefetched = <T,>(path: string[], input: unknown) =>
  getQueryClient().getQueryData([path, { input, type: "query" }]) as
    | T
    | undefined

const NOT_OPEN = {
  draft: "This study has not opened yet.",
  closed: "This study has closed.",
  retired: "This study has been retired."
} as const

// A short page in place of the walkthrough, saying why it is not shown.
const Notice = ({
  title,
  children
}: {
  title: string
  children: ReactNode
}) => (
  <main className="px-4 py-8">
    <section className="max-w-3xl w-full mx-auto">
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Study activity
            </div>
            <h1 className="text-2xl font-bold">{title}</h1>
          </div>
          {children}
        </CardContent>
      </Card>
    </section>
  </main>
)

/*
 * The walkthrough of a study, for a member of the community running it while
 * the study is open. This page decides who may walk and says why not; the
 * shell does the walking from what surveys.get returns. The router checks
 * the same rules on every write, so what is decided here is what the viewer
 * is shown, not what they may do.
 */
export default async function RunPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const study = await loadStudy(slug)
  if (!study) notFound()

  const user = await getCurrentUser()
  const membership = user
    ? await membershipIn(study.communityId, user.id)
    : null
  const state = studyState(study)

  if (!user)
    return (
      <Notice title={study.title}>
        <p className="text-sm text-muted-foreground">
          {allowsStudySelfEnrollment(study.slug)
            ? "Sign in to join this study and take part. No invitation is needed."
            : `The study activity is for members of ${study.communityTitle}. Sign in to take part.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link
              href={authPathWithReturnTo("/login", studyRunPath(study.slug))}
            >
              {allowsStudySelfEnrollment(study.slug)
                ? "Sign in to begin"
                : "Sign in"}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={studyPath(study.slug)}>Open the study</Link>
          </Button>
        </div>
      </Notice>
    )

  if (!membership && state === "open" && allowsStudySelfEnrollment(study.slug))
    return (
      <Notice title={study.title}>
        {study.steps > 0 ? (
          <JoinStudy
            studySlug={study.slug}
            communityTitle={study.communityTitle}
          />
        ) : (
          <p>The study activity is not ready yet.</p>
        )}
      </Notice>
    )

  if (!membership && !allowsStudySelfEnrollment(study.slug))
    return (
      <Notice title={study.title}>
        <p className="text-sm text-muted-foreground">
          To take part, join {study.communityTitle}. Ask the person who shared
          this study link to add you or send an invitation. If you already
          belong, check that you signed in with the account you used before.
        </p>
        <Button asChild variant="outline">
          <Link href={communityPath(study.communitySlug)}>
            Open {study.communityTitle}
          </Link>
        </Button>
      </Notice>
    )

  // A participant who finished keeps their consolidated record after the
  // study closes: the shell opens on the finished view, and every step it
  // can reach is complete, which the walkthrough renders read-only.
  if (state === "closed") {
    const [, helpGuide] = await Promise.all([
      trpc.surveys.get.prefetch({ studySlug: slug }),
      renderDoc("guide", "studies")
    ])
    const walkthrough = prefetched<RouterOutput["surveys"]["get"]>(
      ["surveys", "get"],
      { studySlug: slug }
    )
    if (
      walkthrough !== undefined &&
      walkthrough.steps.length > 0 &&
      walkthrough.completedStepIds.length === walkthrough.steps.length
    )
      return (
        <HydrateClient>
          <Walkthrough
            studySlug={slug}
            helpSections={helpGuide ? studyHelpFromHtml(helpGuide.html) : []}
          />
        </HydrateClient>
      )
  }

  if (state !== "open")
    return (
      <Notice title={study.title}>
        <p className="text-sm text-muted-foreground">
          {NOT_OPEN[state]}
          {state === "draft" && study.opensAt
            ? ` It opens ${formatDate(study.opensAt)}.`
            : ""}
        </p>
        <Button asChild variant="outline">
          <Link href={studyPath(study.slug)}>Open the study</Link>
        </Button>
      </Notice>
    )

  const [, helpGuide] = await Promise.all([
    trpc.surveys.get.prefetch({ studySlug: slug }),
    renderDoc("guide", "studies")
  ])

  // The resume step is painted first, so what it reads is prefetched too:
  // the candidates of its term and their comments, which a position step
  // and a review step both show.
  const walkthrough = prefetched<RouterOutput["surveys"]["get"]>(
    ["surveys", "get"],
    { studySlug: slug }
  )
  const resume = walkthrough?.steps.find(
    (step) => step.position === walkthrough.resumePosition
  )
  if (resume?.termId) {
    await trpc.definitions.list.prefetch({ termId: resume.termId })
    const definitions =
      prefetched<RouterOutput["definitions"]["list"]>(["definitions", "list"], {
        termId: resume.termId
      }) ?? []
    await Promise.all(
      definitions.map((definition) => trpc.comments.get.prefetch(definition.id))
    )
  }

  return (
    <HydrateClient>
      <Walkthrough
        studySlug={slug}
        helpSections={helpGuide ? studyHelpFromHtml(helpGuide.html) : []}
      />
    </HydrateClient>
  )
}
