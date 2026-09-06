// Shared by browser ordering and RDF projection. Recency belongs to the
// candidate, not its latest edit. Numbers only break exact timestamp ties.
export type RankedDefinition = {
  score: number
  createdAt: string
  definitionNumber: number
}
export function compareDefinitions(a: RankedDefinition, b: RankedDefinition) {
  return (
    b.score - a.score ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
    b.definitionNumber - a.definitionNumber
  )
}
