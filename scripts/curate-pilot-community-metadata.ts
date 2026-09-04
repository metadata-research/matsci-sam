export type CommunityMetadataMode = "preserve" | "exact"

export type CommunityMetadata = {
  title: string
  description: string | null
}

export type PairedCommunityMetadata = {
  community: CommunityMetadata
  vocabulary: CommunityMetadata
}

export type CommunityMetadataChange = {
  target: keyof PairedCommunityMetadata
  field: keyof CommunityMetadata
  before: string | null
  after: string | null
}

export const normalizeCommunityMetadata = (input: {
  title: string
  description: string
}): CommunityMetadata => ({
  title: input.title,
  description: input.description || null
})

export const planCommunityMetadata = (
  mode: CommunityMetadataMode,
  current: PairedCommunityMetadata,
  desired: CommunityMetadata
): CommunityMetadataChange[] => {
  if (mode === "preserve") return []

  const changes: CommunityMetadataChange[] = []
  for (const target of ["community", "vocabulary"] as const) {
    for (const field of ["title", "description"] as const) {
      const before = current[target][field]
      const after = desired[field]
      if (before !== after) changes.push({ target, field, before, after })
    }
  }
  return changes
}

export const samePairedCommunityMetadata = (
  left: PairedCommunityMetadata,
  right: PairedCommunityMetadata
) =>
  (["community", "vocabulary"] as const).every((target) =>
    (["title", "description"] as const).every(
      (field) => left[target][field] === right[target][field]
    )
  )

export const communityMetadataChangeNote = (
  changes: readonly CommunityMetadataChange[]
) =>
  changes
    .map(
      (change) =>
        `${change.target} ${change.field} ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`
    )
    .join(", ")

export const communityMetadataUpdateRefusal = (input: {
  slug: string
  isAdmin: boolean
  changes: readonly CommunityMetadataChange[]
}) =>
  input.changes.length > 0 && !input.isAdmin
    ? `updating community ${input.slug} metadata is a curator's act`
    : null
