"use client"

import { useLayoutEffect } from "react"
import type { TermDraftPayload } from "@/lib/term-draft-types"

/** Only the network save is debounced. Committed editor choices must reach the
 * queue before paint so save status and navigation guards describe those choices. */
export function useCommittedTermDraftPayload(
  serializedPayload: string,
  setPayload?: (payload: TermDraftPayload) => void
) {
  useLayoutEffect(() => {
    if (setPayload && serializedPayload !== "null")
      setPayload(JSON.parse(serializedPayload) as TermDraftPayload)
  }, [serializedPayload, setPayload])
}
