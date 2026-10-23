import Link from "next/link"
import { notFound } from "next/navigation"
import { trpc } from "@/trpc/server"
import { getCurrentUser } from "@/lib/current-user"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { matcoreProfileSchema } from "@/lib/matcore-workflow-types"
import { WorkspaceList } from "@/components/metadata-workspace/workspace-list"
import { WorkspaceSettings } from "./workspace-settings"
import { DraftList } from "@/app/profile/drafts/draft-list"
import { Button } from "@/components/ui/button"
import { OnThisPage, type PageSection } from "@/components/on-this-page"
import { withCommunityWorkReturn } from "@/lib/community-work-return"

export async function CommunityWork({
  vocabularySlug,
  workPath,
  communityId,
  profile,
  offset: offsetParam
}: {
  vocabularySlug: string
  workPath: string
  communityId?: number
  profile?: string
  offset?: string
}) {
  const user = await getCurrentUser()
  if (!user)
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold">My work</h2>
        <p>
          Your drafts are private to your account. Sign in to continue work in
          this vocabulary.
        </p>
        <Button asChild className="self-start">
          <Link href={authPathWithReturnTo("/login", workPath)}>Sign in</Link>
        </Button>
      </section>
    )
  const parsedProfile = profile ? matcoreProfileSchema.safeParse(profile) : null
  if (parsedProfile && !parsedProfile.success) notFound()
  const offset = offsetParam ? Number(offsetParam) : 0
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) notFound()
  const profileKey = parsedProfile?.success ? parsedProfile.data : undefined
  const [options, workspace, fields, drafts, imports] = await Promise.all([
    trpc.setup.options(),
    trpc.matcoreWorkflow.workspace({ vocabularySlug }),
    trpc.matcoreWorkflow.list({
      vocabularySlug,
      profileKey,
      offset,
      limit: 40
    }),
    trpc.termDrafts.list({ vocabularySlug }),
    trpc.importDrafts.list({ vocabularySlug })
  ])
  // Filter on the server before any private list is serialized to the client.
  const ownDrafts = drafts.filter(
    (draft) => draft.vocabularySlug === vocabularySlug
  )
  const ownImports = imports.filter(
    (batch) => batch.vocabularySlug === vocabularySlug
  )
  const destination = options.vocabularies.find(
    (item) => item.slug === vocabularySlug
  )
  const params = new URLSearchParams({ task: "import", vocabularySlug })
  if (communityId) params.set("communityId", String(communityId))
  const showMetadata = workspace.metadataEnabled || fields.total > 0
  const catalog = showMetadata
    ? await trpc.matcoreWorkflow.catalog({ vocabularySlug })
    : null
  const current = new URL(workPath, "http://local")
  if (profileKey) current.searchParams.set("profile", profileKey)
  if (offset) current.searchParams.set("offset", String(offset))
  const returnPath = `${current.pathname}${current.search}`
  const sections: PageSection[] = [
    { id: "term-drafts", label: "Term drafts" },
    ...(ownImports.length
      ? [{ id: "term-imports", label: "Term imports" }]
      : []),
    ...(showMetadata
      ? [{ id: "my-field-drafts", label: "Metadata drafts" }]
      : []),
    ...(workspace.canManage
      ? [{ id: "workspace-tools", label: "Workspace tools" }]
      : [])
  ]
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">My work</h2>
          {destination?.canContribute ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link
                  href={withCommunityWorkReturn(
                    `/add?vocabularySlug=${encodeURIComponent(vocabularySlug)}`,
                    `${returnPath}#term-drafts`
                  )}
                >
                  Define a term
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link
                  href={withCommunityWorkReturn(
                    `/setup?${params}`,
                    `${returnPath}#term-imports`
                  )}
                >
                  Import terms
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Your private drafts and imports for this vocabulary. Other community
          members cannot see them.
        </p>
        {!destination?.canContribute ? (
          <p className="text-sm text-muted-foreground">
            You can resume saved work. Creating or publishing contributions
            requires access to this vocabulary.
          </p>
        ) : null}
      </header>
      <OnThisPage sections={sections}>
        <section className="flex flex-col gap-2" aria-labelledby="term-drafts">
          <h3
            id="term-drafts"
            tabIndex={-1}
            data-section-target
            className="text-lg font-semibold"
          >
            My term drafts
          </h3>
          <DraftList
            key={`${user.id}:${vocabularySlug}`}
            drafts={ownDrafts}
            compact
            returnTo={`${returnPath}#term-drafts`}
          />
        </section>
        {ownImports.length ? (
          <section
            className="flex flex-col gap-3"
            aria-labelledby="term-imports"
          >
            <h3
              id="term-imports"
              tabIndex={-1}
              data-section-target
              className="text-lg font-semibold"
            >
              My term imports
            </h3>
            {ownImports.map((batch) => (
              <div
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              >
                <div>
                  <p className="font-medium">{batch.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {batch.counts.needsReview} need review ·{" "}
                    {batch.counts.ready} ready · {batch.counts.published}{" "}
                    published
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link
                    href={withCommunityWorkReturn(
                      `/profile/drafts/imports/${batch.id}`,
                      `${returnPath}#term-imports`
                    )}
                  >
                    Review import
                  </Link>
                </Button>
              </div>
            ))}
          </section>
        ) : null}
        {showMetadata && catalog ? (
          <WorkspaceList
            key={`${user.id}:${vocabularySlug}:${profileKey ?? ""}:${offset}:${workspace.metadataEnabled}:${workspace.matcoreEnabled}`}
            ownerId={user.id}
            options={{
              ...options,
              vocabularies: destination ? [destination] : []
            }}
            workspace={workspace}
            workPath={workPath}
            returnTo={`${returnPath}#my-field-drafts`}
            catalog={catalog}
            result={fields}
            vocabularySlug={vocabularySlug}
            profileKey={profileKey}
            offset={offset}
          />
        ) : null}
        <WorkspaceSettings
          key={`${user.id}:${vocabularySlug}:${workspace.metadataEnabled}:${workspace.matcoreEnabled}`}
          workspace={workspace}
        />
      </OnThisPage>
    </section>
  )
}
