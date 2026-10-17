import type { ModelReferenceInput } from "@/lib/reference-types"
import { ReferenceSnapshot } from "./reference-snapshot"

export function modelPromptEvidenceSummary(
  referenceCount: number | undefined,
  sourceCount = 0
) {
  const inputs: string[] = []
  if (sourceCount > 0)
    inputs.push(
      `${sourceCount} uploaded or pasted ${sourceCount === 1 ? "source" : "sources"}`
    )
  if (referenceCount !== undefined && referenceCount > 0)
    inputs.push(
      `${referenceCount} lookup ${referenceCount === 1 ? "reference" : "references"}`
    )
  if (inputs.length === 0)
    return referenceCount === undefined
      ? "Source counts were not recorded for this suggestion."
      : "No uploaded or pasted sources or lookup references were recorded for this suggestion."
  return `${inputs.join(" and ")} ${(referenceCount ?? 0) + sourceCount === 1 ? "was" : "were"} sent to the assistant.`
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
        Inspect lookup references sent to the assistant ({inputs.length})
      </summary>
      <div className="mt-3 flex min-w-0 flex-col gap-3">
        {inputs.map((input) => (
          <ReferenceSnapshot key={input.referenceId} reference={input} />
        ))}
      </div>
    </details>
  )
}
