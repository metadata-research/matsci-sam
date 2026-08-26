import Image from "next/image"
import Link from "next/link"
import {
  ArrowRightIcon,
  MessageSquareTextIcon,
  NetworkIcon,
  SearchIcon,
  SparklesIcon,
  ThumbsUpIcon
} from "lucide-react"
import {
  commentsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  refinementsTable,
  termsTable,
  usersTable,
  vocabulariesTable
} from "@yamz/db"
import { and, asc, desc, eq, exists, inArray, or, sql } from "drizzle-orm"
import { DefinitionStarter } from "./definition-starter"
import { SITE_NAME } from "@/lib/site"
import { getSession } from "@/lib/session"
import { getActiveCommunity } from "@/lib/community-queries"
import { communityReferenceScope, vocabularyTermScope } from "@/lib/search"
import { formatDate } from "@/lib/date"
import { HydrateClient } from "@/trpc/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PublicProfileName } from "@/components/public-profile-name"
import styles from "./home.module.css"
import {
  communityPath,
  definitionPath,
  termPath,
  vocabularyPath
} from "@/lib/public-identifiers"
import {
  acceptedAiSuggestionsForOutputs,
  acceptedLegacyDiscussionSuggestionsForOutputs
} from "@/lib/ai-contribution-provenance"
import { resolveFeaturedActivity } from "@/lib/featured-provenance"

const MILLISECONDS_PER_DAY = 86_400_000
const FEATURED_SHOWCASE_SLUGS = ["fatigue", "martensite", "sintering"] as const

type FeaturedDefinition = Awaited<ReturnType<typeof getFeaturedDefinition>>

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
  const [
    latestTerms,
    recentDiscussion,
    featured,
    personalWork,
    referenceCount
  ] = await Promise.all([
    getLatestTerms(vocabularySlug),
    getRecentDiscussion(vocabularySlug),
    getFeaturedDefinition(vocabularySlug),
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
              Shared terminology for materials science data
            </h1>
            <p className={styles.heroLead}>
              {SITE_NAME} is a community dictionary for materials science terms.
              Compare definitions, add examples of use, and see how definitions
              change over time.
            </p>
            <p className={styles.projectLine}>
              {SITE_NAME} (Semantic Alignment Metadata) is a project of the{" "}
              <a
                href="https://mrc.cci.drexel.edu/"
                target="_blank"
                rel="noreferrer"
              >
                Metadata Research Center at Drexel University
              </a>
              .
            </p>
          </section>

          {activeCommunity && (
            <p className={styles.scopeNotice}>
              Viewing the{" "}
              <Link href={vocabularyPath(activeCommunity.vocabularySlug)}>
                {activeCommunity.title}
              </Link>{" "}
              vocabulary. Terms referenced from other vocabularies are listed
              separately on the community page.
            </p>
          )}

          <div className={styles.heroPanels}>
            <div className={styles.startColumn}>
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
                <Link
                  href="/about#definition-workflow"
                  className={styles.textLink}
                >
                  How contributions work
                  <ArrowRightIcon aria-hidden />
                </Link>
              </section>

              {!emptyCommunity && (
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
                  <Link href="/terms" className={styles.textLink}>
                    Browse terms
                    <ArrowRightIcon aria-hidden />
                  </Link>
                </section>
              )}
            </div>

            {emptyCommunity ? (
              <CommunityEmptyState
                community={emptyCommunity}
                referenceCount={referenceCount}
              />
            ) : (
              <FeaturedRecord
                featured={featured}
                showVocabulary={!activeCommunity}
              />
            )}
          </div>

          {!emptyCommunity && (
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
                            <small>Defined in {comment.vocabularyTitle}</small>
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
    <article className={styles.featuredRecord}>
      <div className={styles.featuredEmpty}>
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

function FeaturedRecord({
  featured,
  showVocabulary
}: {
  featured: FeaturedDefinition
  showVocabulary: boolean
}) {
  if (!featured) {
    return (
      <article className={styles.featuredRecord}>
        <div className={styles.featuredEmpty}>
          <SearchIcon aria-hidden />
          <h2>Browse definitions</h2>
          <p>
            Open a term to compare definitions and review examples of use,
            comments, and provenance.
          </p>
          <Button asChild variant="outline">
            <Link href="/terms">Browse terms</Link>
          </Button>
        </div>
      </article>
    )
  }

  const sourceDate = featured.sourceCreatedAt ?? featured.createdAt
  const suggestionDate = featured.suggestedAt ?? featured.createdAt
  const acceptedDate = featured.decidedAt ?? featured.createdAt
  const isAiAssisted =
    featured.activityKind === "canonical-ai" ||
    featured.activityKind === "legacy-ai"
  const isAiRevision = isAiAssisted && featured.aiIntent !== "new_term"

  return (
    <article className={styles.featuredRecord}>
      <div className={styles.featuredHeader}>
        <div>
          <div className={styles.featuredTitleRow}>
            <h2>
              <Link href={termPath(featured.slug, featured.vocabularySlug)}>
                {featured.term}
              </Link>
            </h2>
            <Badge variant="outline">
              {featured.definitionCount}{" "}
              {featured.definitionCount === 1 ? "definition" : "definitions"}
            </Badge>
            {showVocabulary && (
              <Badge variant="secondary">
                Defined in {featured.vocabularyTitle}
              </Badge>
            )}
          </div>
          <p>Featured definition</p>
        </div>
        {isAiAssisted && (
          <span className={styles.aiMarker}>
            <SparklesIcon aria-hidden />
            {isAiRevision ? "AI-assisted revision" : "AI-assisted contribution"}
          </span>
        )}
      </div>

      <p className={styles.featuredDefinition}>{featured.definition}</p>

      <dl className={styles.featuredMetadata}>
        <div>
          <dt>Contributed by</dt>
          <dd>
            {featured.authorIsAi && (
              <SparklesIcon
                aria-hidden
                style={{
                  display: "inline",
                  width: "0.8em",
                  height: "0.8em",
                  marginRight: "0.3em",
                  color: "var(--ai)"
                }}
              />
            )}
            <PublicProfileName
              user={{
                id: featured.authorId,
                name: featured.author,
                isAi: featured.authorIsAi,
                isProfilePublic: featured.authorProfilePublic
              }}
              className={featured.authorIsAi ? "text-ai font-mono" : undefined}
              fallback="Community contributor"
            />
          </dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>
            <ThumbsUpIcon aria-hidden />
            {featured.score}
          </dd>
        </div>
        <div>
          <dt>Comments</dt>
          <dd>
            <MessageSquareTextIcon aria-hidden />
            {featured.comments}
          </dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(featured.updatedAt ?? featured.createdAt)}</dd>
        </div>
      </dl>

      {isAiAssisted ? (
        <div className={styles.provenanceTrace}>
          <h3>{isAiRevision ? "Revision history" : "Contribution history"}</h3>
          <ol>
            {isAiRevision && (
              <li>
                <span className={styles.timelineMarker} aria-hidden />
                <time dateTime={sourceDate}>{formatDate(sourceDate)}</time>
                <span>Source definition published</span>
              </li>
            )}
            <li>
              <span
                className={`${styles.timelineMarker} ${styles.timelineMarkerAi}`}
                aria-hidden
              >
                <SparklesIcon />
              </span>
              <time dateTime={suggestionDate}>
                {formatDate(suggestionDate)}
              </time>
              <span>
                {featured.activityModel
                  ? `${featured.activityModel} generated a suggestion`
                  : "The model generated a suggestion"}
              </span>
            </li>
            <li>
              <span
                className={`${styles.timelineMarker} ${styles.timelineMarkerAccepted}`}
                aria-hidden
              />
              <time dateTime={acceptedDate}>{formatDate(acceptedDate)}</time>
              <span>
                {isAiRevision
                  ? "Contributor published the revision"
                  : "Contributor published the definition"}
              </span>
            </li>
          </ol>
        </div>
      ) : featured.refinedFromId ? (
        <div className={styles.provenanceTrace}>
          <h3>Revision history</h3>
          <ol>
            <li>
              <span className={styles.timelineMarker} aria-hidden />
              <time dateTime={sourceDate}>{formatDate(sourceDate)}</time>
              <span>Source definition published</span>
            </li>
            <li>
              <span
                className={`${styles.timelineMarker} ${styles.timelineMarkerAccepted}`}
                aria-hidden
              />
              <time dateTime={acceptedDate}>{formatDate(acceptedDate)}</time>
              <span>Contributor published the revision</span>
            </li>
          </ol>
        </div>
      ) : (
        <div className={styles.provenanceTrace}>
          <h3>Definition history</h3>
          <p>Definition published {formatDate(featured.createdAt)}.</p>
        </div>
      )}

      <div className={styles.featuredLinks}>
        <Link
          href={termPath(featured.slug, featured.vocabularySlug)}
          className={styles.textLink}
        >
          Open term
          <ArrowRightIcon aria-hidden />
        </Link>
        <Link
          href={`/terms/${featured.termId}/provenance`}
          className={styles.textLink}
        >
          <NetworkIcon aria-hidden />
          View provenance
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
                    {item.refinedFromId ? "Suggested revision" : "Definition"}
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

async function getFeaturedDefinition(vocabularySlug?: string) {
  const candidateTerms = await db
    .select({
      termId: termsTable.id,
      vocabularySlug: termsTable.vocabularySlug,
      definitionCount:
        sql<number>`cast(count(${definitionsTable.id}) as int)`.mapWith(Number)
    })
    .from(termsTable)
    .innerJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .where(
      vocabularySlug
        ? vocabularyTermScope(vocabularySlug)
        : inArray(termsTable.slug, FEATURED_SHOWCASE_SLUGS)
    )
    .groupBy(termsTable.id)
    // Identical term slugs may exist in several vocabularies. The complete
    // ordering keeps the day-based rotation stable in Everything mode.
    .orderBy(
      asc(termsTable.slug),
      asc(termsTable.vocabularySlug),
      asc(termsTable.id)
    )

  if (!candidateTerms.length) return null

  // A UTC-day index gives everyone the same featured term for the day. In
  // Everything, rotate through the reviewed showcase records; in a selected
  // community, rotate through that vocabulary so the card never leaks another
  // community or appears empty merely because no showcase slug belongs to it.
  const rotationIndex =
    Math.floor(Date.now() / MILLISECONDS_PER_DAY) % candidateTerms.length
  const candidate = candidateTerms[rotationIndex]

  const buildQuery = () =>
    db
      .select({
        termId: termsTable.id,
        term: termsTable.term,
        slug: termsTable.slug,
        vocabularySlug: termsTable.vocabularySlug,
        vocabularyTitle: vocabulariesTable.title,
        definitionId: definitionsTable.id,
        definition: definitionsTable.definition,
        authorId: usersTable.id,
        author: usersTable.name,
        authorIsAi: usersTable.isAi,
        authorProfilePublic: usersTable.isProfilePublic,
        score: definitionsTable.score,
        refinedFromId: definitionsTable.refinedFromId,
        createdAt: definitionsTable.createdAt,
        updatedAt: definitionsTable.updatedAt,
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
      .leftJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
      .leftJoin(
        commentsTable,
        eq(commentsTable.definitionId, definitionsTable.id)
      )

  const preferred = await buildQuery()
    .where(eq(termsTable.id, candidate.termId))
    .groupBy(
      definitionsTable.id,
      termsTable.id,
      usersTable.id,
      vocabulariesTable.slug
    )
    .orderBy(
      desc(
        sql<number>`case when ${definitionsTable.refinedFromId} is not null then 1 else 0 end`
      ),
      desc(definitionsTable.score),
      desc(definitionsTable.createdAt)
    )

  const featured = preferred[0]
  if (!featured) return null

  // Read publication provenance from exact foreign keys. A source definition
  // can have many unrelated legacy refinement rounds, so "newest round on the
  // source" is not evidence that a particular output accepted that round.
  const [
    canonicalSuggestions,
    legacyDiscussionSuggestions,
    outputRevision,
    sourceDefinition
  ] = await Promise.all([
    acceptedAiSuggestionsForOutputs([featured.definitionId]),
    acceptedLegacyDiscussionSuggestionsForOutputs([featured.definitionId]),
    db.query.definitionRevisionsTable.findFirst({
      columns: {
        sourceRefinementId: true,
        derivedFromRevisionId: true
      },
      where: and(
        eq(definitionRevisionsTable.definitionId, featured.definitionId),
        eq(definitionRevisionsTable.version, 1)
      )
    }),
    featured.refinedFromId
      ? db.query.definitionsTable.findFirst({
          columns: { createdAt: true },
          where: eq(definitionsTable.id, featured.refinedFromId)
        })
      : Promise.resolve(undefined)
  ])

  const canonicalSuggestion = canonicalSuggestions[0]
  const legacyDiscussionSuggestion = legacyDiscussionSuggestions[0]
  const [sourceRevision, legacyRefinement] = await Promise.all([
    outputRevision?.derivedFromRevisionId
      ? db.query.definitionRevisionsTable.findFirst({
          columns: { createdAt: true },
          where: eq(
            definitionRevisionsTable.id,
            outputRevision.derivedFromRevisionId
          )
        })
      : Promise.resolve(undefined),
    !canonicalSuggestion &&
    !legacyDiscussionSuggestion &&
    outputRevision?.sourceRefinementId
      ? db.query.refinementsTable.findFirst({
          columns: { suggestedAt: true, decidedAt: true, model: true },
          where: and(
            eq(refinementsTable.id, outputRevision.sourceRefinementId),
            eq(refinementsTable.status, "accepted")
          )
        })
      : Promise.resolve(undefined)
  ])

  const activity = resolveFeaturedActivity({
    canonicalSuggestion,
    legacyDiscussionSuggestion,
    legacyRefinement,
    refinedFromId: featured.refinedFromId,
    createdAt: featured.createdAt
  })

  return {
    ...featured,
    definitionCount: candidate.definitionCount,
    ...activity,
    sourceCreatedAt:
      sourceRevision?.createdAt ?? sourceDefinition?.createdAt ?? null
  }
}
