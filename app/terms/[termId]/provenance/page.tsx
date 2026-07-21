import { trpc } from "@/trpc/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { ProvenanceGraph } from "@/components/provenance/graph"
import { ProvenanceTimeline } from "@/components/provenance/timeline"

// Public, read-only PROV-O view of a term's history. Voter identities are
// anonymized server-side (see terms.provenance).
export default async function PublicTermProvenancePage(props: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await props.params

  const provenance = await trpc.terms
    .provenance(Number(termId))
    .catch(() => null)
  if (!provenance) notFound()

  return (
    <main className="px-4 p-8">
      <section className="max-w-4xl w-full mx-auto space-y-4">
        <Link
          href={`/terms/${provenance.term.id}`}
          className="flex items-center text-primary"
        >
          <ArrowLeftIcon className="mr-2 size-4" /> Definitions for{" "}
          {provenance.term.term}
        </Link>
        <h1 className="text-3xl font-bold font-serif">
          Provenance: {provenance.term.term}
        </h1>
        <p className="text-sm text-muted-foreground">
          The history of the definitions of this term as a W3C PROV-O graph,
          covering each writing, edit, AI generation, refinement, comment,
          and vote. Click a node for details, or download the graph as{" "}
          <a
            href={`/terms/${provenance.term.id}/provenance.ttl`}
            className="text-primary font-mono text-xs"
          >
            PROV-O Turtle
          </a>
          .
        </p>
        <ProvenanceGraph
          nodes={provenance.graph.nodes}
          edges={provenance.graph.edges}
        />
        <h2 className="text-xl font-semibold pt-2">Timeline</h2>
        <ProvenanceTimeline events={provenance.events} />
      </section>
    </main>
  )
}
