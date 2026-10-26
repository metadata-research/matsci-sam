/** A field name is separate from its schema location and source profile. */
export function sourceFieldName(source: { path: string[]; sourceKey: string }) {
  return source.path.at(-1) || source.sourceKey
}

export function proposalFieldName(
  label: string,
  source: { path: string[]; sourceKey: string } | null,
  baseline: { label: string } | null
) {
  return source && baseline && label === baseline.label
    ? sourceFieldName(source)
    : label
}
