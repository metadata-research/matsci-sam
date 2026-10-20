/** A comparison/binding key, not scientific text normalization. Keep original
 * labels separately; only outer whitespace and letter case are ignored. */
export function termLabelKey(value: string) {
  return value.trim().toLowerCase()
}
