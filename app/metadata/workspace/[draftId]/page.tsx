import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/current-user"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { FieldEditor } from "@/components/metadata-workspace/field-editor"
import {
  normalizeMatcoreCatalogReturnTo,
  withMatcoreCatalogReturn
} from "@/lib/matcore-catalog-navigation"
import {
  communityWorkReturn,
  normalizeCommunityWorkReturnTo,
  withCommunityWorkReturn
} from "@/lib/community-work-return"

export const metadata: Metadata = {
  title: `Metadata field draft | ${SITE_NAME}`
}

export default async function MetadataFieldDraftPage({
  params,
  searchParams
}: {
  params: Promise<{ draftId: string }>
  searchParams: Promise<{ returnTo?: string }>
}) {
  const [{ draftId }, query, user] = await Promise.all([
    params,
    searchParams,
    getCurrentUser()
  ])
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      draftId
    )
  )
    notFound()
  if (!user)
    redirect(
      authPathWithReturnTo(
        "/login",
        normalizeMatcoreCatalogReturnTo(query.returnTo)
          ? withMatcoreCatalogReturn(
              `/metadata/workspace/${draftId}`,
              query.returnTo!
            )
          : withCommunityWorkReturn(
              `/metadata/workspace/${draftId}`,
              normalizeCommunityWorkReturnTo(query.returnTo)
            )
      )
    )
  const draft = await trpc.matcoreWorkflow
    .getDraft({ id: draftId })
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === "NOT_FOUND") notFound()
      throw error
    })
  const workReturn = communityWorkReturn(
    draft.community,
    query.returnTo,
    `/metadata/workspace?vocabularySlug=${encodeURIComponent(draft.vocabularySlug)}`,
    "my-field-drafts"
  )
  const catalogReturn =
    draft.community && draft.sourceOccurrenceId
      ? normalizeMatcoreCatalogReturnTo(query.returnTo, {
          communitySlug: draft.community.slug,
          releaseId: draft.profileReleaseId,
          source: draft.sourceOccurrenceId
        })
      : null
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <FieldEditor
        key={`${user.id}:${draft.id}`}
        initial={draft}
        workspaceHref={catalogReturn ?? workReturn.href}
        workspaceLabel={
          catalogReturn
            ? catalogReturn.includes("standard=reference")
              ? "Back to reference"
              : catalogReturn.includes("standard=release")
                ? "Back to community release"
                : "Back to working version"
            : draft.community
              ? workReturn.label
              : "My field drafts"
        }
      />
    </main>
  )
}
