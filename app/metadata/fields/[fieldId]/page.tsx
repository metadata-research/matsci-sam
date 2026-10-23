import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getCurrentUser } from "@/lib/current-user"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { PublishedField } from "@/components/metadata-workspace/published-field"

export const metadata: Metadata = {
  title: `Metadata field proposal | ${SITE_NAME}`
}

export default async function PublishedMetadataFieldPage({
  params,
  searchParams
}: {
  params: Promise<{ fieldId: string }>
  searchParams: Promise<{ revision?: string }>
}) {
  const [{ fieldId }, search, user] = await Promise.all([
    params,
    searchParams,
    getCurrentUser()
  ])
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(fieldId) || (search.revision && !uuid.test(search.revision)))
    notFound()
  const record = await trpc.matcoreWorkflow
    .getField({ id: fieldId, revisionId: search.revision })
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === "NOT_FOUND") notFound()
      throw error
    })
  const workspaceHref = record.community
    ? `/communities/${record.community.slug}?view=work`
    : `/metadata/workspace?vocabularySlug=${encodeURIComponent(record.field.vocabularySlug)}`
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PublishedField
        key={`${record.field.id}:${record.selectedRevisionId}:${user?.id ?? "public"}`}
        record={record}
        userId={user?.id ?? null}
        isAdmin={user?.role === "admin"}
        workspaceHref={workspaceHref}
      />
    </main>
  )
}
