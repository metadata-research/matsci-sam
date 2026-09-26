"use client"

import { OntologyContextPanel } from "@/components/ontology-context-panel"
import { usePresentedView } from "@/components/interface-view"

/** The Advanced sidebar. Its queries run only while the panel is shown. */
export function TermOntologyContext({ term }: { term: string }) {
  const advanced = usePresentedView() === "advanced"
  return (
    <aside
      hidden={!advanced}
      className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2"
      aria-label="Ontology context"
    >
      <OntologyContextPanel term={term} enabled={advanced} />
    </aside>
  )
}
