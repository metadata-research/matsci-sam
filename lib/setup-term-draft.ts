import type { TermDraftPayload } from "./term-draft-types"

/** Context-bound evidence must be changed through the full editor's controls. */
export function termDraftHasEvidence(payload: TermDraftPayload) {
  const editor = payload.editorState
  return Boolean(
    payload.aiSuggestionId ||
      editor?.preview ||
      editor?.appliedDraft ||
      payload.files.length ||
      payload.references.some((item) => item.citedReferenceIds.length) ||
      editor?.references.some(
        (item) => item.citedReferenceIds.length || item.modelReferenceIds.length
      ) ||
      editor?.undo?.appliedDraft ||
      editor?.undo?.references.some((item) => item.citedReferenceIds.length)
  )
}

export function changeSetupTerm(
  payload: TermDraftPayload,
  term: string
): TermDraftPayload {
  if (termDraftHasEvidence(payload)) return payload
  return {
    ...payload,
    term,
    editorState: payload.editorState
      ? {
          ...payload.editorState,
          confirmed: null,
          step: "confirm",
          undo: null
        }
      : null
  }
}
