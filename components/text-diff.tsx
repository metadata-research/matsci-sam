import { DiffOp, type Diff } from "diff-match-patch-ts"

/** Shared presentation only. Persisted revision diffs are never rewritten here. */
export function DiffLegend() {
  return (
    <div
      className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
      aria-label="Difference legend"
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="rounded-sm bg-emerald-500/15 px-1 text-emerald-800 underline decoration-2 underline-offset-2 dark:text-emerald-300"
        >
          Added
        </span>
        inserted text
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="rounded-sm bg-destructive/15 px-1 text-destructive line-through decoration-2"
        >
          Removed
        </span>
        deleted text
      </span>
    </div>
  )
}

export function InlineTextDiff({ diff }: { diff: Diff[] }) {
  return diff.map(([operation, text], index) => {
    if (operation === DiffOp.Insert)
      return (
        <ins
          key={index}
          className="rounded-sm bg-emerald-500/15 px-0.5 text-emerald-800 decoration-2 underline-offset-2 dark:text-emerald-300"
        >
          <span className="sr-only">Added: </span>
          {text}
        </ins>
      )
    if (operation === DiffOp.Delete)
      return (
        <del
          key={index}
          className="rounded-sm bg-destructive/15 px-0.5 text-destructive decoration-2"
        >
          <span className="sr-only">Removed: </span>
          {text}
        </del>
      )
    return <span key={index}>{text}</span>
  })
}
