import Link from "next/link"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  FileClockIcon,
  ShieldAlertIcon
} from "lucide-react"
import { trpc } from "@/trpc/server"
import { formatDate } from "@/lib/date"
import { AdminPageHeader } from "../page-header"
import styles from "../admin.module.css"
import { revisionPath } from "@/lib/public-identifiers"

export default async function AdminAuditPage() {
  const overview = await trpc.admin.overview()

  return (
    <>
      <AdminPageHeader
        title="Audit & safety"
        description="Inspect publication history and keep exceptional administrative actions separate from ordinary vocabulary work."
      />
      <div className={styles.sectionStack}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              <CheckCircle2Icon aria-hidden />
              Recorded evidence
            </h2>
          </div>
          <ul className={styles.statusList}>
            <li className={`${styles.statusRow} ${styles.statusRowCompact}`}>
              <CheckCircle2Icon
                aria-hidden
                className={`${styles.statusIcon} ${styles.statusIconReady}`}
              />
              <span>Definition text and examples use immutable revisions</span>
            </li>
            <li className={`${styles.statusRow} ${styles.statusRowCompact}`}>
              <CheckCircle2Icon
                aria-hidden
                className={`${styles.statusIcon} ${styles.statusIconReady}`}
              />
              <span>Votes and comments identify the reviewed revision</span>
            </li>
            <li className={`${styles.statusRow} ${styles.statusRowCompact}`}>
              <CheckCircle2Icon
                aria-hidden
                className={`${styles.statusIcon} ${styles.statusIconReady}`}
              />
              <span>
                AI-assisted revisions record model and prompt provenance
              </span>
            </li>
          </ul>
          <div className={styles.panelFooter}>
            <Link href="/docs/provenance" className={styles.textLink}>
              Read the provenance guide
              <ArrowRightIcon aria-hidden />
            </Link>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              <FileClockIcon aria-hidden />
              Recent publication events
            </h2>
          </div>
          <div className={styles.activityTableShell}>
            <table className={styles.activityTable}>
              <thead>
                <tr>
                  <th scope="col">Term</th>
                  <th scope="col">Revision</th>
                  <th scope="col">Source</th>
                  <th scope="col">Published</th>
                  <th scope="col">Record</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentActivity.map((activity) => (
                  <tr key={activity.id}>
                    <td className="font-serif font-semibold">
                      {activity.term}
                    </td>
                    <td>
                      Definition {activity.definitionNumber} · revision{" "}
                      {activity.version}
                    </td>
                    <td className={styles.codeText}>
                      {activity.source.replaceAll("_", " ")}
                    </td>
                    <td className={styles.activityDate}>
                      <time dateTime={activity.createdAt}>
                        {formatDate(activity.createdAt)}
                      </time>
                    </td>
                    <td>
                      <Link
                        href={revisionPath(
                          activity.slug,
                          activity.definitionNumber,
                          activity.version,
                          activity.vocabularySlug
                        )}
                        className={styles.textLink}
                      >
                        Open
                        <ArrowRightIcon aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>
              <ShieldAlertIcon aria-hidden />
              Exceptional actions
            </h2>
          </div>
          <div className={styles.safetyNotice}>
            Permanent deletion remains a pre-pilot cleanup tool. It can remove
            revisions, votes, comments, and provenance. Lifecycle states,
            restoration, and an administrative action log must replace it before
            shared publication.
          </div>
        </section>
      </div>
    </>
  )
}
