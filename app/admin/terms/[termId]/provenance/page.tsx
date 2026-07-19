import { trpc } from "@/trpc/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { ProvenanceGraph } from "./graph";
import { ProvenanceTimeline } from "./timeline";

export default async function TermProvenancePage(props: {
  params: Promise<{ termId: string }>;
}) {
  const { termId } = await props.params;

  const provenance = await trpc.admin
    .provenance(Number(termId))
    .catch(() => null);
  if (!provenance) notFound();

  return (
    <div className="space-y-4">
      <Link
        href={`/admin/terms/${provenance.term.id}`}
        className="flex items-center text-blue-500"
      >
        <ArrowLeftIcon className="mr-2 size-4" /> {provenance.term.term}
      </Link>
      <h2 className="text-2xl font-semibold">
        Provenance: {provenance.term.term}
      </h2>
      <p className="text-sm text-muted-foreground">
        W3C PROV-O view derived from the term&apos;s definitions, edits,
        comments, and AI chat history. Click a node for details.
      </p>
      <ProvenanceGraph
        nodes={provenance.graph.nodes}
        edges={provenance.graph.edges}
      />
      <h3 className="text-xl font-semibold pt-2">Timeline</h3>
      <ProvenanceTimeline events={provenance.events} />
    </div>
  );
}
