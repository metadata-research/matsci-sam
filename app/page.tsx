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
  definitionsTable,
  refinementsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { asc, desc, eq, inArray, sql } from "drizzle-orm"
import { DefinitionStarter } from "./definition-starter"
import { SITE_NAME } from "@/lib/site"
import { getSession } from "@/lib/session"
import { formatDate } from "@/lib/date"
import { HydrateClient } from "@/trpc/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PublicProfileName } from "@/components/public-profile-name"
import styles from "./home.module.css"
import { definitionPath } from "@/lib/public-identifiers"

const MILLISECONDS_PER_DAY = 86_400_000
const FEATURED_SHOWCASE_SLUGS = ["fatigue", "martensite", "sintering"] as const

type FeaturedDefinition = Awaited<ReturnType<typeof getFeaturedDefinition>>

export default async function Home() {
  const sessionPromise = getSession()
  const latestTermsPromise = getLatestTerms()
  const recentDiscussionPromise = getRecentDiscussion()
  const featuredDefinitionPromise = getFeaturedDefinition()

  const sesh = await sessionPromise
  const personalWorkPromise = sesh.id
    ? getPersonalWork(sesh.id)
    : Promise.resolve([])
  const contributionTermsPromise = sesh.id
    ? getContributionTerms()
    : Promise.resolve([])

  const [
    latestTerms,
    recentDiscussion,
    featured,
    personalWork,
    contributionTerms
  ] = await Promise.all([
    latestTermsPromise,
    recentDiscussionPromise,
    featuredDefinitionPromise,
    personalWorkPromise,
    contributionTermsPromise
  ])

  return (
    <HydrateClient>
      <main className={styles.main}>
        <div className={styles.shell}>
          <section className={styles.hero} aria-labelledby="home-title">
            <h1 id="home-title" className={styles.heroTitle}>
              Shared terminology for materials science data
            </h1>
            <p className={styles.heroLead}>
              Inconsistent terminology makes materials data harder to discover
              and reuse. {SITE_NAME} is a community metadata dictionary for
              comparing definitions, contributing examples of use, and recording
              how terminology changes.
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

          <div className={styles.heroPanels}>
            <div className={styles.startColumn}>
              <section
                id="contribute"
                className={styles.contributionPanel}
                aria-labelledby="contribution-heading"
              >
                <h2 id="contribution-heading">Contribute a definition</h2>
                <DefinitionStarter
                  signedIn={Boolean(sesh.id)}
                  terms={contributionTerms}
                />
                <Link
                  href="/about#definition-workflow"
                  className={styles.textLink}
                >
                  How contributions work
                  <ArrowRightIcon aria-hidden />
                </Link>
              </section>

              <section
                className={styles.recentTerms}
                aria-labelledby="recent-terms-heading"
              >
                <h2 id="recent-terms-heading">Recently added</h2>
                <ul className={styles.activityList}>
                  {latestTerms.map(({ id, term, slug, count, createdAt }) => (
                    <li key={id}>
                      <Link
                        href={`/vocabulary/${slug}`}
                        className={styles.termActivity}
                      >
                        <span className={styles.termName}>{term}</span>
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
                  ))}
                </ul>
                <Link href="/terms" className={styles.textLink}>
                  View all terms
                  <ArrowRightIcon aria-hidden />
                </Link>
              </section>
            </div>

            <FeaturedRecord featured={featured} />
          </div>

          {sesh.id && <PersonalWorkSection personalWork={personalWork} />}

          <section
            className={styles.communitySection}
            aria-labelledby="community-heading"
          >
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="community-heading">Recent discussion</h2>
                <p>Comments from the live vocabulary.</p>
              </div>
              <Link href="/discussion" className={styles.textLink}>
                Open discussions
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
                        comment.definitionNumber
                      )}#discussion`}
                      className={styles.discussionActivity}
                    >
                      <span className={styles.termName}>{comment.term}</span>
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
              <p className={styles.emptyActivity}>
                No comments have been recorded yet.
              </p>
            )}
          </section>

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

function FeaturedRecord({ featured }: { featured: FeaturedDefinition }) {
  if (!featured) {
    return (
      <article className={styles.featuredRecord}>
        <div className={styles.featuredEmpty}>
          <SearchIcon aria-hidden />
          <h2>Browse community definitions</h2>
          <p>
            Compare definitions, examples of use, discussion, and provenance for
            materials science terminology.
          </p>
          <Button asChild variant="outline">
            <Link href="/terms">Browse all terms</Link>
          </Button>
        </div>
      </article>
    )
  }

  const sourceDate = featured.sourceCreatedAt ?? featured.createdAt
  const suggestionDate = featured.suggestedAt ?? featured.createdAt
  const acceptedDate = featured.decidedAt ?? featured.createdAt

  return (
    <article className={styles.featuredRecord}>
      <div className={styles.featuredHeader}>
        <div>
          <div className={styles.featuredTitleRow}>
            <h2>
              <Link href={`/vocabulary/${featured.slug}`}>{featured.term}</Link>
            </h2>
            <Badge variant="outline">
              {featured.definitionCount}{" "}
              {featured.definitionCount === 1 ? "definition" : "definitions"}
            </Badge>
          </div>
          <p>Featured record</p>
        </div>
        {featured.refinedFromId && (
          <span className={styles.aiMarker}>
            <SparklesIcon aria-hidden />
            AI-assisted revision
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
              className={
                featured.authorIsAi ? "text-ai font-mono" : undefined
              }
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

      {featured.refinedFromId ? (
        <div className={styles.provenanceTrace}>
          <h3>Revision activity</h3>
          <ol>
            <li>
              <span className={styles.timelineMarker} aria-hidden />
              <time dateTime={sourceDate}>{formatDate(sourceDate)}</time>
              <span>Human draft contributed</span>
            </li>
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
                {featured.model
                  ? `${featured.model} generated a suggestion`
                  : "The model generated a suggestion"}
              </span>
            </li>
            <li>
              <span
                className={`${styles.timelineMarker} ${styles.timelineMarkerAccepted}`}
                aria-hidden
              />
              <time dateTime={acceptedDate}>{formatDate(acceptedDate)}</time>
              <span>Author accepted the revision</span>
            </li>
          </ol>
        </div>
      ) : (
        <div className={styles.provenanceTrace}>
          <h3>Record activity</h3>
          <p>Definition contributed {formatDate(featured.createdAt)}.</p>
        </div>
      )}

      <div className={styles.featuredLinks}>
        <Link href={`/vocabulary/${featured.slug}`} className={styles.textLink}>
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
  personalWork
}: {
  personalWork: Awaited<ReturnType<typeof getPersonalWork>>
}) {
  return (
    <section
      className={styles.personalSection}
      aria-labelledby="personal-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="personal-heading">Continue your work</h2>
          <p>Your recently authored definitions.</p>
        </div>
        <div className={styles.personalLinks}>
          <Link href="/profile#authored-terms" className={styles.textLink}>
            View contribution history
            <ArrowRightIcon aria-hidden />
          </Link>
          <Link href="/add" className={styles.textLink}>
            Define another term
            <ArrowRightIcon aria-hidden />
          </Link>
        </div>
      </div>

      {personalWork.length ? (
        <ul className={styles.personalList}>
          {personalWork.map((item) => (
            <li key={item.id}>
              <Link href={definitionPath(item.termSlug, item.definitionNumber)}>
                <span className={styles.personalTerm}>
                  <strong>{item.term}</strong>
                  <small>
                    {item.refinedFromId
                      ? "AI-assisted revision"
                      : "Authored definition"}
                  </small>
                </span>
                <span className={styles.personalDetails}>
                  {item.comments} {item.comments === 1 ? "comment" : "comments"}
                  <span aria-hidden>·</span>
                  score {item.score}
                  <span aria-hidden>·</span>
                  {formatDate(item.updatedAt ?? item.createdAt)}
                </span>
                {item.suggestionReady ? (
                  <span className={styles.suggestionReady}>
                    <SparklesIcon aria-hidden />
                    Suggestion ready
                  </span>
                ) : (
                  <span className={styles.openDefinition}>
                    Open
                    <ArrowRightIcon aria-hidden />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.personalEmpty}>
          <p>No definitions are attributed to this account yet.</p>
          <Button asChild size="sm">
            <Link href="/add">Contribute a definition</Link>
          </Button>
        </div>
      )}
    </section>
  )
}

async function getLatestTerms() {
  return db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      createdAt: termsTable.createdAt,
      count: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(termsTable)
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .groupBy(termsTable.id)
    .orderBy(desc(termsTable.createdAt))
    .limit(4)
}

async function getRecentDiscussion() {
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
      termSlug: termsTable.slug
    })
    .from(commentsTable)
    .innerJoin(
      definitionsTable,
      eq(definitionsTable.id, commentsTable.definitionId)
    )
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .leftJoin(usersTable, eq(usersTable.id, commentsTable.userId))
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

async function getPersonalWork(userId: number) {
  return db
    .select({
      id: definitionsTable.id,
      definitionNumber: definitionsTable.definitionNumber,
      term: termsTable.term,
      termSlug: termsTable.slug,
      score: definitionsTable.score,
      createdAt: definitionsTable.createdAt,
      updatedAt: definitionsTable.updatedAt,
      refinedFromId: definitionsTable.refinedFromId,
      comments: sql<number>`cast(count(${commentsTable.id}) as int)`.mapWith(
        Number
      ),
      suggestionReady: sql<boolean>`exists (
        select 1
        from ${refinementsTable}
        where ${refinementsTable.definitionId} = ${definitionsTable.id}
          and ${refinementsTable.status} = 'suggested'
      )`
    })
    .from(definitionsTable)
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .leftJoin(
      commentsTable,
      eq(commentsTable.definitionId, definitionsTable.id)
    )
    .where(eq(definitionsTable.authorId, userId))
    .groupBy(definitionsTable.id, termsTable.id)
    .orderBy(
      desc(
        sql`coalesce(${definitionsTable.updatedAt}, ${definitionsTable.createdAt})`
      )
    )
    .limit(3)
}

async function getContributionTerms() {
  return db
    .select({
      id: termsTable.id,
      term: termsTable.term
    })
    .from(termsTable)
    .orderBy(asc(termsTable.term))
}

async function getFeaturedDefinition() {
  const candidateTerms = await db
    .select({
      termId: termsTable.id,
      definitionCount:
        sql<number>`cast(count(${definitionsTable.id}) as int)`.mapWith(Number)
    })
    .from(termsTable)
    .innerJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .where(inArray(termsTable.slug, FEATURED_SHOWCASE_SLUGS))
    .groupBy(termsTable.id)
    .orderBy(asc(termsTable.slug))

  if (!candidateTerms.length) return null

  // A UTC-day index gives everyone the same featured term for the day while
  // rotating only through reviewed showcase records. Score is a community
  // signal, not an editorial quality gate.
  const rotationIndex =
    Math.floor(Date.now() / MILLISECONDS_PER_DAY) % candidateTerms.length
  const candidate = candidateTerms[rotationIndex]

  const buildQuery = () =>
    db
      .select({
        termId: termsTable.id,
        term: termsTable.term,
        slug: termsTable.slug,
        definitionId: definitionsTable.id,
        definition: definitionsTable.definition,
        authorId: usersTable.id,
        author: usersTable.name,
        authorIsAi: usersTable.isAi,
        authorProfilePublic: usersTable.isProfilePublic,
        score: definitionsTable.score,
        model: definitionsTable.model,
        refinedFromId: definitionsTable.refinedFromId,
        createdAt: definitionsTable.createdAt,
        updatedAt: definitionsTable.updatedAt,
        comments: sql<number>`cast(count(${commentsTable.id}) as int)`.mapWith(
          Number
        )
      })
      .from(definitionsTable)
      .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
      .leftJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
      .leftJoin(
        commentsTable,
        eq(commentsTable.definitionId, definitionsTable.id)
      )

  const preferred = await buildQuery()
    .where(eq(termsTable.id, candidate.termId))
    .groupBy(definitionsTable.id, termsTable.id, usersTable.id)
    .orderBy(
      desc(
        sql<number>`case when ${definitionsTable.refinedFromId} is not null then 1 else 0 end`
      ),
      desc(definitionsTable.score),
      desc(definitionsTable.createdAt)
    )

  const featured = preferred[0]
  if (!featured) return null

  let sourceCreatedAt: string | null = null
  let suggestedAt: string | null = null
  let decidedAt: string | null = null

  if (featured.refinedFromId) {
    const [source, refinement] = await Promise.all([
      db.query.definitionsTable.findFirst({
        columns: { createdAt: true },
        where: eq(definitionsTable.id, featured.refinedFromId)
      }),
      db.query.refinementsTable.findFirst({
        columns: { suggestedAt: true, decidedAt: true },
        where: eq(refinementsTable.definitionId, featured.refinedFromId),
        orderBy: [desc(refinementsTable.round)]
      })
    ])

    sourceCreatedAt = source?.createdAt ?? null
    suggestedAt = refinement?.suggestedAt ?? null
    decidedAt = refinement?.decidedAt ?? null
  }

  return {
    ...featured,
    definitionCount: candidate.definitionCount,
    sourceCreatedAt,
    suggestedAt,
    decidedAt
  }
}
