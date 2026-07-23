import type { Metadata } from "next"
import Link from "next/link"
import { cache } from "react"
import { and, asc, eq, sql } from "drizzle-orm"
import { notFound } from "next/navigation"
import {
  Building2Icon,
  ExternalLinkIcon,
  UserRoundCheckIcon
} from "lucide-react"
import { db, definitionsTable, termsTable, usersTable } from "@yamz/db"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { SITE_NAME } from "@/lib/site"

// Visibility and profile fields change through the owner edit form. Never
// retain a published or unpublished profile response in the full-route cache.
export const dynamic = "force-dynamic"

const getPublicProfile = cache(async (userIdParam: string) => {
  const userId = Number(userIdParam)
  if (!Number.isSafeInteger(userId) || userId <= 0) notFound()

  const [profile] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      affiliation: usersTable.affiliation,
      orcidId: usersTable.orcidId
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, userId),
        eq(usersTable.isProfilePublic, true),
        eq(usersTable.isAi, false)
      )
    )
    .limit(1)

  if (!profile) notFound()
  return profile
})

function profileName(profile: {
  name: string | null
  firstName: string | null
  lastName: string | null
}) {
  return (
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
    profile.name ||
    "Contributor"
  )
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ userId: string }>
}): Promise<Metadata> {
  const { userId } = await params
  const profile = await getPublicProfile(userId)
  const displayName = profileName(profile)

  return {
    title: `${displayName} | ${SITE_NAME}`,
    description: `${displayName}'s public ${SITE_NAME} contributor profile and authored terms.`
  }
}

export default async function PublicProfilePage({
  params
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  const profile = await getPublicProfile(userId)
  const displayName = profileName(profile)

  const authoredTerms = await db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      definitions: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(definitionsTable)
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .where(eq(definitionsTable.authorId, profile.id))
    .groupBy(termsTable.id)
    .orderBy(asc(termsTable.term))

  return (
    <main className="px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            Contributor profile
          </p>
          <h1 className="font-serif text-4xl font-bold">{displayName}</h1>
          <p className="text-muted-foreground">
            Public contribution history in the {SITE_NAME} vocabulary.
          </p>
        </section>

        {(profile.affiliation || profile.orcidId) && (
          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              {profile.affiliation && (
                <PublicProfileField
                  icon={<Building2Icon />}
                  label="Affiliation"
                  value={profile.affiliation}
                />
              )}
              {profile.orcidId && (
                <PublicProfileField
                  icon={<UserRoundCheckIcon />}
                  label="Verified ORCID"
                  value={
                    <a
                      href={`https://orcid.org/${profile.orcidId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {profile.orcidId}
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                    </a>
                  }
                />
              )}
            </CardContent>
          </Card>
        )}

        <Card id="authored-terms">
          <CardHeader>
            <CardTitle>
              {authoredTerms.length} authored{" "}
              {authoredTerms.length === 1 ? "term" : "terms"}
            </CardTitle>
            <CardDescription>
              Terms with at least one definition attributed to this account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {authoredTerms.length ? (
              <ul className="divide-y">
                {authoredTerms.map((term) => (
                  <li key={term.id}>
                    <Link
                      href={`/vocabulary/${term.slug}`}
                      className="flex items-baseline justify-between gap-4 rounded-md px-2 py-3 hover:bg-accent"
                    >
                      <span className="font-serif text-lg">{term.term}</span>
                      <span className="text-sm text-muted-foreground">
                        {term.definitions}{" "}
                        {term.definitions === 1 ? "definition" : "definitions"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                This contributor has not authored any terms yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function PublicProfileField({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="break-words text-sm">{value}</div>
      </div>
    </div>
  )
}
