import { HydrateClient, trpc } from "@/trpc/server"
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  Clock3Icon,
  TriangleAlertIcon
} from "lucide-react"
import Link from "next/link"
import { formatDate } from "@/lib/date"
import { AdminPageHeader } from "../page-header"
import { JobsTable } from "../terms/table"
import styles from "../admin.module.css"
import { definitionPath } from "@/lib/public-identifiers"

export default async function AdminReviewPage() {
  const [terms, refinements] = await Promise.all([
    trpc.admin.terms(),
    trpc.admin.refinementQueue()
  ])
  const termJobs = terms.filter((term) => term.pending)
  const hasWork = termJobs.length > 0 || refinements.length > 0

  return (
    <HydrateClient>
      <AdminPageHeader
        title="Review"
        description="Review queued AI generation work. Content moderation actions will appear here after lifecycle states are enabled."
      />
      {hasWork ? (
        <div className={styles.sectionStack}>
          {termJobs.length > 0 && (
            <section aria-labelledby="term-generation-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <h2
                    id="term-generation-heading"
                    className={styles.sectionTitle}
                  >
                    Term generation
                  </h2>
                  <p className={styles.sectionDescription}>
                    Requests waiting for an administrator to run the term-level
                    AI definition workflow.
                  </p>
                </div>
              </div>
              <JobsTable pendingOnly initialData={terms} showActions />
            </section>
          )}
          {refinements.length > 0 && (
            <RefinementQueue refinements={refinements} />
          )}
        </div>
      ) : (
        <section className={styles.panel}>
          <div className={styles.emptyState}>
            <div>
              <ClipboardCheckIcon aria-hidden />
              <h2>No generation work is waiting</h2>
              <p>
                Term-level AI requests and definition refinements will appear
                here when they need administrative review.
              </p>
            </div>
          </div>
        </section>
      )}
    </HydrateClient>
  )
}

type Refinement = Awaited<ReturnType<typeof trpc.admin.refinementQueue>>[number]

function RefinementQueue({ refinements }: { refinements: Refinement[] }) {
  return (
    <section
      className={styles.panel}
      aria-labelledby="definition-refinement-heading"
    >
      <div className={styles.panelHeader}>
        <div>
          <h2 id="definition-refinement-heading" className={styles.panelTitle}>
            Definition refinements
          </h2>
          <p className={styles.panelMeta}>
            Background requests still running or needing author follow-up
          </p>
        </div>
      </div>
      <div className={styles.activityTableShell}>
        <table className={styles.activityTable}>
          <thead>
            <tr>
              <th scope="col">Term</th>
              <th scope="col">Round</th>
              <th scope="col">State</th>
              <th scope="col">Author</th>
              <th scope="col">Requested</th>
              <th scope="col">Record</th>
            </tr>
          </thead>
          <tbody>
            {refinements.map((refinement) => {
              const failed = refinement.status === "failed"

              return (
                <tr key={refinement.id}>
                  <td className="font-serif font-semibold">
                    {refinement.term}
                  </td>
                  <td>{refinement.round}</td>
                  <td>
                    <span
                      className={
                        failed ? styles.statusWarning : styles.statusMuted
                      }
                    >
                      {failed ? (
                        <TriangleAlertIcon
                          aria-hidden
                          className="mr-1 inline size-4"
                        />
                      ) : (
                        <Clock3Icon
                          aria-hidden
                          className="mr-1 inline size-4"
                        />
                      )}
                      {failed ? "Generation failed" : "Generating"}
                    </span>
                  </td>
                  <td>{refinement.authorName ?? "Community member"}</td>
                  <td className={styles.activityDate}>
                    <time dateTime={refinement.createdAt}>
                      {formatDate(refinement.createdAt)}
                    </time>
                  </td>
                  <td>
                    <Link
                      href={definitionPath(
                        refinement.termSlug,
                        refinement.definitionNumber
                      )}
                      className={styles.textLink}
                    >
                      Open
                      <ArrowRightIcon aria-hidden />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
