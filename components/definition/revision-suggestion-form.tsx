"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  ReferenceCitations,
  ReferenceStatus,
  ReferenceTools,
  selectedModelReferenceIds,
  selectedRevisionReferences,
  useTermReferenceWorkspace,
  type DraftReferenceSelection
} from "./chebi-reference-panel"
import {
  ModelReferenceEvidence,
  modelPromptReferenceSummary
} from "./model-reference-evidence"
import { ModelDraftingStatus } from "./model-drafting-status"
import {
  ModelPromptInputs,
  type ModelPromptInputItem
} from "./model-prompt-inputs"
import {
  DefinitionAssistantSelector,
  useDefinitionAssistant
} from "./definition-assistant-selector"
import { referenceLookups } from "./term-reference-workspace"
import { ContributionWorkspace } from "./contribution-workspace"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  SendIcon,
  SparklesIcon,
  Undo2Icon,
  XIcon
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { loginToast } from "@/components/login-toast"
import { COMMENT_MAX_LENGTH, DEFINITION_MAX_LENGTH } from "@/lib/input-limits"
import { definitionPath } from "@/lib/public-identifiers"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import {
  type MutationActivityCallbacks,
  useMutationActivity
} from "@/components/use-mutation-activity"

type PublishedDefinition = RouterOutput["definitions"]["create"]
type RevisionDraft = RouterOutput["aiAssist"]["suggestRevision"]
type Props = {
  term: string
  definitionId: number
  sourceRevisionId: number
  sourceDefinition: string
  surveyStepId?: number
  expectedInstructions?: string | null
  // Keep study-specific alternatives in the critique state. Applying a model
  // draft moves to the ordinary revision review and publication controls.
  renderInitialActions?: (disabled: boolean) => ReactNode
  onPublished?: (published: PublishedDefinition) => void
  onBusyChange?: (busy: boolean) => void
} & MutationActivityCallbacks

const copySelections = (selection: DraftReferenceSelection[]) =>
  selection.map((entry) => ({
    ...entry,
    citedReferenceIds: [...entry.citedReferenceIds],
    modelReferenceIds: [...entry.modelReferenceIds]
  }))

/**
 * Existing-term actions inherit their term and exact source revision. Changing
 * either starts a new workspace, including a new set of request ownership guards.
 */
export function RevisionSuggestionForm(props: Props) {
  return (
    <RevisionSuggestionWorkspace
      key={`${props.definitionId}:${props.sourceRevisionId}:${props.term}:${props.surveyStepId ?? ""}`}
      {...props}
    />
  )
}

function RevisionSuggestionWorkspace({
  term,
  definitionId,
  sourceRevisionId,
  sourceDefinition,
  surveyStepId,
  expectedInstructions,
  renderInitialActions,
  onPublished,
  onBusyChange,
  onMutationStart,
  onMutationEnd
}: Props) {
  const router = useRouter()
  const assistant = useDefinitionAssistant({
    study: surveyStepId !== undefined
  })
  const [submittedAssistant, setSubmittedAssistant] = useState<string>()
  const modelContextRef = useRef<HTMLDivElement>(null)
  const activity = useMutationActivity({
    onBusyChange,
    onMutationStart,
    onMutationEnd
  })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const reviewRef = useRef<HTMLHeadingElement>(null)
  const previewRef = useRef<HTMLHeadingElement>(null)
  const [feedback, setFeedback] = useState("")
  const [submittedInputs, setSubmittedInputs] = useState<
    ModelPromptInputItem[] | null
  >(null)
  const [references, setReferences] = useState<DraftReferenceSelection[]>([])
  const [preview, setPreview] = useState<RevisionDraft | null>(null)
  const [draft, setDraft] = useState<RevisionDraft | null>(null)
  const [applicationUndo, setApplicationUndo] = useState<{
    preview: RevisionDraft
    references: DraftReferenceSelection[]
  } | null>(null)
  const [insertionUndo, setInsertionUndo] = useState<{
    definition: string
    references: DraftReferenceSelection[]
  } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [provider, setProvider] = useState<"chebi" | "wolfram">("chebi")
  const workspace = useTermReferenceWorkspace({
    term,
    contextKey: `revision:${definitionId}:${sourceRevisionId}:${surveyStepId ?? ""}`,
    enabled: true,
    selection: references,
    onSelectionChange: setReferences,
    onSelectionEdit: () => setInsertionUndo(null)
  })

  const focusEditor = () => {
    requestAnimationFrame(() => {
      if (!mounted.current) return
      const editor = editorRef.current
      editor?.focus()
      editor?.setSelectionRange(editor.value.length, editor.value.length)
      editor?.scrollIntoView({ block: "nearest" })
    })
  }

  const discard = trpc.aiAssist.discard.useMutation({
    onSuccess: (_, variables) => {
      if (!mounted.current) return
      if (preview?.suggestionId === variables.suggestionId) setPreview(null)
      setSubmittedInputs(null)
      if (draft?.suggestionId === variables.suggestionId) {
        setDraft(null)
        setApplicationUndo(null)
        setInsertionUndo(null)
      }
      setReviewing(false)
      setContextOpen(false)
      requestAnimationFrame(() => feedbackRef.current?.focus())
    },
    onSettled: activity.end
  })
  const suggest = trpc.aiAssist.suggestRevision.useMutation({
    onSuccess: (result, variables) => {
      if (
        !mounted.current ||
        variables.definitionId !== definitionId ||
        variables.sourceRevisionId !== sourceRevisionId
      )
        return
      // A response changes only the already-open preview. The contributor must
      // explicitly apply it before an editable revision or publication exists.
      setPreview(result)
      setSubmittedAssistant(result.assistantLabel)
    },
    onError: (error) => {
      if (mounted.current) setSubmittedInputs(null)
      if (mounted.current && error.data?.code === "UNAUTHORIZED")
        loginToast("suggest an alternative")
    },
    onSettled: activity.end
  })
  const publish = trpc.definitions.create.useMutation({
    onSuccess: (published) => {
      if (!mounted.current) return
      if (onPublished) {
        onPublished(published)
        return
      }
      router.push(
        definitionPath(
          published.term.slug,
          published.definition.definitionNumber,
          published.term.vocabularySlug
        )
      )
    },
    onError: (error) => {
      if (mounted.current && error.data?.code === "UNAUTHORIZED")
        loginToast("publish an alternative")
    },
    onSettled: activity.end
  })

  const busy =
    activity.busy || suggest.isPending || publish.isPending || discard.isPending
  const critique = feedback.trim()
  const revisedDefinition = draft?.definition.trim() ?? ""
  const error = reviewing
    ? (publish.error ?? discard.error)
    : (suggest.error ?? discard.error)
  const showTools = !reviewing || contextOpen
  const modelReferenceIds = new Set(selectedModelReferenceIds(references, term))
  const modelReferences = (["chebi", "wolfram"] as const).flatMap((provider) =>
    referenceLookups(workspace.providers[provider]).flatMap((lookup, index) =>
      lookup.references
        .filter((reference) => modelReferenceIds.has(reference.id))
        .map((reference) => ({ provider, reference, lookupNumber: index + 1 }))
    )
  )
  const promptInputs: ModelPromptInputItem[] = [
    {
      id: "source-definition",
      label: "Source definition",
      text: sourceDefinition,
      included: true,
      required: true
    },
    {
      id: "revision-feedback",
      label: "Your feedback",
      text: critique,
      included: true,
      required: true
    },
    ...modelReferences.map(({ provider, reference, lookupNumber }) => ({
      id: reference.id,
      label: `${reference.source}: ${reference.term}${provider === "wolfram" ? ` · lookup ${lookupNumber}` : ""}`,
      text: reference.definition,
      included: true,
      onClear: () =>
        workspace.changeSelection(
          provider,
          reference.id,
          "modelReferenceIds",
          false
        )
    }))
  ]

  const openReferences = (nextProvider: "chebi" | "wolfram") => {
    setProvider(nextProvider)
    setContextOpen(true)
  }

  const clearDraft = () => {
    const suggestion = preview ?? draft
    if (!suggestion || busy) return
    activity.start()
    discard.mutate({ suggestionId: suggestion.suggestionId })
  }

  const addSource = (text: string) => {
    if (!draft || busy) return false
    const next = draft.definition.trim()
      ? `${draft.definition}\n\n${text}`
      : text
    if (next.length > DEFINITION_MAX_LENGTH) return false
    setInsertionUndo({
      definition: draft.definition,
      references: copySelections(references)
    })
    setDraft({ ...draft, definition: next })
    setReviewing(false)
    setContextOpen(false)
    publish.reset()
    focusEditor()
    return true
  }

  return (
    <Card className="min-w-0 py-0">
      <CardContent className="min-w-0 flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 font-medium text-ai">
            <SparklesIcon className="size-4" aria-hidden />
            Suggest an alternative
          </p>
          <p className="break-words text-sm">
            <span className="text-muted-foreground">Confirmed term: </span>
            <strong>{term}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Creates a separate definition based on this one. The original stays
            available for comparison and voting. Nothing is published until you
            select Publish alternative.
          </p>
        </div>

        <ol
          className="flex flex-wrap gap-x-5 gap-y-1 border-b pb-3 text-sm"
          aria-label="Alternative progress"
        >
          <li
            aria-current={!reviewing ? "step" : undefined}
            className={!reviewing ? "font-medium" : "text-muted-foreground"}
          >
            1. Draft alternative
          </li>
          <li
            aria-current={reviewing ? "step" : undefined}
            className={reviewing ? "font-medium" : "text-muted-foreground"}
          >
            2. Review and publish
          </li>
        </ol>
        <ReferenceStatus
          workspace={workspace}
          onOpen={openReferences}
          disabled={busy}
        />

        <ContributionWorkspace
          contextOpen={contextOpen}
          onContextOpenChange={setContextOpen}
          contextTitle={
            provider === "wolfram" ? "Wolfram lookup" : "ChEBI references"
          }
          returnLabel={reviewing ? "Back to review" : "Back to definition"}
          context={
            showTools ? (
              <ReferenceTools
                workspace={workspace}
                provider={provider}
                disabled={busy}
                canAdd={!!draft}
                onAdd={addSource}
                onModelInputAdded={() => {
                  setContextOpen(false)
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      modelContextRef.current?.focus()
                      modelContextRef.current?.scrollIntoView({
                        block: "nearest"
                      })
                    })
                  )
                }}
                allowModelInputs={!draft && !preview}
                onBack={() => {
                  setContextOpen(false)
                  requestAnimationFrame(() => {
                    const destination = reviewing
                      ? reviewRef.current
                      : draft
                        ? editorRef.current
                        : preview
                          ? previewRef.current
                          : feedbackRef.current
                    destination?.focus()
                    destination?.scrollIntoView({ block: "nearest" })
                  })
                }}
                onProviderChange={setProvider}
              />
            ) : undefined
          }
        >
          {reviewing && draft ? (
            <section
              className="min-w-0 flex flex-col gap-5"
              aria-labelledby={`revision-review-${definitionId}`}
            >
              <div className="flex flex-col gap-2">
                <h3
                  ref={reviewRef}
                  id={`revision-review-${definitionId}`}
                  tabIndex={-1}
                  className="font-semibold"
                >
                  Review alternative
                </h3>
                <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                  {draft.definition}
                </p>
                <p className="break-words text-xs text-muted-foreground">
                  Drafted by {draft.assistantLabel}, with your edits.
                </p>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {modelPromptReferenceSummary(draft.referenceCount)}
                </p>
                <p className="text-muted-foreground">
                  This records references sent to the model. References cited in
                  its response are separate. Later selections do not change the
                  recorded inputs.
                </p>
              </div>
              <ModelReferenceEvidence inputs={draft.referenceInputs} />
              <ReferenceCitations workspace={workspace} disabled={busy} />
              {submittedInputs && (
                <ModelPromptInputs
                  term={term}
                  items={submittedInputs}
                  assistantLabel={draft.assistantLabel}
                  submitted
                />
              )}
              <p className="text-xs text-muted-foreground">
                Publishing creates a separate definition with its own number,
                starting at version 1 and linked to the original. Both remain
                available for comparison and voting. The language model is
                credited.
              </p>
              {error ? <RevisionError message={error.message} /> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy || !revisedDefinition}
                  onClick={() => {
                    activity.start()
                    publish.mutate({
                      term,
                      definition: revisedDefinition,
                      surveyStepId,
                      expectedInstructions,
                      derivedFromRevisionId: sourceRevisionId,
                      aiSuggestionId: draft.suggestionId,
                      references: selectedRevisionReferences(references, term)
                    })
                  }}
                >
                  <SendIcon aria-hidden />
                  {publish.isPending ? "Publishing…" : "Publish alternative"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setReviewing(false)
                    setContextOpen(false)
                    publish.reset()
                    focusEditor()
                  }}
                >
                  <ArrowLeftIcon aria-hidden />
                  Back to writing
                </Button>
              </div>
            </section>
          ) : (
            <div className="min-w-0 flex flex-col gap-4">
              {draft ? (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor={`revision-draft-${definitionId}`}
                        className="font-medium"
                      >
                        Alternative draft
                      </label>
                      <span className="break-words text-xs text-muted-foreground">
                        Drafted by {draft.assistantLabel}
                      </span>
                    </div>
                    <Textarea
                      ref={editorRef}
                      id={`revision-draft-${definitionId}`}
                      value={draft.definition}
                      maxLength={DEFINITION_MAX_LENGTH}
                      className="min-h-44"
                      disabled={busy}
                      onChange={(event) => {
                        setDraft({ ...draft, definition: event.target.value })
                        setInsertionUndo(null)
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Edit this draft, then review its attribution and sources
                      before publishing.
                    </p>
                  </div>
                  {insertionUndo ? (
                    <div
                      className="flex flex-wrap items-center gap-2 text-sm"
                      role="status"
                    >
                      <span>Source text added and its citation attached.</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setDraft({
                            ...draft,
                            definition: insertionUndo.definition
                          })
                          setReferences(
                            copySelections(insertionUndo.references)
                          )
                          setInsertionUndo(null)
                          focusEditor()
                        }}
                      >
                        <Undo2Icon aria-hidden />
                        Undo insertion
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busy || !revisedDefinition}
                      onClick={() => {
                        setReviewing(true)
                        setContextOpen(false)
                        requestAnimationFrame(() => {
                          reviewRef.current?.focus()
                          reviewRef.current?.scrollIntoView({
                            block: "nearest"
                          })
                        })
                      }}
                    >
                      Review alternative
                    </Button>
                    {applicationUndo ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setPreview(applicationUndo.preview)
                          setReferences(
                            copySelections(applicationUndo.references)
                          )
                          setDraft(null)
                          setApplicationUndo(null)
                          setInsertionUndo(null)
                          setContextOpen(false)
                          requestAnimationFrame(() =>
                            previewRef.current?.focus()
                          )
                        }}
                      >
                        <Undo2Icon aria-hidden />
                        Undo model draft
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={clearDraft}
                    >
                      <XIcon aria-hidden />
                      Discard draft
                    </Button>
                  </div>
                  {submittedInputs && (
                    <ModelPromptInputs
                      term={term}
                      items={submittedInputs}
                      assistantLabel={draft.assistantLabel}
                      submitted
                    />
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor={`revision-feedback-${definitionId}`}
                        className="font-medium"
                      >
                        What should change?
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy || !!preview || !feedback}
                        onClick={() => {
                          setFeedback("")
                          suggest.reset()
                          feedbackRef.current?.focus()
                        }}
                      >
                        Clear feedback
                      </Button>
                    </div>
                    <Textarea
                      ref={feedbackRef}
                      id={`revision-feedback-${definitionId}`}
                      value={feedback}
                      maxLength={COMMENT_MAX_LENGTH}
                      className="min-h-24"
                      placeholder="Name the error, ambiguity, or missing distinction."
                      disabled={busy || !!preview}
                      onChange={(event) => {
                        setFeedback(event.target.value)
                        if (suggest.error) suggest.reset()
                      }}
                    />
                  </div>
                  <ModelPromptInputs
                    term={term}
                    focusRef={modelContextRef}
                    assistantControls={
                      <DefinitionAssistantSelector
                        assistant={assistant}
                        disabled={busy || !!preview}
                      />
                    }
                    assistantLabel={
                      preview?.assistantLabel ?? submittedAssistant
                    }
                    items={submittedInputs ?? promptInputs}
                    submitted={!!submittedInputs}
                    disabled={busy || !!preview}
                    onClearOptional={() => {
                      for (const { provider, reference } of modelReferences)
                        workspace.changeSelection(
                          provider,
                          reference.id,
                          "modelReferenceIds",
                          false
                        )
                    }}
                  >
                    {!preview ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto min-h-9 whitespace-normal"
                          disabled={busy || !critique || !assistant.available}
                          onClick={() => {
                            if (!assistant.available) return
                            setSubmittedAssistant(assistant.label)
                            setContextOpen(false)
                            discard.reset()
                            setSubmittedInputs(
                              promptInputs.map(
                                ({ id, label, text, included, required }) => ({
                                  id,
                                  label,
                                  text,
                                  included,
                                  required
                                })
                              )
                            )
                            activity.start()
                            suggest.mutate({
                              assistantProfile: assistant.profile,
                              surveyStepId,
                              definitionId,
                              sourceRevisionId,
                              feedback: critique,
                              referenceIds: selectedModelReferenceIds(
                                references,
                                term
                              )
                            })
                            requestAnimationFrame(() => {
                              previewRef.current?.focus()
                              previewRef.current?.scrollIntoView({
                                block: "nearest"
                              })
                            })
                          }}
                        >
                          <SparklesIcon aria-hidden />
                          {suggest.isPending
                            ? "Drafting…"
                            : "Draft alternative with a language model"}
                        </Button>

                        {!suggest.isPending
                          ? renderInitialActions?.(busy)
                          : null}
                      </>
                    ) : null}
                  </ModelPromptInputs>
                  {suggest.isPending || preview ? (
                    <section
                      className="min-w-0 flex flex-col gap-3 rounded-lg border border-ai/30 bg-ai/5 p-4"
                      aria-label="Language model alternative preview"
                      aria-busy={suggest.isPending}
                    >
                      <h3
                        ref={previewRef}
                        tabIndex={-1}
                        className="font-medium"
                      >
                        Alternative preview
                      </h3>
                      {suggest.isPending ? (
                        <ModelDraftingStatus
                          key={suggest.submittedAt}
                          label="Drafting an alternative…"
                        />
                      ) : preview ? (
                        <>
                          <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                            {preview.definition}
                          </p>
                          <p className="break-words text-xs text-muted-foreground">
                            Drafted by {preview.assistantLabel}.{" "}
                            {modelPromptReferenceSummary(
                              preview.referenceCount
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Applying the model draft clears earlier citations.
                            Attach sources used in the new text during review;
                            Undo restores your earlier citations.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setApplicationUndo({
                                  preview,
                                  references: copySelections(references)
                                })
                                setDraft(preview)
                                setReferences((current) =>
                                  current.map((selection) => ({
                                    ...selection,
                                    citedReferenceIds: []
                                  }))
                                )
                                setPreview(null)
                                setInsertionUndo(null)
                                setContextOpen(false)
                                focusEditor()
                              }}
                            >
                              Use this draft
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={clearDraft}
                            >
                              {discard.isPending
                                ? "Discarding…"
                                : "Keep my feedback"}
                            </Button>
                          </div>
                        </>
                      ) : null}
                    </section>
                  ) : null}
                </>
              )}
              {error ? <RevisionError message={error.message} /> : null}
            </div>
          )}
        </ContributionWorkspace>
      </CardContent>
    </Card>
  )
}

function RevisionError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <CircleAlertIcon
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden
      />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}
