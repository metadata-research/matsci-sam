import { trpc } from "@/trpc/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { ProvenanceGraph } from "@/components/provenance/graph"
import { ProvenanceTimeline } from "@/components/provenance/timeline"
import { AdminPageHeader } from "../../../page-header"
import styles from "../../../admin.module.css"

export default async function TermProvenancePage(props: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await props.params

  const provenance = await trpc.admin
    .provenance(Number(termId))
    .catch(() => null)
  if (!provenance) notFound()

  return (
    <>
      <AdminPageHeader
        title={`Provenance: ${provenance.term.term}`}
        description="W3C PROV-O view derived from the term's definitions, revisions, comments, and AI activity. Select a node for details."
        actions={
          <Link
            href={`/admin/terms/${provenance.term.id}`}
            className={styles.textLink}
          >
            <ArrowLeftIcon aria-hidden />
            Back to {provenance.term.term}
          </Link>
        }
      />
      <div className={styles.sectionStack}>
        <section
          className={`${styles.panel} p-4`}
          aria-label="Provenance graph"
        >
          <ProvenanceGraph
            nodes={provenance.graph.nodes}
            edges={provenance.graph.edges}
          />
        </section>
        <section aria-labelledby="provenance-timeline-heading">
          <h2 id="provenance-timeline-heading" className={styles.sectionTitle}>
            Timeline
          </h2>
          <ProvenanceTimeline events={provenance.events} />
        </section>
      </div>
    </>
  )
}
