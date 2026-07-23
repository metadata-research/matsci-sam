import Image from "next/image"
import Link from "next/link"
import {
  ArrowRightIcon,
  BookOpenIcon,
  FilePlus2Icon,
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
import { desc, eq, sql } from "drizzle-orm"
import { SearchSection } from "./search-section"
import { SITE_NAME } from "@/lib/site"
import { getSession } from "@/lib/session"
import { formatDate } from "@/lib/date"
import { HydrateClient } from "@/trpc/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PublicProfileName } from "@/components/public-profile-name"
import styles from "./home.module.css"

const FEATURED_TERM_SLUG = "martensite"

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

  const [latestTerms, recentDiscussion, featured, personalWork] =
    await Promise.all([
      latestTermsPromise,
      recentDiscussionPromise,
      featuredDefinitionPromise,
      personalWorkPromise
    ])

  const featuredProvenanceHref = featured
    ? `/terms/${featured.termId}/provenance`
    : "/docs/metadata-access"

  return (
    <HydrateClient>
      <main className={styles.main}>
        <div className={styles.shell}>
          <section
            className={styles.id4Guide}
            aria-labelledby="id4-guide-heading"
          >
            <h2 id="id4-guide-heading">
              Here with the ID4 community? Explore {SITE_NAME} in 90 seconds
            </h2>
            <ol>
              <li>
                <Link href="/search">
                  <span>1</span>
                  Search a materials term
                </Link>
              </li>
              <li>
                <Link href={featuredProvenanceHref}>
                  <span>2</span>
                  Inspect a definition and its provenance
                </Link>
              </li>
              <li>
                <Link href="/discussion">
                  <span>3</span>
                  Discuss an alternative
                </Link>
              </li>
            </ol>
          </section>

          <section className={styles.hero} aria-labelledby="home-title">
            <div className={styles.heroIntroduction}>
              <h1 id="home-title" className={styles.heroTitle}>
                <span>Shared terminology for</span>
                <span>materials science data</span>
              </h1>
              <p className={styles.heroLead}>
                Inconsistent terminology makes materials data harder to discover
                and reuse. {SITE_NAME} is a community metadata dictionary for
                comparing definitions, contributing examples of use, and
                recording how terminology changes.
              </p>
              <p className={styles.projectLine}>
                {SITE_NAME} (Semantic Alignment and Standardization) is a
                project of the{" "}
                <a
                  href="https://mrc.cci.drexel.edu/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Metadata Research Center at Drexel University
                </a>
                .
              </p>

              <div
                id="search-vocabulary"
                className={styles.searchPanel}
                aria-labelledby="search-heading"
              >
                <h2 id="search-heading">Search the vocabulary</h2>
                <SearchSection hideResults prominent />
                <div className={styles.searchActions}>
                  <Button asChild>
                    <Link href="/terms">
                      <BookOpenIcon aria-hidden />
                      Browse all terms
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={sesh.id ? "/add" : "/api/login"}>
                      <FilePlus2Icon aria-hidden />
                      {sesh.id
                        ? "Contribute a definition"
                        : "Sign in to contribute"}
                    </Link>
                  </Button>
                </div>
                <Link
                  href="/about#definition-workflow"
                  className={styles.textLink}
                >
                  See how consensus develops
                  <ArrowRightIcon aria-hidden />
                </Link>
              </div>
            </div>

            <FeaturedRecord featured={featured} />
          </section>

          {sesh.id && <PersonalWorkSection personalWork={personalWork} />}

          <section
            className={styles.communitySection}
            aria-labelledby="community-heading"
          >
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="community-heading">What the community is working on</h2>
                <p>Recent additions and discussion from the live vocabulary.</p>
              </div>
              <Link href="/discussion" className={styles.textLink}>
                Open discussions
                <ArrowRightIcon aria-hidden />
              </Link>
            </div>

            <div className={styles.activityColumns}>
              <div>
                <h3>Recently added</h3>
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
              </div>

              <div className={styles.discussionColumn}>
                <h3>Recent discussion</h3>
                {recentDiscussion.length ? (
                  <ul className={styles.discussionList}>
                    {recentDiscussion.map((comment) => (
                      <li key={comment.id}>
                        <Link
                          href={`/definition/${comment.definitionId}#discussion`}
                          className={styles.discussionActivity}
                        >
                          <span className={styles.termName}>
                            {comment.term}
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
                  <p className={styles.emptyActivity}>
                    No comments have been recorded yet.
                  </p>
                )}
              </div>
            </div>
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
              <Link href="/about">About MatSci SAM</Link>
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
            <h2>{featured.term}</h2>
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
            <PublicProfileName
              user={{
                id: featured.authorId,
                name: featured.author,
                isAi: featured.authorIsAi,
                isProfilePublic: featured.authorProfilePublic
              }}
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
                {featured.model ?? "Named model"} generated a suggestion
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
              <Link href={`/definition/${item.id}`}>
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
      message: commentsTable.message,
      createdAt: commentsTable.createdAt,
      authorId: usersTable.id,
      author: usersTable.name,
      authorIsAi: usersTable.isAi,
      authorProfilePublic: usersTable.isProfilePublic,
      termId: termsTable.id,
      term: termsTable.term
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
    .slice(0, 3)
}

async function getPersonalWork(userId: number) {
  return db
    .select({
      id: definitionsTable.id,
      term: termsTable.term,
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

async function getFeaturedDefinition() {
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
    .where(eq(termsTable.slug, FEATURED_TERM_SLUG))
    .groupBy(definitionsTable.id, termsTable.id, usersTable.id)
    .orderBy(
      desc(
        sql<number>`case when ${definitionsTable.refinedFromId} is not null then 1 else 0 end`
      ),
      desc(definitionsTable.score),
      desc(definitionsTable.createdAt)
    )

  let featured = preferred[0]
  let definitionCount = preferred.length

  if (!featured) {
    const fallback = await buildQuery()
      .groupBy(definitionsTable.id, termsTable.id, usersTable.id)
      .orderBy(desc(definitionsTable.createdAt))
      .limit(1)

    featured = fallback[0]
    if (!featured) return null

    definitionCount = await db.$count(
      definitionsTable,
      eq(definitionsTable.termId, featured.termId)
    )
  }

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
    definitionCount,
    sourceCreatedAt,
    suggestedAt,
    decidedAt
  }
}
