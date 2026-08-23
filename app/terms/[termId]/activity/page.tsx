import { trpc } from "@/trpc/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { UsersImpact } from "@/components/activity/user-impact"
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import { TermTimeline } from "@/components/activity/activity-timeline"
import "./activity.css"

// Public, read-only PROV-O view of a term's history. Voter identities are
// anonymized server-side (see terms.provenance).
export default async function PublicTermActivityPage(props: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await props.params
  const activity = await trpc.terms.activity(Number(termId));
  if (!activity) notFound()
  const impact = await trpc.terms.impact(Number(termId));
  if (!impact) notFound()
  return (
    <main className="px-4 p-8">
      <section className="max-w-4xl w-full mx-auto space-y-4">
        <Link
          href={`/terms/${activity.term.id}`}
          className="flex items-center text-primary"
        >
          <ArrowLeftIcon className="mr-2 size-4" /> Definitions for{" "}
          {activity.term.term}
        </Link>
        <h1 className="text-3xl font-bold font-serif">
          Activity: {activity.term.term}
        </h1>
        <p className="text-sm text-muted-foreground">
          The history of all editing activity for definitions of this term as a line chart
          displaying the total impact of edits over time, and a ranking of users based on the
          proportion of new data they authored
        </p>
        <AppRouterCacheProvider >
          <TermTimeline tl={activity} />
          <div style={{ display: 'flex', flexDirection: 'row' }}>
            <UsersImpact users={impact} />
            <p style={{ paddingTop: 25, paddingLeft: 25, width: 625 }}>Every revision has an associated impact score, calculated using the percent of characters that were removed, and the percent that were added. The result is a number between 0 and 1, where 0 represents no change, and 1 represents a complete change, with none of the original data present. For example, the initial revision, when a definition is created, is assigned an impact score of 1. This ranking takes the sum of the impact scores related to this term for each user who authored a revision, and ranks the users based on what percent of all the revisions they authored.</p>
          </div>
        </AppRouterCacheProvider >
      </section>
    </main >
  )
}
