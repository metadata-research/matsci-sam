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
        <AppRouterCacheProvider >
          <TermTimeline tl={activity} />
          <UsersImpact users={impact} />
        </AppRouterCacheProvider >
      </section>
    </main>
  )
}
