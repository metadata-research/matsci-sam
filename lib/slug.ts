/*
 * Human-readable identifiers for terms.
 *
 * Spaces become underscores rather than hyphens because this vocabulary is
 * full of meaningful hyphens -- "high-entropy alloy" must round-trip as
 * `high-entropy_alloy`, not `high-entropy-alloy`, which loses the distinction
 * between a compound modifier and a word break. Wikipedia uses underscores for
 * the same reason.
 *
 * Everything outside [a-z0-9_-] is dropped, so "density functional theory
 * (dft)" becomes `density_functional_theory_dft`.
 *
 * A slug is a public identifier: once a term has one it should never change,
 * because published IRIs and citations depend on it. Nothing in the app edits
 * `terms.term`, so slugs are stable today. If renaming is ever added, retire
 * the old slug into a history table and keep resolving it rather than
 * reassigning it.
 */

export const slugify = (term: string): string =>
  term
    .normalize("NFKD")
    // strip combining marks left by the decomposition
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/_{2,}/g, "_")
    .replace(/-{2,}/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "")

/*
 * Terms are unique, but two distinct terms can still normalize to one slug
 * ("Band Gap" and "band gap"). Disambiguate the way OED numbers homographs --
 * a numeric suffix on the entry (`band_gap_2`) rather than a path segment,
 * which would imply the second is contained by the first.
 *
 * `taken` is the set of slugs already in use.
 */
export const uniqueSlug = (term: string, taken: Set<string>): string => {
  const base = slugify(term) || "term"
  if (!taken.has(base)) return base

  let n = 2
  while (taken.has(`${base}_${n}`)) n++

  return `${base}_${n}`
}
