import type { Metadata } from "next"
import Link from "next/link"
import { SITE_NAME } from "@/lib/site"
import { listStudies, studiesOfViewer } from "@/lib/study-queries"
import { studyState } from "@/lib/communities"
import { getCurrentUser } from "@/lib/current-user"
import { communitiesIndexPath, studyPath } from "@/lib/public-identifiers"
import { Badge } from "@/components/ui/badge"
import { walkthroughProgress } from "@/components/studies/progress"

export const metadata: Metadata = {
  title: `Studies | ${SITE_NAME}`,
  description: `Term review studies run on ${SITE_NAME}, each joining a group of people to a set of terms.`
}

// The page varies by who is signed in, for the viewer's own section.
export const dynamic = "force-dynamic"

const STATE_LABEL = {
  draft: "Not open yet",
  open: "Open",
  closed: "Closed",
  retired: "Retired"
} as const

type Listed = Awaited<ReturnType<typeof listStudies>>[number]

const StudyItem = ({ study }: { study: Listed & { saved?: number } }) => {
  const progress = walkthroughProgress(study)

  return (
    <li>
      <Link
        href={studyPath(study.slug)}
        className="flex items-start justify-between gap-4 rounded-md border border-border p-4 transition-colors hover:bg-secondary/50"
      >
        <span className="space-y-1">
          <span className="flex items-center gap-2 font-medium">
            {study.title}
            <Badge variant="outline">{STATE_LABEL[studyState(study)]}</Badge>
          </span>
          <span className="block text-sm text-muted-foreground">
            {study.communityTitle} working through {study.collectionTitle}
            {progress && <> &middot; {progress}</>}
          </span>
        </span>
      </Link>
    </li>
  )
}

/*
 * Studies run here. A study joins one community to one collection and says
 * what its participants are being asked to do. A signed-in member sees the
 * studies of their communities first, with their saved progress; the public
 * list below is the same for everyone. Retired studies are not listed, and
 * their addresses keep resolving.
 */
export default async function StudiesPage() {
  const user = await getCurrentUser()
  const [studies, mine] = await Promise.all([
    listStudies(),
    user ? studiesOfViewer(user.id) : []
  ])
  const mineIds = new Set(mine.map((study) => study.id))
  const rest = studies.filter((study) => !mineIds.has(study.id))

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

        {studies.length === 0 && mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No studies are running.
          </p>
        ) : mine.length === 0 ? (
          <ul className="space-y-3">
            {studies.map((study) => (
              <StudyItem key={study.id} study={study} />
            ))}
          </ul>
        ) : (
          <>
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold">Your studies</h2>
              <ul className="space-y-3">
                {mine.map((study) => (
                  <StudyItem key={study.id} study={study} />
                ))}
              </ul>
            </div>
            {rest.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold">All studies</h2>
                <ul className="space-y-3">
                  {rest.map((study) => (
                    <StudyItem key={study.id} study={study} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}
