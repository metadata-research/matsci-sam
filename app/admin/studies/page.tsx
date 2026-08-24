import Link from "next/link"
import {
  ArrowRightIcon,
  BookOpenIcon,
  FlaskConicalIcon,
  PencilIcon
} from "lucide-react"
import { AdminPageHeader } from "../page-header"
import styles from "../admin.module.css"
import { adminStudyOptions, listAdminStudies } from "@/lib/admin-study-queries"
import { studyState, type StudyState } from "@/lib/communities"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { CreateStudyDialog } from "./create-study-dialog"

export const metadata = {
  title: "Studies"
}

const STATE_LABEL: Record<StudyState, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  retired: "Retired"
}

export default async function AdminStudiesPage() {
  const [studies, options] = await Promise.all([
    listAdminStudies(),
    adminStudyOptions()
  ])

  return (
    <>
      <AdminPageHeader
        title="Studies"
        description="Create studies and maintain the instructions participants see."
        actions={<CreateStudyDialog options={options} />}
      />

      <section className={styles.panel}>
        {studies.length === 0 ? (
          <div className={styles.emptyState}>
            <div>
              <FlaskConicalIcon aria-hidden />
              <h2>No studies yet</h2>
              <p>
                Create the first study to connect a community, a collection, and
                a clear block of participant instructions.
              </p>
            </div>
          </div>
        ) : (
          <Table className={styles.recordTable}>
            <TableHeader>
              <TableRow>
                <TableHead>Study</TableHead>
                <TableHead>Community</TableHead>
                <TableHead>Collection</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>
                  <span className="sr-only">Edit</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studies.map((study) => {
                const state = studyState(study)
                return (
                  <TableRow className={styles.recordTableRow} key={study.id}>
                    <TableCell>
                      <div className={styles.studyNameCell}>
                        <Link
                          className={styles.activityTerm}
                          href={`/admin/studies/${study.id}`}
                        >
                          {study.title}
                        </Link>
                        <span className={styles.codeText}>/{study.slug}</span>
                      </div>
                    </TableCell>
                    <TableCell data-label="Community">
                      {study.communityTitle}
                    </TableCell>
                    <TableCell data-label="Collection">
                      {study.collectionTitle}
                    </TableCell>
                    <TableCell data-label="Status">
                      <Badge
                        variant={state === "retired" ? "secondary" : "outline"}
                      >
                        {STATE_LABEL[state]}
                      </Badge>
                    </TableCell>
                    <TableCell data-label="Activity">
                      <span
                        className={
                          study.activity > 0
                            ? styles.tableMetric
                            : styles.tableMetricEmpty
                        }
                      >
                        {study.activity}
                      </span>
                    </TableCell>
                    <TableCell data-label="Edit">
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`/admin/studies/${study.id}`}
                          aria-label={`Edit ${study.title}`}
                        >
                          <PencilIcon data-icon="inline-start" aria-hidden />
                          Edit
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        <div className={styles.panelFooter}>
          <Link href="/admin/studies/reference" className={styles.textLink}>
            <BookOpenIcon aria-hidden />
            Read the protocol reference
            <ArrowRightIcon aria-hidden />
          </Link>
        </div>
      </section>
    </>
  )
}
