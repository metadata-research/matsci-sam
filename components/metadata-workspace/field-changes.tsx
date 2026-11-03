import { createPresentationTextDiff } from "@/lib/definition-comparison"
import { DiffLegend, InlineTextDiff } from "@/components/text-diff"

export type FieldDifference = { label: string; before: string; after: string }

export function FieldChanges({
  differences
}: {
  differences: FieldDifference[]
}) {
  if (!differences.length)
    return <p className="text-sm text-muted-foreground">No changes.</p>
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <DiffLegend />
      <dl className="flex min-w-0 flex-col gap-3">
        {differences.map(({ label, before, after }) => (
          <div key={label} className="min-w-0 rounded-md border p-3 text-sm">
            <dt className="mb-2 font-medium">{label}</dt>
            <dd className="whitespace-pre-wrap break-words leading-7 [overflow-wrap:anywhere]">
              <InlineTextDiff
                diff={createPresentationTextDiff(before, after)}
              />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
