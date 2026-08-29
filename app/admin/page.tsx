import { HydrateClient, trpc } from "@/trpc/server"
import Link from "next/link"
import {
  ArrowRightIcon,
  BookOpenIcon,
  FileTextIcon,
  HistoryIcon,
  SparklesIcon,
  ThumbsUpIcon,
  UsersIcon
} from "lucide-react"
import { formatDate } from "@/lib/date"
import { AdminPageHeader } from "./page-header"
import { DashboardSummary } from "./dashboard-summary"
import styles from "./admin.module.css"
import { Suspense } from "react"
import { revisionPath } from "@/lib/public-identifiers"
import { aiRevisionSources, revisionSourceLabels } from "@/lib/revision-sources"
import { Button } from "@/components/ui/button"

export default async function AdminOverviewPage() {
  const overviewPromise = trpc.admin.overview()
  void trpc.admin.serviceHealth.prefetch()
  const overview = await overviewPromise

  return (
    <HydrateClient>
      <AdminPageHeader
        title="Administration"
        description="Manage vocabulary content, people, and connected services."
        actions={
          <Button asChild variant="outline">
            <Link href="/docs/administration">
              <BookOpenIcon aria-hidden />
              Administration guide
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<DashboardSummaryLoading />}>
        <DashboardSummary generationAttention={overview.generationAttention} />
      </Suspense>

      <section className={`${styles.panel} ${styles.activityPanel}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Recent activity</h2>
          <Link href="/admin/terms" className={styles.textLink}>
            Open vocabulary
            <ArrowRightIcon aria-hidden />
          </Link>
        </div>
        <div className={styles.activityTableShell}>
          <table className={styles.activityTable}>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Item</th>
                <th scope="col">Activity</th>
                <th scope="col">By</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentActivity.map((activity) => {
                const isAi = aiRevisionSources.has(activity.source)
                const isRevision = activity.version > 1 && !isAi
                const type = isAi
                  ? "AI"
                  : isRevision
                    ? "Revision"
                    : "Definition"
                const action = revisionSourceLabels[activity.source]
                const actor =
                  activity.source === "ai_refinement" ||
                  activity.source === "ai_assisted"
                    ? `${activity.editorName ?? "Community member"} + ${
                        activity.model ?? "named model"
                      }`
                    : isAi
                      ? (activity.model ?? "Named model")
                      : (activity.editorName ?? "Community member")

                return (
                  <tr key={activity.id}>
                    <td>
                      <span
                        className={`${styles.activityType} ${
                          isAi ? styles.activityTypeAi : ""
                        }`}
                      >
                        {isAi ? (
                          <SparklesIcon aria-hidden />
                        ) : isRevision ? (
                          <HistoryIcon aria-hidden />
                        ) : (
                          <BookOpenIcon aria-hidden />
                        )}
                        {type}
                      </span>
                    </td>
                    <td>
                      <Link
                        href={revisionPath(
                          activity.slug,
                          activity.definitionNumber,
                          activity.version,
                          activity.vocabularySlug
                        )}
                        className={styles.activityTerm}
                      >
                        {activity.term}
                      </Link>
                    </td>
                    <td>{action}</td>
                    <td
                      className={
                        activity.source === "ai_generation"
                          ? styles.codeText
                          : styles.activityActor
                      }
                    >
                      {actor}
                    </td>
                    <td className={styles.activityDate}>
                      <time dateTime={activity.createdAt}>
                        {formatDate(activity.createdAt)}
                      </time>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.statGrid} aria-label="Vocabulary totals">
        <Stat
          label="Terms"
          value={overview.totals.terms}
          href="/admin/terms"
          icon={<BookOpenIcon aria-hidden />}
        />
        <Stat
          label="Definitions"
          value={overview.totals.definitions}
          href="/admin/terms"
          icon={<FileTextIcon aria-hidden />}
        />
        <Stat
          label="People"
          value={overview.totals.people}
          href="/admin/users"
          icon={<UsersIcon aria-hidden />}
        />
        <Stat
          label="Votes"
          value={overview.totals.votes}
          href="/admin/audit"
          icon={<ThumbsUpIcon aria-hidden />}
        />
      </section>
    </HydrateClient>
  )
}

function DashboardSummaryLoading() {
  return (
    <section
      className={styles.overviewSummary}
      aria-label="Checking administrative status"
    >
      {["Needs attention", "Service health"].map((title) => (
        <article className={styles.panel} key={title}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>{title}</h2>
          </div>
          <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">
            Checking status…
          </div>
        </article>
      ))}
    </section>
  )
}

function Stat({
  label,
  value,
  href,
  icon
}: {
  label: string
  value: number
  href: string
  icon: React.ReactNode
}) {
  return (
    <Link href={href} className={styles.statLink}>
      <span className={styles.statIcon}>{icon}</span>
      <span>
        <span className={styles.statValue}>{value}</span>
        <span className={styles.statLabel}>{label}</span>
      </span>
    </Link>
  )
}
