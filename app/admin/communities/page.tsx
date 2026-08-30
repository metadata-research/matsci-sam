import Link from "next/link"
import { UsersRoundIcon } from "lucide-react"
import { AdminPageHeader } from "../page-header"
import styles from "../admin.module.css"
import { listAdminCommunities } from "@/lib/admin-community-queries"
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

export const metadata = {
  title: "Communities"
}

export default async function AdminCommunitiesPage() {
  const communities = await listAdminCommunities()

  return (
    <>
      <AdminPageHeader
        title="Communities"
        description="Manage who is in each community and how people are admitted, separate from the studies a community runs."
      />

      <section className={styles.panel}>
        {communities.length === 0 ? (
          <div className={styles.emptyState}>
            <div>
              <UsersRoundIcon aria-hidden />
              <h2>No communities yet</h2>
              <p>
                Communities are created on the public communities page. Each
                one appears here with its roster and invitations.
              </p>
            </div>
          </div>
        ) : (
          <Table className={styles.recordTable}>
            <TableHeader>
              <TableRow>
                <TableHead>Community</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Stewards</TableHead>
                <TableHead>Studies</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Manage</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {communities.map((community) => (
                <TableRow className={styles.recordTableRow} key={community.id}>
                  <TableCell>
                    <div className={styles.studyNameCell}>
                      <Link
                        className={styles.activityTerm}
                        href={`/admin/communities/${community.id}`}
                      >
                        {community.title}
                      </Link>
                      <span className={styles.codeText}>/{community.slug}</span>
                    </div>
                  </TableCell>
                  <TableCell data-label="People">
                    <span
                      className={
                        community.members > 0
                          ? styles.tableMetric
                          : styles.tableMetricEmpty
                      }
                    >
                      {community.members}
                    </span>
                  </TableCell>
                  <TableCell data-label="Stewards">
                    <span
                      className={
                        community.stewards > 0
                          ? styles.tableMetric
                          : styles.tableMetricEmpty
                      }
                    >
                      {community.stewards}
                    </span>
                  </TableCell>
                  <TableCell data-label="Studies">
                    <span
                      className={
                        community.studies > 0
                          ? styles.tableMetric
                          : styles.tableMetricEmpty
                      }
                    >
                      {community.studies}
                    </span>
                  </TableCell>
                  <TableCell data-label="Status">
                    <Badge
                      variant={community.retiredAt ? "secondary" : "outline"}
                    >
                      {community.retiredAt ? "Retired" : "Active"}
                    </Badge>
                  </TableCell>
                  <TableCell data-label="Manage">
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        href={`/admin/communities/${community.id}`}
                        aria-label={`Manage membership of ${community.title}`}
                      >
                        <UsersRoundIcon data-icon="inline-start" aria-hidden />
                        Membership
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  )
}
