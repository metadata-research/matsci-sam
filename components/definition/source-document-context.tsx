"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  contributionFilePath,
  type ContributionFileItem
} from "@/lib/contribution-file-types"
import {
  SOURCE_MAX_ALIASES,
  SOURCE_MAX_CHARACTERS,
  SOURCE_MAX_SELECTED_PASSAGES,
  sourceSelectionText,
  type SourceContextSelection,
  type SourceDocumentCheck,
  type SourceExtractionResult,
  type SourceMatch,
  type SourceInputSnapshot
} from "@/lib/source-document-types"

type SavedExtraction = Partial<SourceExtractionResult> & {
  id: string
  status: "queued" | "processing" | "ready" | "failed"
  error?: string | null
}
type SavedCheck = SourceDocumentCheck & { id: string; extractionId: string }
type SourceResponse = {
  extraction: SavedExtraction | null
  check?: SavedCheck | null
  latestCheck?: SavedCheck | null
}
export type SourceContextPreview = {
  fileId: string
  title: string
  text: string
  ready: boolean
}

/** Evidence from the saved generation, independent of current source choices. */
export function SourceInputEvidence({
  inputs
}: {
  inputs: SourceInputSnapshot[]
}) {
  if (!inputs.length) return null
  return (
    <section
      aria-label="Sources used by assistant"
      className="space-y-3 text-sm"
    >
      <p className="font-medium">Sources used by assistant</p>
      {inputs.map((input) => (
        <details
          key={`${input.fileId}:${input.checkId}`}
          className="rounded-md border p-3"
        >
          <summary className="cursor-pointer font-medium">
            {input.title} ·{" "}
            {input.mode === "full" ? "full text" : "selected passages"}
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            This text was sent for this suggestion
            {input.hasOcr ? " and includes reviewed OCR" : ""}. It stays with
            the published definition if you use the suggestion.
          </p>
          <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
            {input.text}
          </p>
        </details>
      ))}
    </section>
  )
}

function MatchedText({
  text,
  matches,
  offset = 0
}: {
  text: string
  matches: SourceMatch[]
  offset?: number
}) {
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const match of [...matches].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, match.start - offset)
    const end = Math.min(text.length, match.end - offset)
    if (end <= cursor || start >= text.length) continue
    parts.push(text.slice(cursor, Math.max(cursor, start)))
    parts.push(
      <mark key={match.id}>{text.slice(Math.max(cursor, start), end)}</mark>
    )
    cursor = end
  }
  parts.push(text.slice(cursor))
  return <>{parts}</>
}

export function SourceDocumentContext({
  file,
  term,
  selection,
  onSelectionChange,
  onPreviewChange,
  disabled = false,
  contextLimit = 24000
}: {
  file: ContributionFileItem
  term: string
  selection?: SourceContextSelection
  onSelectionChange: (selection: SourceContextSelection | null) => void
  onPreviewChange: (preview: SourceContextPreview) => void
  disabled?: boolean
  contextLimit?: number
}) {
  const id = useId()
  const [source, setSource] = useState<SourceResponse | null>(null)
  const [aliases, setAliases] = useState("")
  const [error, setError] = useState("")
  const [working, setWorking] = useState(false)
  const [reload, setReload] = useState(0)
  const [correcting, setCorrecting] = useState(false)
  const [correctedText, setCorrectedText] = useState("")
  const [ocrReviewed, setOcrReviewed] = useState(
    selection?.ocrReviewed ?? false
  )
  const previewCallback = useRef(onPreviewChange)
  useEffect(() => {
    previewCallback.current = onPreviewChange
  }, [onPreviewChange])
  // Restoration needs the saved check. Subsequent local selections already
  // have their check loaded; clearing one must not overwrite edited aliases.
  const requestedCheckId = useRef(selection?.checkId)
  const url = `${contributionFilePath(file.id)}/source`

  useEffect(() => {
    const controller = new AbortController()
    const checkId = requestedCheckId.current
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const response = await fetch(
          `${url}${checkId ? `?checkId=${encodeURIComponent(checkId)}` : ""}`,
          {
            credentials: "same-origin",
            signal: controller.signal
          }
        )
        const result = await response.json()
        if (!response.ok)
          throw new Error(result.error || "The source could not be read.")
        if (controller.signal.aborted) return
        setSource(result)
        setError("")
        const check = result.check ?? result.latestCheck
        if (check) setAliases(check.aliases.join("\n"))
        if (["queued", "processing"].includes(result.extraction?.status))
          timer = setTimeout(() => void read(), 2000)
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "The source could not be read."
          )
      }
    }
    void read()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [url, reload])

  const extraction = source?.extraction
  const check = source?.check ?? source?.latestCheck
  const aliasList = aliases
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
  const checkCurrent =
    check &&
    check.extractionId === extraction?.id &&
    check.term.trim().toLowerCase().replace(/\s+/gu, " ") ===
      term.trim().toLowerCase().replace(/\s+/gu, " ") &&
    JSON.stringify(aliasList) === JSON.stringify(check.aliases)
  const hasMatch = !!checkCurrent && check.matches.length > 0
  let selectedText = ""
  let selectionError = ""
  if (
    selection &&
    checkCurrent &&
    selection.checkId === check.id &&
    extraction?.status === "ready"
  ) {
    try {
      selectedText = sourceSelectionText(
        extraction.text ?? "",
        check.passages,
        selection
      )
      if (
        selection.mode === "passages" &&
        !check.passages.some(
          (passage) =>
            selection.passageIds.includes(passage.id) &&
            passage.matchIds.length > 0
        )
      )
        selectionError = "Include a passage containing the term or an alias."
    } catch (failure) {
      selectionError =
        failure instanceof Error ? failure.message : "Check the source again."
    }
  }
  const ready =
    !!selection &&
    hasMatch &&
    !!selectedText.trim() &&
    !selectionError &&
    !correcting &&
    (!extraction?.hasOcr || selection.ocrReviewed)
  useEffect(() => {
    previewCallback.current({
      fileId: file.id,
      title: file.title,
      text: selectedText,
      ready
    })
  }, [file.id, file.title, selectedText, ready])

  const updateSelection = (patch: Partial<SourceContextSelection> = {}) => {
    if (!check || !hasMatch) return
    onSelectionChange({
      fileId: file.id,
      checkId: check.id,
      mode: "passages",
      passageIds: check.passages
        .filter((passage) => passage.matchIds.length)
        .slice(0, SOURCE_MAX_SELECTED_PASSAGES)
        .map((passage) => passage.id),
      ocrReviewed,
      ...selection,
      ...patch
    })
  }
  const action = async (kind: "check" | "ocr" | "correct") => {
    if (disabled || working) return
    setWorking(true)
    setError("")
    onSelectionChange(null)
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "ocr"
            ? { action: "ocr" }
            : kind === "correct"
              ? {
                  action: "correct",
                  extractionId: extraction?.id,
                  text: correctedText
                }
              : {
                  action: "check",
                  extractionId: extraction?.id,
                  aliases: aliasList
                }
        )
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || "The source could not be checked.")
      if (kind === "check") {
        setAliases(result.check.aliases.join("\n"))
        setSource((current) =>
          current ? { ...current, check: result.check } : current
        )
      } else {
        requestedCheckId.current = undefined
        setOcrReviewed(false)
        setCorrecting(false)
        setCorrectedText("")
        setSource(null)
        setReload((value) => value + 1)
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The source could not be checked."
      )
    } finally {
      setWorking(false)
    }
  }
  const blocked = disabled || working || correcting
  const selectedPassageCount =
    check?.passages.filter((passage) =>
      selection?.passageIds.includes(passage.id)
    ).length ?? 0
  return (
    <section
      aria-label={`Source text: ${file.title}`}
      className="mt-3 space-y-3 border-t pt-3"
    >
      {!source && !error ? <p role="status">Reading source…</p> : null}
      {extraction?.status === "queued" ||
      extraction?.status === "processing" ? (
        <p role="status">
          Reading document{extraction.hasOcr ? " with OCR" : ""}… You can keep
          writing.
        </p>
      ) : null}
      {extraction?.status === "failed" ? (
        <p role="alert">
          {extraction.error || "This document could not be read."}
        </p>
      ) : null}
      {extraction?.status === "ready" ? (
        <>
          <details>
            <summary className="cursor-pointer font-medium underline">
              Read extracted text{extraction.hasOcr ? " (includes OCR)" : ""}
            </summary>
            <div className="mt-2 max-h-64 space-y-3 overflow-auto rounded-md border p-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {extraction.pages?.length ? (
                extraction.pages.map((location, index) => (
                  <div key={index}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      {location.label || `Page ${location.page ?? index + 1}`}
                      {location.method === "ocr" ? " · OCR" : ""}
                    </p>
                    <MatchedText
                      text={(extraction.text ?? "").slice(
                        location.start,
                        location.end
                      )}
                      offset={location.start}
                      matches={checkCurrent ? check.matches : []}
                    />
                  </div>
                ))
              ) : (
                <MatchedText
                  text={extraction.text ?? ""}
                  matches={checkCurrent ? check.matches : []}
                />
              )}
            </div>
          </details>
          {extraction.hasOcr ? (
            correcting ? (
              <div className="space-y-2 rounded-md border p-3">
                <label htmlFor={`${id}-correction`} className="font-medium">
                  Correct extracted text
                </label>
                <Textarea
                  id={`${id}-correction`}
                  value={correctedText}
                  onChange={(event) => setCorrectedText(event.target.value)}
                  maxLength={SOURCE_MAX_CHARACTERS}
                  rows={8}
                  disabled={disabled || working}
                />
                <p className="text-xs text-muted-foreground">
                  Your correction is saved as a new transcript; the original
                  file and OCR text are preserved.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      disabled ||
                      working ||
                      !correctedText.trim() ||
                      correctedText === extraction.text
                    }
                    onClick={() => void action("correct")}
                  >
                    {working ? "Saving correction…" : "Save corrected text"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled || working}
                    onClick={() => setCorrecting(false)}
                  >
                    Cancel correction
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  setCorrectedText(extraction.text ?? "")
                  setCorrecting(true)
                }}
              >
                Correct extracted text
              </Button>
            )
          ) : null}
          <div className="space-y-1">
            <label htmlFor={`${id}-aliases`} className="font-medium">
              Aliases for this check (optional)
            </label>
            <Textarea
              id={`${id}-aliases`}
              value={aliases}
              rows={2}
              maxLength={4000}
              disabled={blocked}
              placeholder="One alias per line"
              onChange={(event) => {
                setAliases(event.target.value)
                onSelectionChange(null)
              }}
            />
            <p className="text-xs text-muted-foreground">
              These aliases check this source; they do not add vocabulary
              synonyms.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked || aliasList.length > SOURCE_MAX_ALIASES}
            onClick={() => void action("check")}
          >
            {working ? "Checking…" : "Check term"}
          </Button>
          {aliasList.length > SOURCE_MAX_ALIASES ? (
            <p role="alert">Use up to {SOURCE_MAX_ALIASES} aliases.</p>
          ) : null}
          {checkCurrent ? (
            <p role="status" className="font-medium">
              {hasMatch
                ? `Term found · ${check.matches.length} ${check.matches.length === 1 ? "match" : "matches"}`
                : `We couldn't find “${term}” or its aliases in this text.`}
            </p>
          ) : null}
          {checkCurrent && !hasMatch ? (
            <p className="text-muted-foreground">
              Check the text or add an explicit alias before using this source
              with an assistant. You can still write and cite it yourself.
            </p>
          ) : null}
          {extraction.hasOcr ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={ocrReviewed}
                disabled={blocked}
                onChange={(event) => {
                  setOcrReviewed(event.target.checked)
                  if (selection)
                    updateSelection({ ocrReviewed: event.target.checked })
                }}
              />
              <span>I have reviewed the OCR text for this source.</span>
            </label>
          ) : null}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={!!selection}
              disabled={
                blocked || !hasMatch || (!!extraction.hasOcr && !ocrReviewed)
              }
              onChange={(event) =>
                event.target.checked
                  ? updateSelection()
                  : onSelectionChange(null)
              }
            />
            <span>Use this source with the assistant</span>
          </label>
          {selection && checkCurrent ? (
            <div className="space-y-3 rounded-md border p-3">
              <fieldset disabled={blocked} className="flex flex-wrap gap-3">
                <legend className="mb-2 font-medium">Text to send</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    checked={selection.mode === "passages"}
                    onChange={() => updateSelection({ mode: "passages" })}
                  />
                  Relevant passages
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    checked={selection.mode === "full"}
                    disabled={(extraction.text?.length ?? 0) > contextLimit}
                    onChange={() => updateSelection({ mode: "full" })}
                  />
                  Full text
                </label>
              </fieldset>
              {(extraction.text?.length ?? 0) > contextLimit ? (
                <p className="text-xs text-muted-foreground">
                  Full text exceeds the available context allowance. Select
                  passages instead.
                </p>
              ) : null}
              {selection.mode === "passages" ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-controls={`${id}-passages`}
                      disabled={
                        blocked ||
                        !hasMatch ||
                        check.passages.length > SOURCE_MAX_SELECTED_PASSAGES ||
                        selectedPassageCount === check.passages.length
                      }
                      onClick={() =>
                        updateSelection({
                          passageIds: check.passages.map(
                            (passage) => passage.id
                          )
                        })
                      }
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-controls={`${id}-passages`}
                      disabled={
                        blocked || !hasMatch || selectedPassageCount === 0
                      }
                      onClick={() => updateSelection({ passageIds: [] })}
                    >
                      Clear selection
                    </Button>
                    <p role="status" className="text-xs text-muted-foreground">
                      {selectedPassageCount} of {check.passages.length} passages
                      selected
                    </p>
                  </div>
                  {check.passages.length > SOURCE_MAX_SELECTED_PASSAGES ? (
                    <p className="text-xs text-muted-foreground">
                      Select up to {SOURCE_MAX_SELECTED_PASSAGES} passages.
                      Clear the selection to choose a different set.
                    </p>
                  ) : null}
                  <fieldset
                    id={`${id}-passages`}
                    aria-label="Source passages"
                    className="max-h-64 space-y-3 overflow-auto"
                  >
                    {[...check.passages]
                      .sort(
                        (left, right) =>
                          Number(right.matchIds.length > 0) -
                            Number(left.matchIds.length > 0) ||
                          left.start - right.start
                      )
                      .map((passage) => (
                        <label
                          key={passage.id}
                          className="flex items-start gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={selection.passageIds.includes(passage.id)}
                            disabled={
                              blocked ||
                              (!selection.passageIds.includes(passage.id) &&
                                selectedPassageCount >=
                                  SOURCE_MAX_SELECTED_PASSAGES)
                            }
                            onChange={(event) =>
                              updateSelection({
                                passageIds: event.target.checked
                                  ? [...selection.passageIds, passage.id]
                                  : selection.passageIds.filter(
                                      (value) => value !== passage.id
                                    )
                              })
                            }
                          />
                          <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                            <span className="mb-1 block text-xs text-muted-foreground">
                              {passage.locations
                                .map((location) => location.label)
                                .join(", ")}
                            </span>
                            <MatchedText
                              text={passage.text}
                              offset={passage.start}
                              matches={check.matches}
                            />
                          </span>
                        </label>
                      ))}
                  </fieldset>
                </div>
              ) : null}
              <details open>
                <summary className="cursor-pointer font-medium">
                  Exact source text to send ·{" "}
                  {selectedText.length.toLocaleString()} characters
                </summary>
                <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border p-3 [overflow-wrap:anywhere]">
                  {selectedText || "Select at least one passage."}
                </p>
              </details>
              {selectionError ? <p role="alert">{selectionError}</p> : null}
              <p className="text-xs text-muted-foreground">
                Accepting a suggestion made with this source includes the source
                with the published definition.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
      {file.mediaType === "application/pdf" &&
      extraction?.status !== "queued" &&
      extraction?.status !== "processing" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked}
          onClick={() => void action("ocr")}
        >
          Read again with OCR
        </Button>
      ) : null}
      {error ? (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{error}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked}
            onClick={() => setReload((value) => value + 1)}
          >
            Try reading again
          </Button>
        </div>
      ) : null}
    </section>
  )
}
