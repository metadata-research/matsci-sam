import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { AdminPageHeader } from "../page-header"
import styles from "../admin.module.css"
import { DRIFT_THRESHOLD, tagsWithDrift } from "@/lib/kos-queries"
import { conceptPath, termPath } from "@/lib/public-identifiers"
import { formatDate } from "@/lib/date"

/*
 * Tags whose meaning may have moved.
 *
 * A tag linked to a term takes its meaning from that term's definitions, and
 * definitions keep changing. This lists the tags where a substantial revision
 * landed after things had already been filed under them, so a curator can
 * decide whether the tag still means what it meant. The remedy is a scope
 * note, or retiring the tag and minting a replacement, never a silent edit.
 */
export default async function AdminTagsPage() {
  const drifting = await tagsWithDrift()

  return (
    <>
      <AdminPageHeader
        title="Tag drift"
        description={`Tags linked to a term whose definitions have changed by at least ${Math.round(
          Number(DRIFT_THRESHOLD) * 100
        )} percent since statements were filed under them.`}
      />

      {drifting.length === 0 ? (
        <section className={styles.panel}>
          <div className={styles.emptyState}>
            <p>No linked tag has drifted.</p>
            <p>
              A tag appears here once a definition of the term it is linked to
              is substantially rewritten after the tag was already in use.
            </p>
          </div>
        </section>
      ) : (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Review these tags</h2>
            <p className={styles.panelMeta}>
              {drifting.length === 1 ? "1 tag" : `${drifting.length} tags`}
            </p>
          </div>
          <div className={styles.activityTableShell}>
            <table className={styles.activityTable}>
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Term</th>
                  <th scope="col">Filed</th>
                  <th scope="col">Largest change</th>
                  <th scope="col">Changed</th>
                  <th scope="col">Record</th>
                </tr>
              </thead>
              <tbody>
                {drifting.map((row) => (
                  <tr key={row.conceptId}>
                    <td className={styles.activityTerm}>{row.conceptLabel}</td>
                    <td className={styles.activityTerm}>
                      <Link
                        href={termPath(row.termSlug)}
                        className={styles.textLink}
                      >
                        {row.termLabel}
                      </Link>
                    </td>
                    <td>{row.filedCount}</td>
                    <td>{Math.round(Number(row.largestChange) * 100)}%</td>
                    <td className={styles.activityDate}>
                      {formatDate(row.changedAt)}
                    </td>
                    <td>
                      <Link
                        href={conceptPath(row.schemeSlug, row.conceptSlug)}
                        className={styles.textLink}
                      >
                        Open <ArrowRightIcon aria-hidden className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
