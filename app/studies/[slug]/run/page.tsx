import { cache, type ReactNode } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import { studyBySlug } from "@/lib/study-queries"
import { membershipIn } from "@/lib/community-queries"
import { getCurrentUser } from "@/lib/current-user"
import { studyState } from "@/lib/communities"
import { communityPath, studyPath } from "@/lib/public-identifiers"
import { formatDate } from "@/lib/date"
import { getQueryClient, HydrateClient, trpc } from "@/trpc/server"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Walkthrough } from "@/components/studies/walkthrough"

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
    title: study ? `Walkthrough of ${study.title} | ${SITE_NAME}` : SITE_NAME
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
              Walkthrough
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
          The walkthrough is for members of {study.communityTitle}. Sign in to
          take part.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={studyPath(study.slug)}>Open the study</Link>
          </Button>
        </div>
      </Notice>
    )

  if (!membership)
    return (
      <Notice title={study.title}>
        <p className="text-sm text-muted-foreground">
          Only members of {study.communityTitle} can take part. The person
          running it can add you or send you an invitation.
        </p>
        <Button asChild variant="outline">
          <Link href={communityPath(study.communitySlug)}>
            Open {study.communityTitle}
          </Link>
        </Button>
      </Notice>
    )

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

  await trpc.surveys.get.prefetch({ studySlug: slug })

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
      prefetched<RouterOutput["definitions"]["list"]>(
        ["definitions", "list"],
        { termId: resume.termId }
      ) ?? []
    await Promise.all(
      definitions.map((definition) =>
        trpc.comments.get.prefetch(definition.id)
      )
    )
  }

  return (
    <HydrateClient>
      <Walkthrough studySlug={slug} viewerId={user.id} />
    </HydrateClient>
  )
}
