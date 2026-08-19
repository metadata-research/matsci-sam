import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { asc, eq, sql } from "drizzle-orm"
import {
  Building2Icon,
  ExternalLinkIcon,
  Globe2Icon,
  MailIcon,
  PencilIcon,
  ShieldIcon,
  UserRoundCheckIcon
} from "lucide-react"
import { auth } from "@/lib/auth"
import { SITE_NAME } from "@/lib/site"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { db, definitionsTable, termsTable } from "@yamz/db"

export const metadata: Metadata = { title: `Profile | ${SITE_NAME}` }

export default async function ProfilePage() {
  const { user } = await auth()
  if (!user) redirect("/login")

  const authoredTerms = await db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      definitions: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(definitionsTable)
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .where(eq(definitionsTable.authorId, user.id))
    .groupBy(termsTable.id)
    .orderBy(asc(termsTable.term))

  const structuredName = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ")
  const displayName = structuredName || user.name || "Profile"

  return (
    <main className="px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-4xl font-bold">{displayName}</h1>
              <Badge variant="outline" className="capitalize">
                {user.role}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Account profile and contribution history
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user.isProfilePublic && (
              <Button asChild variant="outline">
                <Link href={`/people/${user.id}`}>
                  <ExternalLinkIcon className="size-4" />
                  View public profile
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/profile/edit">
                <PencilIcon className="size-4" />
                Edit profile
              </Link>
            </Button>
          </div>
        </section>

        <Card>
          <CardContent className="flex items-start gap-3">
            {user.isProfilePublic ? (
              <Globe2Icon
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden
              />
            ) : (
              <ShieldIcon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            <div className="space-y-1">
              <p className="font-medium">
                Public profile {user.isProfilePublic ? "enabled" : "disabled"}
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                {user.isProfilePublic
                  ? "Your public page connects your contributor name with your affiliation, verified ORCID, and authored terms."
                  : "Your contributions remain attributed, but your name is not linked to a public profile."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <ProfileField
              icon={<Building2Icon />}
              label="Affiliation"
              value={user.affiliation || "Not provided"}
            />
            <ProfileField
              icon={<MailIcon />}
              label="Email"
              value={user.email || "Not available"}
            />
            <div className="sm:col-span-2">
              <ProfileField
                icon={<UserRoundCheckIcon />}
                label="ORCID"
                value={
                  user.orcidId ? (
                    <a
                      href={`https://orcid.org/${user.orcidId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {user.orcidId}
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  ) : (
                    "Not linked. Connect an ORCID iD from Edit profile when that option is available."
                  )
                }
              />
            </div>
          </CardContent>
        </Card>

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
              <div className="space-y-3 py-3 text-sm text-muted-foreground">
                <p>This account has not authored any terms yet.</p>
                <Button asChild size="sm">
                  <Link href="/add">Define a term</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function ProfileField({
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
