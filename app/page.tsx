import Link from "next/link"
import { SITE_FULL_NAME } from "@/lib/site"
import { getSession } from "@/lib/session"
import { getActiveCommunity, myCommunities } from "@/lib/community-queries"
import { communityDisplayName } from "@/lib/community-names"
import {
  communityPath,
  DEFAULT_VOCABULARY_SLUG
} from "@/lib/public-identifiers"
import { HydrateClient } from "@/trpc/server"
import { Button } from "@/components/ui/button"
import { HomeSearch } from "./home-search"
import { CommunityLink } from "@/components/communities/community-link"
import styles from "./home.module.css"

export default async function Home() {
  const session = await getSession()
  const [memberships, active] = session.id
    ? await Promise.all([myCommunities(session.id), getActiveCommunity()])
    : [[], null]
  const addParams = new URLSearchParams({
    vocabularySlug: active?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG
  })

  return (
    <HydrateClient>
      <main className={styles.main}>
        <div className={styles.shell}>
          <section className={styles.hero} aria-labelledby="home-title">
            <h1 id="home-title" className={styles.heroTitle}>
              {SITE_FULL_NAME}
            </h1>
            <p className={styles.heroLead}>
              Terms and definitions for materials science.
            </p>
          </section>

          <HomeSearch
            key={session.id ?? "anonymous"}
            viewerId={session.id ?? null}
            showScope={false}
          />

          <nav aria-label="Get started" className={styles.startActions}>
            <Button asChild>
              <Link href="/terms">Browse terms</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/add?${addParams}`}>Add a term</Link>
            </Button>
            {!session.id && (
              <Button asChild variant="outline">
                <Link href="/register">Create account</Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/communities">Join a community</Link>
            </Button>
          </nav>

          {session.id && (
            <section
              className={styles.memberships}
              aria-labelledby="my-communities-heading"
            >
              <h2 id="my-communities-heading">My communities</h2>
              {memberships.length ? (
                <ul className={styles.membershipLinks}>
                  {memberships.map((community) => (
                    <li key={community.id}>
                      <CommunityLink
                        href={communityPath(community.slug)}
                        communityId={community.id}
                        activeCommunityId={active?.id ?? null}
                      >
                        {communityDisplayName(community)}
                      </CommunityLink>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You have not joined a community yet.
                </p>
              )}
            </section>
          )}
        </div>
      </main>
    </HydrateClient>
  )
}
