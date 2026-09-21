import Image from "next/image"
import Link from "next/link"
import { ArrowRightIcon, SearchIcon } from "lucide-react"
import {
  commentsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable,
  usersTable,
  vocabulariesTable
} from "@yamz/db"
import { and, desc, eq, exists, or, sql } from "drizzle-orm"
import { DefinitionStarter } from "./definition-starter"
import { SITE_FULL_NAME, SITE_NAME } from "@/lib/site"
import { getSession } from "@/lib/session"
import { getActiveCommunity } from "@/lib/community-queries"
import { communityDisplayName } from "@/lib/community-names"
import { communityReferenceScope, vocabularyTermScope } from "@/lib/search"
import { formatDate } from "@/lib/date"
import { HydrateClient } from "@/trpc/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PublicProfileName } from "@/components/public-profile-name"
import styles from "./home.module.css"
import {
  communityPath,
  definitionPath,
  termPath,
  vocabularyPath
} from "@/lib/public-identifiers"

export default async function Home() {
  const sessionPromise = getSession()
  const activeCommunityPromise = getActiveCommunity()
  const [sesh, activeCommunity] = await Promise.all([
    sessionPromise,
    activeCommunityPromise
  ])
  const vocabularySlug = activeCommunity?.vocabularySlug
  const personalWorkPromise = sesh.id
    ? getPersonalWork(sesh.id, vocabularySlug)
    : Promise.resolve([])
  const referenceCountPromise = activeCommunity
    ? getCommunityReferenceCount(
        activeCommunity.id,
        activeCommunity.vocabularySlug
      )
    : Promise.resolve(0)
  const [latestTerms, recentDiscussion, personalWork, referenceCount] =
    await Promise.all([
      getLatestTerms(vocabularySlug),
      getRecentDiscussion(vocabularySlug),
      personalWorkPromise,
      referenceCountPromise
    ])
  const emptyCommunity =
    activeCommunity && latestTerms.length === 0 ? activeCommunity : null

  return (
    <HydrateClient>
      <main className={styles.main}>
        <div className={styles.shell}>
          <section className={styles.hero} aria-labelledby="home-title">
            <h1 id="home-title" className={styles.heroTitle}>
              {SITE_FULL_NAME}
            </h1>
            <p className={styles.heroLead}>
              A community dictionary for materials science terminology. Draft
              definitions with optional AI assistance and look up terms in
              community vocabularies and the ChEBI ontology.
            </p>
          </section>

          <nav className={styles.helpLinks} aria-label="Getting started">
            <Link href="/docs" className={styles.textLink}>
              Quick Start
              <ArrowRightIcon aria-hidden />
            </Link>
            <Link href="/about" className={styles.textLink}>
              About {SITE_NAME}
              <ArrowRightIcon aria-hidden />
            </Link>
          </nav>

          {activeCommunity && (
            <p className={styles.communityName}>
              <Link href={vocabularyPath(activeCommunity.vocabularySlug)}>
                {communityDisplayName(activeCommunity)}
              </Link>
            </p>
          )}

          <div className={styles.actionPanels}>
            <section
              className={styles.findPanel}
              aria-labelledby="find-heading"
            >
              <h2 id="find-heading">Find a term</h2>
              <form
                action="/search"
                method="get"
                role="search"
                aria-label="Find a term"
              >
                <label htmlFor="home-search" className="sr-only">
                  Search terms and definitions
                </label>
                <div className={styles.searchRow}>
                  <Input
                    id="home-search"
                    name="q"
                    type="search"
                    placeholder="Search terms and definitions"
                  />
                  <Button type="submit">
                    <SearchIcon aria-hidden />
                    Search
                  </Button>
                </div>
              </form>
              {activeCommunity && (
                <p className={styles.contributionNote}>
                  Search includes all vocabularies.
                </p>
              )}
              <Link href="/terms" className={styles.textLink}>
                Browse terms
                <ArrowRightIcon aria-hidden />
              </Link>
            </section>
            <section
              id="contribute"
              className={styles.contributionPanel}
              aria-labelledby="contribution-heading"
            >
              <h2 id="contribution-heading">Add a new term</h2>
              <DefinitionStarter
                signedIn={Boolean(sesh.id)}
                vocabularyTitle={activeCommunity?.title ?? SITE_NAME}
              />
            </section>
          </div>

          {emptyCommunity ? (
            <CommunityEmptyState
              community={emptyCommunity}
              referenceCount={referenceCount}
            />
          ) : (
            <div className={styles.activityPanels}>
              <section
                className={styles.recentTerms}
                aria-labelledby="recent-terms-heading"
              >
                <h2 id="recent-terms-heading">Recently added</h2>
                <ul className={styles.activityList}>
                  {latestTerms.map(
                    ({
                      id,
                      term,
                      slug,
                      vocabularySlug,
                      vocabularyTitle,
                      count,
                      createdAt
                    }) => (
                      <li key={id}>
                        <Link
                          href={termPath(slug, vocabularySlug)}
                          className={styles.termActivity}
                        >
                          <span className={styles.termIdentity}>
                            <span className={styles.termName}>{term}</span>
                            {!activeCommunity && (
                              <small>Defined in {vocabularyTitle}</small>
                            )}
                          </span>
                          <span>
                            {count === 1
                              ? "1 definition"
                              : `${count} definitions`}
                          </span>
                          <time dateTime={createdAt}>
                            {formatDate(createdAt)}
                          </time>
                        </Link>
                      </li>
                    )
                  )}
                </ul>
              </section>
              <section
                className={styles.communitySection}
                aria-labelledby="community-heading"
              >
                <div className={styles.sectionHeading}>
                  <div>
                    <h2 id="community-heading">Recent discussion</h2>
                  </div>
                  <Link href="/discussion" className={styles.textLink}>
                    View discussion
                    <ArrowRightIcon aria-hidden />
                  </Link>
                </div>

                {recentDiscussion.length ? (
                  <ul className={styles.discussionList}>
                    {recentDiscussion.map((comment) => (
                      <li key={comment.id}>
                        <Link
                          href={`${definitionPath(
                            comment.termSlug,
                            comment.definitionNumber,
                            comment.vocabularySlug
                          )}#discussion`}
                          className={styles.discussionActivity}
                        >
                          <span className={styles.termIdentity}>
                            <span className={styles.termName}>
                              {comment.term}
                            </span>
                            {!activeCommunity && (
                              <small>
                                Defined in {comment.vocabularyTitle}
                              </small>
                            )}
                          </span>
                          <span className={styles.commentExcerpt}>
                            {comment.message}
                          </span>
                        </Link>
                        <span className={styles.activityByline}>
                          <PublicProfileName
                            user={{
                              id: comment.authorId,
                              name: comment.author,
                              isAi: comment.authorIsAi,
                              isProfilePublic: comment.authorProfilePublic
                            }}
                            fallback="Community member"
                          />
                          <time dateTime={comment.createdAt}>
                            {formatDate(comment.createdAt)}
                          </time>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.emptyActivity}>No comments yet.</p>
                )}
              </section>
            </div>
          )}

          {sesh.id && !emptyCommunity && (
            <PersonalWorkSection
              personalWork={personalWork}
              communityTitle={activeCommunity?.title}
              showVocabulary={!activeCommunity}
            />
          )}

          <footer className={styles.footer}>
            <a
              href="https://mrc.cci.drexel.edu/"
              target="_blank"
              rel="noreferrer"
              className={styles.mrcIdentity}
            >
              <span className={styles.mrcLogo}>
                <Image
                  src="/mrc-logo.png"
                  alt=""
                  width={300}
                  height={92}
                  sizes="220px"
                  loading="eager"
                />
              </span>
              <span>
                A project of the Metadata Research Center at Drexel University
              </span>
            </a>

            <div className={styles.nsfIdentity}>
              <Image
                src="/NSF_Logo.jpg"
                alt="National Science Foundation"
                width={219}
                height={230}
                sizes="48px"
              />
              <span>
                National Science Foundation
                <small>OAC #2118201</small>
              </span>
            </div>

            <nav aria-label="Project information" className={styles.footerNav}>
              <Link href="/about">About MatSci-SAM</Link>
              <Link href="/docs/metadata-access">Metadata access</Link>
            </nav>
          </footer>
        </div>
      </main>
    </HydrateClient>
  )
}

function CommunityEmptyState({
  community,
  referenceCount
}: {
  community: NonNullable<Awaited<ReturnType<typeof getActiveCommunity>>>
  referenceCount: number
}) {
  return (
    <article className={styles.communityEmpty}>
      <div>
        <SearchIcon aria-hidden />
        <h2>No terms in {community.title}&apos;s vocabulary</h2>
        <p>
          No terms have been published in this vocabulary yet.
          {referenceCount > 0 && (
            <>
              {" "}
              Its worklist references {referenceCount}{" "}
              {referenceCount === 1 ? "term" : "terms"} from other vocabularies.
            </>
          )}
        </p>
        <Button asChild variant="outline">
          <Link href={communityPath(community.slug)}>View community</Link>
        </Button>
        <Link href="/terms?scope=all" className={styles.textLink}>
          Browse everything
          <ArrowRightIcon aria-hidden />
        </Link>
      </div>
    </article>
  )
}

function PersonalWorkSection({
  personalWork,
  communityTitle,
  showVocabulary
}: {
  personalWork: Awaited<ReturnType<typeof getPersonalWork>>
  communityTitle?: string
  showVocabulary: boolean
}) {
  return (
    <section
      className={styles.personalSection}
      aria-labelledby="personal-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="personal-heading">Your recent contributions</h2>
          <p>
            {communityTitle
              ? `Definitions you recently added or edited for terms in ${communityTitle}.`
              : "Definitions you recently added or edited."}
          </p>
        </div>
        <div className={styles.personalLinks}>
          <Link href="/profile#authored-terms" className={styles.textLink}>
            View authored terms
            <ArrowRightIcon aria-hidden />
          </Link>
          <Link href="/add" className={styles.textLink}>
            Add another term
            <ArrowRightIcon aria-hidden />
          </Link>
        </div>
      </div>

      {personalWork.length ? (
        <ul className={styles.personalList}>
          {personalWork.map((item) => (
            <li key={item.id}>
              <Link
                href={definitionPath(
                  item.termSlug,
                  item.definitionNumber,
                  item.vocabularySlug
                )}
              >
                <span className={styles.personalTerm}>
                  <strong>{item.term}</strong>
                  <small>
                    {item.refinedFromId
                      ? "Suggested alternative"
                      : "Definition"}
                    {showVocabulary
                      ? ` · Defined in ${item.vocabularyTitle}`
                      : ""}
                  </small>
                </span>
                <span className={styles.personalDetails}>
                  {item.comments} {item.comments === 1 ? "comment" : "comments"}
                  <span aria-hidden>·</span>
                  score {item.score}
                  <span aria-hidden>·</span>
                  {formatDate(item.lastEditedAt ?? item.createdAt)}
                </span>
                <span className={styles.openDefinition}>
                  Open
                  <ArrowRightIcon aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.personalEmpty}>
          <p>You have not contributed a definition yet.</p>
          <Button asChild size="sm">
            <Link href="/add">Add a new term</Link>
          </Button>
        </div>
      )}
    </section>
  )
}

async function getLatestTerms(vocabularySlug?: string) {
  return db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      createdAt: termsTable.createdAt,
      count: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(termsTable)
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .where(vocabularySlug ? vocabularyTermScope(vocabularySlug) : undefined)
    .groupBy(termsTable.id, vocabulariesTable.slug)
    .orderBy(desc(termsTable.createdAt))
    .limit(4)
}

async function getCommunityReferenceCount(
  communityId: number,
  vocabularySlug: string
) {
  const [row] = await db
    .select({
      count: sql<number>`cast(count(distinct ${termsTable.id}) as int)`.mapWith(
        Number
      )
    })
    .from(termsTable)
    .where(
      and(
        communityReferenceScope(communityId),
        sql`${termsTable.vocabularySlug} <> ${vocabularySlug}`
      )
    )

  return row?.count ?? 0
}

async function getRecentDiscussion(vocabularySlug?: string) {
  const comments = await db
    .select({
      id: commentsTable.id,
      definitionId: commentsTable.definitionId,
      definitionNumber: definitionsTable.definitionNumber,
      message: commentsTable.message,
      createdAt: commentsTable.createdAt,
      authorId: usersTable.id,
      author: usersTable.name,
      authorIsAi: usersTable.isAi,
      authorProfilePublic: usersTable.isProfilePublic,
      termId: termsTable.id,
      term: termsTable.term,
      termSlug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title
    })
    .from(commentsTable)
    .innerJoin(
      definitionsTable,
      eq(definitionsTable.id, commentsTable.definitionId)
    )
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .leftJoin(usersTable, eq(usersTable.id, commentsTable.userId))
    .where(vocabularySlug ? vocabularyTermScope(vocabularySlug) : undefined)
    .orderBy(desc(commentsTable.createdAt))
    .limit(20)

  const seenTerms = new Set<number>()
  return comments
    .filter((comment) => {
      if (seenTerms.has(comment.termId)) return false
      seenTerms.add(comment.termId)
      return true
    })
    .slice(0, 4)
}

// One card per term, and enough candidate rows scanned to find the newest
// definition for each of them. A contributor who defines a term and later
// accepts an AI refinement owns two definitions on that term, so scanning only
// three rows could return the same term three times.
const PERSONAL_WORK_TERMS = 3
const PERSONAL_WORK_SCAN = 60

async function getPersonalWork(userId: number, vocabularySlug?: string) {
  // Keyed by term, not by definition: two definitions on one term are two
  // halves of the same task, and listing both asks the contributor to choose
  // between them instead of carrying on. Working anywhere in a term's editing
  // chain counts -- authoring a definition, or editing any revision of one --
  // so a term still surfaces when somebody else started it and this person
  // revised it.
  const rows = await db
    .select({
      id: definitionsTable.id,
      termId: termsTable.id,
      definitionNumber: definitionsTable.definitionNumber,
      term: termsTable.term,
      termSlug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      score: definitionsTable.score,
      createdAt: definitionsTable.createdAt,
      updatedAt: definitionsTable.updatedAt,
      // When this definition was last *edited*. definitions.updatedAt cannot
      // answer that: it is maintained by $onUpdateFn, so a vote touches the row
      // and moves it. A downvote on sintering pushed an untouched definition
      // above the refinement derived from it hours earlier.
      lastEditedAt: sql<string>`(
        select max(${definitionRevisionsTable.createdAt})
        from ${definitionRevisionsTable}
        where ${definitionRevisionsTable.definitionId} = ${definitionsTable.id}
      )`,
      refinedFromId: definitionsTable.refinedFromId,
      comments: sql<number>`cast(count(${commentsTable.id}) as int)`.mapWith(
        Number
      )
    })
    .from(definitionsTable)
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .leftJoin(
      commentsTable,
      eq(commentsTable.definitionId, definitionsTable.id)
    )
    .where(
      and(
        vocabularySlug ? vocabularyTermScope(vocabularySlug) : undefined,
        or(
          eq(definitionsTable.authorId, userId),
          // Stated as EXISTS rather than a join: joining the revisions would
          // multiply a definition by its revision count and inflate the comment
          // tally counted above.
          exists(
            db
              .select({ one: sql`1` })
              .from(definitionRevisionsTable)
              .where(
                and(
                  eq(
                    definitionRevisionsTable.definitionId,
                    definitionsTable.id
                  ),
                  eq(definitionRevisionsTable.editorId, userId)
                )
              )
          )
        )
      )
    )
    .groupBy(definitionsTable.id, termsTable.id, vocabulariesTable.slug)
    // Last edit first, and on a tie the later definition in the chain, so the
    // card opens where the work actually left off.
    .orderBy(
      desc(
        sql`coalesce((
          select max(${definitionRevisionsTable.createdAt})
          from ${definitionRevisionsTable}
          where ${definitionRevisionsTable.definitionId} = ${definitionsTable.id}
        ), ${definitionsTable.createdAt})`
      ),
      desc(definitionsTable.id)
    )
    .limit(PERSONAL_WORK_SCAN)

  const latest: typeof rows = []
  const seen = new Set<number>()
  for (const row of rows) {
    if (seen.has(row.termId)) continue
    seen.add(row.termId)
    latest.push(row)
    if (latest.length === PERSONAL_WORK_TERMS) break
  }

  return latest
}
