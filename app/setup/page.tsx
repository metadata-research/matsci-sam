import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SITE_NAME } from "@/lib/site"
import { setupTasks, type SetupTask } from "@/lib/guided-setup"
import { trpc } from "@/trpc/server"
import { GuidedSetup } from "./setup-workspace"
import {
  communityWorkReturn,
  normalizeCommunityWorkReturnTo
} from "@/lib/community-work-return"

export const metadata: Metadata = {
  title: `Quick start & guided setup | ${SITE_NAME}`
}

export default async function SetupPage({
  searchParams
}: {
  searchParams: Promise<{
    task?: string
    communityId?: string
    vocabularySlug?: string
    draftId?: string
    returnTo?: string
  }>
}) {
  const [params, options] = await Promise.all([
    searchParams,
    trpc.setup.options()
  ])
  const task = setupTasks.includes(params.task as SetupTask)
    ? (params.task as SetupTask)
    : undefined
  if (
    params.draftId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.draftId
    )
  )
    notFound()
  const communityId = Number(params.communityId)
  if (
    params.communityId &&
    (!Number.isSafeInteger(communityId) || communityId <= 0)
  )
    notFound()
  if (
    params.vocabularySlug &&
    (typeof params.vocabularySlug !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,199}$/.test(params.vocabularySlug))
  )
    notFound()
  const community = options.communities.find((item) => item.id === communityId)
  const vocabulary = options.vocabularies.find(
    (item) => item.slug === params.vocabularySlug
  )
  const destination =
    vocabulary ??
    options.vocabularies.find(
      (item) =>
        item.slug ===
        (community?.vocabularySlug ?? options.defaultVocabularySlug)
    )
  const destinationCommunity =
    community ??
    options.communities.find((item) => item.id === destination?.communityId)
  const draftKey = `${task ?? "guided"}:${params.communityId ?? ""}:${params.vocabularySlug ?? ""}`
  const returnParams = new URLSearchParams()
  if (task) returnParams.set("task", task)
  if (params.communityId) returnParams.set("communityId", params.communityId)
  if (params.vocabularySlug)
    returnParams.set("vocabularySlug", params.vocabularySlug)
  if (params.draftId) returnParams.set("draftId", params.draftId)
  const requestedWorkReturn = normalizeCommunityWorkReturnTo(params.returnTo)
  if (requestedWorkReturn) returnParams.set("returnTo", requestedWorkReturn)
  const workspaceReturn = destinationCommunity
    ? communityWorkReturn(
        destinationCommunity,
        requestedWorkReturn,
        undefined,
        task === "import" ? "term-imports" : "term-drafts"
      )
    : undefined
  return (
    <main className="px-4 py-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <GuidedSetup
          key={`${draftKey}:${params.draftId ?? ""}`}
          draftKey={draftKey}
          draftId={params.draftId}
          returnTo={returnParams.size ? `/setup?${returnParams}` : "/setup"}
          workspaceReturn={workspaceReturn}
          options={options}
          task={task}
          communityId={
            params.communityId ? communityId : destinationCommunity?.id
          }
          vocabularySlug={
            params.vocabularySlug ??
            destination?.slug ??
            options.defaultVocabularySlug
          }
        />
      </div>
    </main>
  )
}
