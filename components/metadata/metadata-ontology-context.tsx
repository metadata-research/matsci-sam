"use client"

import { Button } from "@/components/ui/button"
import { usePresentedView } from "@/components/interface-view"
import {
  OntologyContextPanel,
  type OntologySelection
} from "@/components/ontology-context-panel"
import { useFillMetadataDraft } from "./metadata-draft"

// The server's limit for a source name or citation.
const SOURCE_LABEL_MAX = 200
const clip = (text: string) =>
  text.length > SOURCE_LABEL_MAX
    ? `${text.slice(0, SOURCE_LABEL_MAX - 1)}…`
    : text

/**
 * The term's ontology matches beside the Add metadata form. A selected match
 * can fill the form's source, or a related concept citing its release. The
 * contributor still reviews and submits.
 */
export function MetadataOntologyContext({
  term,
  canCite
}: {
  term: string
  canCite: boolean
}) {
  // The sidebar shows in Advanced only, so it queries in Advanced only.
  const advanced = usePresentedView() === "advanced"
  const fill = useFillMetadataDraft()
  const actions = ({ source, entity }: OntologySelection) => {
    const version = source.version ?? ""
    return (
      <div className="flex flex-col gap-2 border-t pt-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              fill({
                source: {
                  label: clip(`${source.title}: ${entity.label}`),
                  iri: entity.iri,
                  version
                },
                focus: "source",
                status: `Source filled from ${source.title}: ${entity.label}.`
              })
            }
          >
            Cite this match
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              fill({
                fieldKey: "relatedConcept",
                value: entity.iri,
                source: { label: clip(source.title), iri: "", version },
                focus: "value",
                status: `Related concept filled: ${entity.label} in ${source.title}.`
              })
            }
          >
            Add as related concept
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each fills the Add metadata form. Nothing is saved until you submit.
        </p>
      </div>
    )
  }
  return (
    <OntologyContextPanel
      term={term}
      enabled={advanced}
      actions={canCite ? actions : undefined}
    />
  )
}
