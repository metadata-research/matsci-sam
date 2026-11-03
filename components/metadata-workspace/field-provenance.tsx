"use client"

import { useMemo } from "react"
import Link from "next/link"
import { ProvenanceGraph } from "@/components/provenance/graph"
import {
  fieldRevisionProvenance,
  type FieldRevision,
  type PublishedFieldRecord
} from "@/lib/metadata-field-provenance"
import { FieldChanges, type FieldDifference } from "./field-changes"

export function FieldProvenance({
  record,
  revision,
  differences,
  comparisonLabel
}: {
  record: PublishedFieldRecord
  revision: FieldRevision
  differences: FieldDifference[]
  comparisonLabel: string | null
}) {
  const graph = useMemo(
    () => fieldRevisionProvenance(record, revision),
    [record, revision]
  )
  return (
    <ProvenanceGraph
      {...graph}
      renderExtraDetails={(node) => {
        if (node.id === `revision:${revision.id}`)
          return comparisonLabel ? (
            <section className="space-y-3">
              <h3 className="font-medium">Changes from {comparisonLabel}</h3>
              <FieldChanges differences={differences} />
            </section>
          ) : (
            <p className="whitespace-pre-wrap break-words">
              {revision.payload.definition}
            </p>
          )
        if (node.id.startsWith("revision:"))
          return (
            <Link
              className="underline underline-offset-4"
              href={`/metadata/fields/${record.field.id}?revision=${node.id.slice("revision:".length)}`}
            >
              Open this revision
            </Link>
          )
        return null
      }}
    />
  )
}
