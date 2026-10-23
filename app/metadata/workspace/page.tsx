import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { db, communitiesTable } from "@yamz/db"
import { eq } from "drizzle-orm"
import { getCurrentUser } from "@/lib/current-user"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { matcoreProfileSchema } from "@/lib/matcore-workflow-types"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { CommunityWork } from "@/components/communities/community-work"
import { workspaceDestination } from "@/components/metadata-workspace/workspace-presenters"

export const metadata: Metadata = { title: `Choose a workspace | ${SITE_NAME}` }

export default async function MetadataWorkspacePage({
  searchParams
}: {
  searchParams: Promise<{
    vocabularySlug?: string
    profile?: string
    offset?: string
  }>
}) {
  const params = await searchParams
  if (
    params.vocabularySlug &&
    !/^[a-z0-9][a-z0-9_-]{0,199}$/.test(params.vocabularySlug)
  )
    notFound()
  if (params.profile && !matcoreProfileSchema.safeParse(params.profile).success)
    notFound()
  if (
    params.offset &&
    (!/^\d+$/.test(params.offset) || Number(params.offset) > 10000)
  )
    notFound()
  if (params.vocabularySlug) {
    const [community] = await db
      .select({ slug: communitiesTable.slug })
      .from(communitiesTable)
      .where(eq(communitiesTable.vocabularySlug, params.vocabularySlug))
      .limit(1)
    if (community) {
      const query = new URLSearchParams({ view: "work" })
      if (params.profile) query.set("profile", params.profile)
      if (params.offset) query.set("offset", params.offset)
      redirect(`/communities/${community.slug}?${query}`)
    }
  }
  const user = await getCurrentUser()
  const workPath = params.vocabularySlug
    ? `/metadata/workspace?vocabularySlug=${encodeURIComponent(params.vocabularySlug)}`
    : "/metadata/workspace"
  if (!user) redirect(authPathWithReturnTo("/login", workPath))
  const options = await trpc.setup.options()
  const destination = options.vocabularies.find(
    (item) => item.slug === params.vocabularySlug
  )
  if (params.vocabularySlug && !destination) notFound()
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-4 py-8 sm:px-6">
      {destination ? (
        <>
          <header className="flex flex-col gap-2">
            <Link className="text-sm underline" href="/metadata/workspace">
              All workspaces
            </Link>
            <h1 className="text-3xl font-semibold">{destination.title}</h1>
            <p className="text-muted-foreground">
              Workspace for this standalone vocabulary.
            </p>
          </header>
          <CommunityWork
            vocabularySlug={destination.slug}
            workPath={workPath}
            profile={params.profile}
            offset={params.offset}
          />
        </>
      ) : (
        <>
          <header className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold">Choose a workspace</h1>
            <p className="text-muted-foreground">
              Work within a community or standalone vocabulary. Each workspace
              keeps its own destination; your drafts remain private.
            </p>
          </header>
          <ul className="divide-y rounded-lg border">
            {options.vocabularies.map((item) => (
              <li key={item.slug}>
                <Link
                  className="flex flex-col gap-1 p-4 hover:bg-accent"
                  href={workspaceDestination(item, options.communities)}
                >
                  <span className="font-medium">{item.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {item.communityId
                      ? "Community workspace"
                      : "Standalone vocabulary"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link className="text-sm underline" href="/communities">
            Browse communities
          </Link>
        </>
      )}
    </main>
  )
}
