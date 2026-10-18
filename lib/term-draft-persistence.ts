import type { TermDraftEditorState, TermDraftPayload } from "./term-draft-types"

type ModelSnapshot = NonNullable<TermDraftEditorState["preview"]>
type WritingSnapshot = ModelSnapshot["baseline"]

const copyWriting = (writing: WritingSnapshot): WritingSnapshot => ({
  definition: writing.definition,
  references: writing.references.map((reference) => ({
    ...reference,
    citedReferenceIds: [...reference.citedReferenceIds],
    modelReferenceIds: [...reference.modelReferenceIds]
  }))
})

/** Store editor choices only. Generated text and evidence are restored from the
 * owner's saved suggestion, whose receipt can be larger than the draft limit. */
const compactModelSnapshot = (
  snapshot: ModelSnapshot | null
): ModelSnapshot | null =>
  snapshot
    ? {
        suggestionId: snapshot.suggestionId,
        term: snapshot.term,
        contextKey: snapshot.contextKey,
        baseline: copyWriting(snapshot.baseline),
        promptInputs: snapshot.promptInputs.map((input) => ({
          id: input.id,
          label: input.label,
          text: "",
          included: input.included,
          ...(input.required === undefined ? {} : { required: input.required })
        }))
      }
    : null

export function compactTermDraftEditorState(
  state: TermDraftEditorState | null
): TermDraftEditorState | null {
  if (!state) return null
  return {
    ...state,
    confirmed: state.confirmed ? { ...state.confirmed } : null,
    references: copyWriting({ definition: "", references: state.references })
      .references,
    preview: compactModelSnapshot(state.preview),
    appliedDraft: compactModelSnapshot(state.appliedDraft),
    undo: state.undo
      ? {
          ...copyWriting(state.undo),
          kind: state.undo.kind,
          label: state.undo.label,
          appliedDraft: compactModelSnapshot(state.undo.appliedDraft)
        }
      : null
  }
}

export function compactTermDraftPayload(
  payload: TermDraftPayload
): TermDraftPayload {
  return {
    ...payload,
    references: payload.references.map((reference) => ({
      ...reference,
      citedReferenceIds: [...reference.citedReferenceIds]
    })),
    files: payload.files.map((file) => ({ ...file })),
    sources: (payload.sources ?? []).map((source) => ({
      ...source,
      passageIds: [...source.passageIds]
    })),
    editorState: compactTermDraftEditorState(payload.editorState)
  }
}
