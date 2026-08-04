// Human-readable labels for definition revision sources, shared by every
// surface that renders revision history so the vocabulary cannot drift.
export const revisionSourceLabels = {
  initial: "Initial revision",
  author_edit: "Author revision",
  ai_refinement: "AI-assisted revision",
  ai_generation: "AI-generated revision",
  rollback: "Restored revision",
  legacy: "Imported revision"
} as const

export type RevisionSource = keyof typeof revisionSourceLabels

// The sources produced by the model rather than a person; used to pick the
// gold AI treatment in revision lists.
export const aiRevisionSources: ReadonlySet<string> = new Set([
  "ai_refinement",
  "ai_generation"
])
