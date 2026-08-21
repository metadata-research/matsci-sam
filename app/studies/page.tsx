import type { Metadata } from "next"
import Link from "next/link"
import { SITE_NAME } from "@/lib/site"
import { listStudies } from "@/lib/study-queries"
import { studyState } from "@/lib/communities"
import { communitiesIndexPath, studyPath } from "@/lib/public-identifiers"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = {
  title: `Studies | ${SITE_NAME}`,
  description: `Term review studies run on ${SITE_NAME}, each joining a group of people to a set of terms.`
}

const STATE_LABEL = {
  draft: "Not open yet",
  open: "Open",
  closed: "Closed",
  retired: "Retired"
} as const

/*
 * Studies run here. A study joins one community to one collection and says
 * what its participants are being asked to do. Retired studies are not listed,
 * and their addresses keep resolving.
 */
export default async function StudiesPage() {
  const studies = await listStudies()

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Studies</h1>
          <p className="text-muted-foreground">
            A study asks a group of people to work through a set of terms. A{" "}
            <Link href={communitiesIndexPath} className="text-primary">
              community
            </Link>{" "}
            runs it.
          </p>
        </div>

        {studies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No studies are running.
          </p>
        ) : (
          <ul className="space-y-3">
            {studies.map((study) => (
              <li key={study.id}>
                <Link
                  href={studyPath(study.slug)}
                  className="flex items-start justify-between gap-4 rounded-md border border-border p-4 transition-colors hover:bg-secondary/50"
                >
                  <span className="space-y-1">
                    <span className="flex items-center gap-2 font-medium">
                      {study.title}
                      <Badge variant="outline">
                        {STATE_LABEL[studyState(study)]}
                      </Badge>
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {study.communityTitle} working through{" "}
                      {study.collectionTitle}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
