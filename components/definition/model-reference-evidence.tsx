import type { ModelReferenceInput } from "@/lib/reference-types"
import { ReferenceSnapshot } from "./reference-snapshot"

export function modelPromptReferenceSummary(count: number) {
  return `${count} ${count === 1 ? "reference was" : "references were"} included in the prompt.`
}

/** Immutable request evidence, independent of current citation/input checkboxes. */
export function ModelReferenceEvidence({
  inputs
}: {
  inputs: ModelReferenceInput[]
}) {
  if (inputs.length === 0) return null
  return (
    <details className="min-w-0 rounded-md border p-3 text-sm">
      <summary className="cursor-pointer">
        Inspect references included in the prompt ({inputs.length})
      </summary>
      <div className="mt-3 flex min-w-0 flex-col gap-3">
        {inputs.map((input) => (
          <ReferenceSnapshot key={input.referenceId} reference={input} />
        ))}
      </div>
    </details>
  )
}
