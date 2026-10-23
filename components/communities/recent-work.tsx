import { trpc } from "@/trpc/server"
import { withCommunityWorkReturn } from "@/lib/community-work-return"
import { formatDateTime } from "@/lib/date"
import { FieldDestinationLink } from "@/components/metadata-workspace/field-destination-link"

export async function RecentCommunityWork({
  vocabularySlug,
  workPath
}: {
  vocabularySlug: string
  workPath: string
}) {
  const [terms, fields] = await Promise.all([
    trpc.termDrafts.list({ vocabularySlug }),
    trpc.matcoreWorkflow.list({
      vocabularySlug,
      recentUnpublished: true,
      limit: 3
    })
  ])
  const recent = [
    ...terms.map((draft) => ({
      id: draft.id,
      label: draft.term || "Untitled term",
      kind: "Term",
      updatedAt: draft.updatedAt,
      href: withCommunityWorkReturn(
        `/add?draftId=${draft.id}`,
        `${workPath}#term-drafts`
      )
    })),
    ...fields.drafts.map((draft) => ({
      id: draft.id,
      label: draft.label || "Untitled field",
      kind: "Metadata field",
      updatedAt: draft.updatedAt,
      href: withCommunityWorkReturn(
        `/metadata/workspace/${draft.id}`,
        `${workPath}#my-field-drafts`
      )
    }))
  ]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3)
  if (!recent.length) return null
  return (
    <section aria-labelledby="recent-work" className="flex flex-col gap-3">
      <h2 id="recent-work" className="text-xl font-semibold">
        Continue your work
      </h2>
      <p className="text-sm text-muted-foreground">
        These drafts are private to you.
      </p>
      <ul className="divide-y rounded-lg border">
        {recent.map((draft) => (
          <li key={draft.id}>
            <FieldDestinationLink
              href={draft.href}
              className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-accent"
            >
              <span className="min-w-0 break-words font-medium">
                {draft.label}
              </span>
              <span className="text-sm text-muted-foreground">
                {draft.kind} · Saved {formatDateTime(draft.updatedAt)}
              </span>
            </FieldDestinationLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
