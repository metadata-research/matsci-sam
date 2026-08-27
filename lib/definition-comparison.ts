import { DiffMatchPatch, DiffOp } from "diff-match-patch-ts"
import type { Diff } from "diff-match-patch-ts"

export type DefinitionComparisonMetrics = {
  charsAdded: number
  charsRemoved: number
  charsUnchanged: number
  beforeChars: number
  afterChars: number
  netChars: number
  beforeWords: number
  afterWords: number
  wordDelta: number
  editMagnitude: number
}

export type DefinitionTextComparison = {
  diff: Diff[]
  metrics: DefinitionComparisonMetrics
}

export type DefinitionComparisonBasis =
  | "initial"
  | "previous"
  | "derived-source"
  | "selected"

export type DefinitionRevisionReference = {
  definitionNumber: number
  version: number
  termSlug: string
  vocabularySlug: string
}

export type DefinitionComparisonView = DefinitionTextComparison & {
  basis: DefinitionComparisonBasis
  before: DefinitionRevisionReference | null
  after: DefinitionRevisionReference
  caveat: string | null
}

export type StoredDefinitionRevisionReference = DefinitionRevisionReference & {
  definitionDiff: Diff[]
  legacyIncomplete: boolean
}

export const LEGACY_REVISION_COMPARISON_CAVEAT =
  "The text snapshots are preserved, but some editor, note, or timestamp details were not recorded in the legacy history."

const reconstructableDiff = (diff: Diff[], target: string): Diff[] =>
  diff.some(([operation]) => operation !== DiffOp.Delete)
    ? diff
    : [...diff, [DiffOp.Equal, target]]

const wordCount = (text: string) => {
  const normalized = text.trim()
  return normalized ? normalized.split(/\s+/u).length : 0
}

export function diffToStringSimple(diff: Diff[]) {
  let value = ""
  for (const [operation, text] of diff) {
    if (operation === DiffOp.Insert || operation === DiffOp.Equal) value += text
  }
  return value
}

export function diffSourceText(diff: Diff[]) {
  let value = ""
  for (const [operation, text] of diff) {
    if (operation === DiffOp.Delete || operation === DiffOp.Equal) value += text
  }
  return value
}

/**
 * Canonical persistence diff. Keep its segmentation stable: revision metrics
 * and immutable database rows already depend on this exact operation.
 */
export function createTextDiff(previous: string, next: string): Diff[] {
  const diff = new DiffMatchPatch().diff_main(previous, next)
  return reconstructableDiff(diff, next)
}

/**
 * Read-time diff intended for people. Semantic cleanup may move operation
 * boundaries to more legible words, but never changes either reconstructed
 * text and is never written back to an immutable revision.
 */
export function createPresentationTextDiff(
  previous: string,
  next: string
): Diff[] {
  const differ = new DiffMatchPatch()
  const diff = differ.diff_main(previous, next)
  differ.diff_cleanupSemantic(diff)
  return reconstructableDiff(diff, next)
}

const diffCharacterCounts = (diffs: Diff[][]) => {
  let charsAdded = 0
  let charsRemoved = 0
  let charsUnchanged = 0

  for (const [operation, text] of diffs.flat()) {
    if (operation === DiffOp.Delete) charsRemoved += text.length
    else if (operation === DiffOp.Insert) charsAdded += text.length
    else charsUnchanged += text.length
  }

  return { charsAdded, charsRemoved, charsUnchanged }
}

const normalizedEditMagnitude = ({
  charsAdded,
  charsRemoved,
  charsUnchanged
}: ReturnType<typeof diffCharacterCounts>) => {
  const previousLength = charsUnchanged + charsRemoved
  const nextLength = charsUnchanged + charsAdded
  const removalShare =
    previousLength === 0
      ? Number(charsAdded > 0)
      : charsRemoved / previousLength
  const additionShare =
    nextLength === 0 ? Number(charsRemoved > 0) : charsAdded / nextLength

  return (removalShare + additionShare) / 2
}

/**
 * Existing stored revision-record metrics. Callers may pass definition and
 * compatibility-example diffs together, so the result must not be described
 * as definition-only without checking the inputs.
 */
export function revisionDiffMetrics(diffs: Diff[][]) {
  const counts = diffCharacterCounts(diffs)
  return {
    charsAdded: counts.charsAdded,
    charsRemoved: counts.charsRemoved,
    changeDelta: normalizedEditMagnitude(counts).toFixed(3)
  }
}

export function compareDefinitionText(
  previous: string,
  next: string
): DefinitionTextComparison {
  const diff = createPresentationTextDiff(previous, next)
  const counts = diffCharacterCounts([diff])
  const beforeWords = wordCount(previous)
  const afterWords = wordCount(next)

  return {
    diff,
    metrics: {
      ...counts,
      beforeChars: previous.length,
      afterChars: next.length,
      netChars: next.length - previous.length,
      beforeWords,
      afterWords,
      wordDelta: afterWords - beforeWords,
      editMagnitude: Number(normalizedEditMagnitude(counts).toFixed(3))
    }
  }
}

export function buildDefinitionComparison(input: {
  basis: DefinitionComparisonBasis
  before: (DefinitionRevisionReference & { text: string }) | null
  after: DefinitionRevisionReference & { text: string }
  caveat?: string | null
}): DefinitionComparisonView {
  const { text: afterText, ...after } = input.after
  const beforeText = input.before?.text ?? ""
  const before = input.before
    ? {
        definitionNumber: input.before.definitionNumber,
        version: input.before.version,
        termSlug: input.before.termSlug,
        vocabularySlug: input.before.vocabularySlug
      }
    : null

  return {
    basis: input.basis,
    before,
    after,
    caveat: input.caveat ?? null,
    ...compareDefinitionText(beforeText, afterText)
  }
}

export function buildStoredRevisionComparison(input: {
  basis: Exclude<DefinitionComparisonBasis, "selected">
  before: StoredDefinitionRevisionReference | null
  after: StoredDefinitionRevisionReference
}): DefinitionComparisonView {
  const before = input.before
    ? {
        definitionNumber: input.before.definitionNumber,
        version: input.before.version,
        termSlug: input.before.termSlug,
        vocabularySlug: input.before.vocabularySlug,
        text: diffToStringSimple(input.before.definitionDiff)
      }
    : null

  return buildDefinitionComparison({
    basis: input.basis,
    before,
    after: {
      definitionNumber: input.after.definitionNumber,
      version: input.after.version,
      termSlug: input.after.termSlug,
      vocabularySlug: input.after.vocabularySlug,
      text: diffToStringSimple(input.after.definitionDiff)
    },
    caveat:
      input.after.legacyIncomplete || input.before?.legacyIncomplete
        ? LEGACY_REVISION_COMPARISON_CAVEAT
        : null
  })
}
