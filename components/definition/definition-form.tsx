"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ReferenceCitations,
  ReferenceStatus,
  ReferenceTools,
  useTermReferenceWorkspace,
  selectedModelReferenceIds,
  selectedRevisionReferences,
  type DraftReferenceSelection
} from "./chebi-reference-panel"
import { useForm, useWatch } from "react-hook-form"
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
import {
  ContributionFiles,
  ContributionFilesReview,
  selectedFilePublications,
  type DraftContributionFile
} from "./contribution-files"
import { OntologyContextPanel } from "@/components/ontology-context-panel"
import {
  AddDefinitionWorkspace,
  DefinitionToolbox,
  type DefinitionView,
  type DefinitionTool
} from "./add-definition-workspace"
import { ContributionWorkspace } from "./contribution-workspace"
import type { ReferenceProvider } from "@/lib/reference-types"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  PlusCircleIcon,
  SendIcon,
  SparklesIcon,
  Undo2Icon
} from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { TermAutocomplete } from "@/components/term-autocomplete"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { FieldSet, FieldLegend } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { DefineTerm, DefineTermSchema } from "@/lib/schemas/terms"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import {
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "@/lib/input-limits"
import { definitionPath, termPath } from "@/lib/public-identifiers"
import { loginToast } from "@/components/login-toast"
import {
  type MutationActivityCallbacks,
  useMutationActivity
} from "@/components/use-mutation-activity"

function TermGuidance({
  normalizedTerm,
  isLoading,
  existingTerm,
  otherMatches,
  targetVocabulary
}: {
  normalizedTerm: string
  isLoading: boolean
  existingTerm?: {
    slug: string
    vocabularySlug: string
    vocabularyTitle: string
  }
  otherMatches: { vocabularySlug: string; vocabularyTitle: string }[]
  targetVocabulary?: { slug: string; title: string }
}) {
  if (!normalizedTerm) return <>Enter a new vocabulary term.</>

  if (isLoading) return <>Checking the vocabulary…</>

  if (existingTerm)
    return (
      <span className="inline-flex items-start gap-1.5">
        <CircleCheckIcon
          className="mt-0.5 size-3.5 shrink-0 text-primary"
          aria-hidden
        />
        <span>
          This term already exists in {existingTerm.vocabularyTitle}.{" "}
          <Link
            href={termPath(existingTerm.slug, existingTerm.vocabularySlug)}
            className="font-medium text-primary underline"
          >
            Open it
          </Link>{" "}
          to suggest an alternative, propose a replacement, comment, or add an
          example.
        </span>
      </span>
    )

  if (otherMatches.length > 0 && targetVocabulary)
    return (
      <span className="inline-flex items-start gap-1.5">
        <PlusCircleIcon
          className="mt-0.5 size-3.5 shrink-0 text-primary"
          aria-hidden
        />
        <span>
          This label exists in{" "}
          {otherMatches.map((match) => match.vocabularyTitle).join(", ")}. A
          term published here will be a separate concept in{" "}
          {targetVocabulary.title}.
        </span>
      </span>
    )

  return (
    <span className="inline-flex items-start gap-1.5">
      <PlusCircleIcon
        className="mt-0.5 size-3.5 shrink-0 text-primary"
        aria-hidden
      />
      New term. Publishing creates a concept in{" "}
      {targetVocabulary?.title ?? "the selected vocabulary"}.
    </span>
  )
}

export type PublishedDefinition = RouterOutput["definitions"]["create"]

type Step = "confirm" | "write" | "review"
type WritingSnapshot = {
  definition: string
  references: DraftReferenceSelection[]
}
type ModelDraft = RouterOutput["aiAssist"]["suggestNewTerm"] & {
  term: string
  contextKey: string
  baseline: WritingSnapshot
  promptInputs: ModelPromptInputItem[]
}
type UndoPoint = WritingSnapshot & {
  kind: "source" | "model"
  appliedDraft: ModelDraft | null
  label: string
}
type ConfirmedTerm = {
  term: string
  vocabularySlug?: string
  vocabularyTitle?: string
}

const copySelections = (selections: DraftReferenceSelection[]) =>
  selections.map((selection) => ({
    ...selection,
    citedReferenceIds: [...selection.citedReferenceIds],
    modelReferenceIds: [...selection.modelReferenceIds]
  }))

type DefinitionFormProps = {
  initialTerm?: string
  initialDefinition?: string
  lockedTerm?: string
  surveyStepId?: number
  expectedInstructions?: string | null
  derivedFromRevisionId?: number
  replacesDefinitionId?: number
  onPublished?: (published: PublishedDefinition) => void
  onBusyChange?: (busy: boolean) => void
} & MutationActivityCallbacks

/** A new inherited action gets its own editor, receipt and model state. */
export function DefinitionForm(props: DefinitionFormProps) {
  return (
    <DefinitionFormOwner
      key={JSON.stringify([
        props.lockedTerm ?? null,
        props.surveyStepId ?? null,
        props.derivedFromRevisionId ?? null,
        props.replacesDefinitionId ?? null
      ])}
      {...props}
    />
  )
}

/** Shared contribution flow. Inherited actions retain their source/study semantics. */
const DefinitionFormOwner = ({
  initialTerm = "",
  initialDefinition = "",
  lockedTerm,
  surveyStepId,
  expectedInstructions,
  derivedFromRevisionId,
  replacesDefinitionId,
  onPublished,
  onBusyChange,
  onMutationStart,
  onMutationEnd
}: DefinitionFormProps) => {
  const router = useRouter()
  const isAdd = lockedTerm === undefined
  const [view, setView] = useState<DefinitionView>("simple")
  const [activeTool, setActiveTool] = useState<DefinitionTool | null>(null)
  const [exampleOpen, setExampleOpen] = useState(false)
  const [files, setFiles] = useState<DraftContributionFile[]>([])
  const [filesBusy, setFilesBusy] = useState(false)
  const assistant = useDefinitionAssistant({
    enabled: lockedTerm === undefined
  })
  const [submittedAssistant, setSubmittedAssistant] = useState<string>()
  const modelContextRef = useRef<HTMLDivElement>(null)
  const activity = useMutationActivity({
    onBusyChange,
    onMutationStart,
    onMutationEnd
  })
  const term = lockedTerm ?? initialTerm
  const acceptsInitialExample =
    derivedFromRevisionId === undefined &&
    (lockedTerm === undefined ||
      replacesDefinitionId !== undefined ||
      surveyStepId !== undefined)
  const form = useForm<DefineTerm>({
    resolver: zodResolver(DefineTermSchema),
    defaultValues: { term, definition: initialDefinition, initialExample: "" }
  })
  const [step, setStep] = useState<Step>(
    lockedTerm === undefined ? "confirm" : "write"
  )
  const [confirmed, setConfirmed] = useState<ConfirmedTerm | null>(
    lockedTerm === undefined ? null : { term: lockedTerm }
  )
  const [entryKey, setEntryKey] = useState(0)
  const [references, setReferences] = useState<DraftReferenceSelection[]>([])
  const [preview, setPreview] = useState<ModelDraft | null>(null)
  const [appliedDraft, setAppliedDraft] = useState<ModelDraft | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [includeDefinition, setIncludeDefinition] = useState(true)
  const [includeExample, setIncludeExample] = useState(false)
  const [submittedInputs, setSubmittedInputs] = useState<
    ModelPromptInputItem[]
  >([])
  const [undo, setUndo] = useState<UndoPoint | null>(null)
  const clearSourceUndo = () =>
    setUndo((current) => (current?.kind === "source" ? null : current))
  const [reworkIntent, setReworkIntent] = useState<"draft" | "term" | null>(
    null
  )
  const [notice, setNotice] = useState("")
  const [contextOpen, setContextOpen] = useState(false)
  const [provider, setProvider] = useState<ReferenceProvider>("chebi")
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const exampleRef = useRef<HTMLTextAreaElement | null>(null)
  const assistantRef = useRef<HTMLDivElement | null>(null)
  const reworkRef = useRef<HTMLDivElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const mounted = useRef(true)
  const generation = useRef(0)
  const modelRequest = useRef<{
    generation: number
    contextKey: string
    baseline: WritingSnapshot
    promptInputs: ModelPromptInputItem[]
  } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
    }
  }, [])

  const {
    data: vocabularyContext,
    isLoading: termsAreLoading,
    error: vocabularyError,
    refetch: refetchVocabulary
  } = trpc.terms.list.useQuery(undefined, { enabled: lockedTerm === undefined })
  const terms = vocabularyContext?.terms
  const targetVocabulary = vocabularyContext?.targetVocabulary
  const termValue = useWatch({
    control: form.control,
    name: "term",
    defaultValue: term
  })
  const definitionValue = useWatch({
    control: form.control,
    name: "definition",
    defaultValue: initialDefinition
  })
  const exampleValue =
    useWatch({
      control: form.control,
      name: "initialExample",
      defaultValue: ""
    }) ?? ""
  const normalizedTerm = termValue.trim().toLowerCase()
  const matchingTerms = useMemo(
    () =>
      (terms ?? []).filter(
        (item) => item.value.trim().toLowerCase() === normalizedTerm
      ),
    [terms, normalizedTerm]
  )
  const existingTerm = matchingTerms.find(
    (item) => item.vocabularySlug === targetVocabulary?.slug
  )
  const otherMatches = useMemo(
    () =>
      Array.from(
        new Map(
          matchingTerms
            .filter((item) => item.vocabularySlug !== targetVocabulary?.slug)
            .map((item) => [item.vocabularySlug, item])
        ).values()
      ),
    [matchingTerms, targetVocabulary?.slug]
  )
  const contextKey = confirmed
    ? [
        confirmed.term.trim().toLowerCase(),
        confirmed.vocabularySlug ?? "inherited",
        surveyStepId ?? "",
        derivedFromRevisionId ?? "",
        replacesDefinitionId ?? ""
      ].join(":")
    : "unconfirmed"
  const workspace = useTermReferenceWorkspace({
    term: confirmed?.term ?? "",
    contextKey,
    enabled: confirmed !== null,
    selection: references,
    onSelectionChange: setReferences,
    onSelectionEdit: clearSourceUndo
  })
  const destinationChanged =
    lockedTerm === undefined &&
    confirmed !== null &&
    targetVocabulary !== undefined &&
    confirmed.vocabularySlug !== targetVocabulary.slug

  const mutation = trpc.definitions.create.useMutation({
    onSuccess: (published) => {
      if (onPublished) return onPublished(published)
      router.push(
        definitionPath(
          published.term.slug,
          published.definition.definitionNumber,
          published.term.vocabularySlug
        )
      )
    },
    onSettled: activity.end
  })
  const discardAiDraft = trpc.aiAssist.discard.useMutation({
    onSettled: activity.end
  })
  const suggestAiDraft = trpc.aiAssist.suggestNewTerm.useMutation({
    onSuccess: (suggestion, variables) => {
      const request = modelRequest.current
      if (
        !mounted.current ||
        !request ||
        request.generation !== generation.current
      )
        return
      const promptInputs: ModelPromptInputItem[] = [
        ...(suggestion.requestInputs.definition
          ? [
              {
                id: "definition",
                label: "Definition draft",
                text: suggestion.requestInputs.definition,
                included: true
              }
            ]
          : []),
        ...(suggestion.requestInputs.example
          ? [
              {
                id: "example",
                label: "Example of use",
                text: suggestion.requestInputs.example,
                included: true
              }
            ]
          : []),
        ...suggestion.referenceInputs.map((reference) => ({
          id: reference.referenceId,
          label:
            request.promptInputs.find(
              (item) => item.id === reference.referenceId
            )?.label ?? `${reference.source}: ${reference.term}`,
          text: reference.definition,
          included: true
        }))
      ]
      setSubmittedInputs(promptInputs)
      setSubmittedAssistant(suggestion.assistantLabel)
      setPreview({
        ...suggestion,
        term: variables.term.trim().toLowerCase(),
        contextKey: request.contextKey,
        baseline: request.baseline,
        promptInputs
      })
    },
    onError: (error) => {
      if (error.data?.code === "UNAUTHORIZED")
        loginToast("prompt a language model to draft a new-term definition")
    },
    onSettled: activity.end
  })
  const busy =
    filesBusy ||
    activity.busy ||
    mutation.isPending ||
    suggestAiDraft.isPending ||
    discardAiDraft.isPending
  const appliedMatches = !appliedDraft || appliedDraft.contextKey === contextKey
  const canUseModel =
    lockedTerm === undefined && !appliedDraft && !destinationChanged

  const modelReferenceItems: ModelPromptInputItem[] = (
    ["chebi", "wolfram"] as const
  ).flatMap((sourceProvider) =>
    referenceLookups(workspace.providers[sourceProvider]).flatMap(
      (lookup, index) =>
        lookup.references
          .filter((reference) =>
            references.some(
              (selection) =>
                selection.lookupId === lookup.lookupId &&
                selection.modelReferenceIds.includes(reference.id)
            )
          )
          .map((reference) => ({
            id: reference.id,
            label: `${reference.source}: ${reference.term}${sourceProvider === "wolfram" ? ` · lookup ${index + 1}` : ` · release ${reference.version}`}`,
            text: reference.definition,
            included: true,
            onIncludedChange: (included: boolean) =>
              workspace.changeSelection(
                sourceProvider,
                reference.id,
                "modelReferenceIds",
                included
              )
          }))
    )
  )
  const optionalPromptInputs: ModelPromptInputItem[] = [
    {
      id: "definition",
      label: "Definition draft",
      text: definitionValue.trim(),
      included: includeDefinition,
      onIncludedChange: setIncludeDefinition
    },
    ...(acceptsInitialExample
      ? [
          {
            id: "example",
            label: "Example of use",
            text: exampleValue.trim(),
            included: includeExample,
            onIncludedChange: setIncludeExample
          }
        ]
      : []),
    ...modelReferenceItems
  ]
  const sourcesTooLong =
    modelReferenceItems.reduce((size, item) => size + item.text.length, 0) >
    24000
  const clearOptionalInputs = () => {
    clearSourceUndo()
    setIncludeDefinition(false)
    setIncludeExample(false)
    setReferences((current) =>
      current.map((selection) => ({ ...selection, modelReferenceIds: [] }))
    )
  }
  const focusExample = () => {
    setExampleOpen(true)
    requestAnimationFrame(() => {
      exampleRef.current?.focus()
      exampleRef.current?.scrollIntoView({ block: "nearest" })
    })
  }

  const focusEditor = (start?: number, end?: number) => {
    requestAnimationFrame(() => {
      const editor = editorRef.current
      editor?.focus()
      if (editor && start !== undefined)
        editor.setSelectionRange(start, end ?? start)
      editor?.scrollIntoView({ block: "nearest" })
    })
  }
  const focusHeading = () =>
    requestAnimationFrame(() => {
      headingRef.current?.focus()
      headingRef.current?.scrollIntoView({ block: "nearest" })
    })
  const snapshot = (): WritingSnapshot => ({
    definition: form.getValues("definition"),
    references: copySelections(references)
  })
  const restoreSelections = (saved: DraftReferenceSelection[]) => {
    // Passive arrivals keep their receipt. Undo restores choices for receipts that existed before the edit.
    setReferences((current) =>
      current.map(
        (selection) =>
          saved.find((item) => item.lookupId === selection.lookupId) ??
          selection
      )
    )
  }
  const restoreWriting = (saved: WritingSnapshot) => {
    form.setValue("definition", saved.definition, {
      shouldDirty: true,
      shouldValidate: false
    })
    // An empty working draft is valid here. Validate when entering Review.
    form.clearErrors("definition")
    restoreSelections(saved.references)
  }
  const discardThen = (draft: ModelDraft, next: () => void) => {
    if (busy) return
    const requestGeneration = generation.current
    activity.start()
    discardAiDraft.mutate(
      { suggestionId: draft.suggestionId },
      {
        onSuccess: () => {
          if (mounted.current && requestGeneration === generation.current)
            next()
        }
      }
    )
  }
  const confirmTerm = async () => {
    if (
      busy ||
      termsAreLoading ||
      existingTerm ||
      !targetVocabulary ||
      vocabularyError
    )
      return
    if (!(await form.trigger("term"))) return
    const next = {
      term: termValue.trim(),
      vocabularySlug: targetVocabulary.slug,
      vocabularyTitle: targetVocabulary.title
    }
    const changed =
      !confirmed ||
      confirmed.term.trim().toLowerCase() !== next.term.toLowerCase() ||
      confirmed.vocabularySlug !== next.vocabularySlug
    if (changed) {
      if (appliedDraft || preview) return
      generation.current += 1
      setReferences([])
      setFiles([])
      setUndo(null)
      setNotice(
        confirmed
          ? "Term updated. Your writing is preserved. Source and file choices have been cleared."
          : ""
      )
    }
    form.setValue("term", next.term)
    setConfirmed(next)
    setStep("write")
    setContextOpen(false)
    setProvider("chebi")
    focusEditor()
  }
  const editTerm = () => {
    if (busy || assistantOpen) return
    if (appliedDraft) {
      setReworkIntent("term")
      requestAnimationFrame(() => {
        reworkRef.current?.focus()
        reworkRef.current?.scrollIntoView({ block: "nearest" })
      })
      return
    }
    setStep("confirm")
    setContextOpen(false)
    focusHeading()
  }
  const returnToEarlierWriting = () => {
    if (!appliedDraft) return
    const intent = reworkIntent
    discardThen(appliedDraft, () => {
      restoreWriting(appliedDraft.baseline)
      setAppliedDraft(null)
      setPreview(null)
      setUndo(null)
      setReworkIntent(null)
      setAssistantOpen(false)
      setNotice(
        "Restored your writing from before the model draft was applied."
      )
      if (intent === "term") {
        setStep("confirm")
        setContextOpen(false)
        focusHeading()
      } else {
        setStep("write")
        focusEditor()
      }
    })
  }
  const undoChange = () => {
    if (!undo || busy || assistantOpen) return
    const saved = undo
    const restore = () => {
      restoreWriting(saved)
      workspace.clearNotices()
      setAppliedDraft(saved.appliedDraft)
      setUndo(null)
      setAssistantOpen(false)
      setContextOpen(false)
      setNotice("Previous writing and attribution restored.")
      focusEditor()
    }
    if (
      appliedDraft &&
      appliedDraft.suggestionId !== saved.appliedDraft?.suggestionId
    )
      discardThen(appliedDraft, restore)
    else restore()
  }
  const addReference = (text: string) => {
    if (busy || assistantOpen || step !== "write") return false
    const before = snapshot()
    const next = before.definition.trim()
      ? `${before.definition}\n\n${text}`
      : text
    if (next.length > DEFINITION_MAX_LENGTH) return false
    setUndo({
      ...before,
      kind: "source",
      appliedDraft,
      label: "Undo source insertion"
    })
    form.setValue("definition", next, {
      shouldDirty: true,
      shouldValidate: true
    })
    setContextOpen(false)
    setNotice(
      "Source text added and its citation attached. You can remove the citation during review."
    )
    focusEditor(next.length - text.length, next.length)
    return true
  }
  const requestModelDraft = () => {
    if (
      !confirmed ||
      !canUseModel ||
      !assistant.available ||
      busy ||
      preview ||
      sourcesTooLong
    )
      return
    const promptInputs = optionalPromptInputs
      .filter((item) => item.included && item.text.trim())
      .map(({ id, label, text, included }) => ({ id, label, text, included }))
    setSubmittedInputs(promptInputs)
    setSubmittedAssistant(assistant.label)
    modelRequest.current = {
      generation: generation.current,
      contextKey,
      baseline: snapshot(),
      promptInputs
    }
    setAssistantOpen(true)
    setActiveTool("assistant")
    setContextOpen(false)
    setNotice("")
    requestAnimationFrame(() => {
      assistantRef.current?.focus()
      assistantRef.current?.scrollIntoView({ block: "nearest" })
    })
    activity.start()
    suggestAiDraft.mutate({
      assistantProfile: assistant.profile,
      term: confirmed.term,
      context: includeDefinition
        ? form.getValues("definition") || undefined
        : undefined,
      example:
        includeExample && acceptsInitialExample
          ? form.getValues("initialExample") || undefined
          : undefined,
      referenceIds: selectedModelReferenceIds(references, confirmed.term),
      expectedVocabularySlug: confirmed.vocabularySlug
    })
  }
  const usePreview = () => {
    if (!preview || preview.contextKey !== contextKey || busy) return
    discardAiDraft.reset()
    const beforeApply = snapshot()
    setUndo({
      ...beforeApply,
      kind: "model",
      appliedDraft,
      label: "Undo model draft"
    })
    form.setValue("definition", preview.definition, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true
    })
    setAppliedDraft({ ...preview, baseline: beforeApply })
    setPreview(null)
    setAssistantOpen(false)
    setContextOpen(false)
    setReferences((current) =>
      current.map((selection) => ({ ...selection, citedReferenceIds: [] }))
    )
    setNotice(
      "Model draft applied. Earlier draft citations were cleared. You can attach relevant citations during review. Model attribution stays with this contribution."
    )
    focusEditor(0, preview.definition.length)
  }
  const keepWriting = () => {
    const close = () => {
      setPreview(null)
      setAssistantOpen(false)
      suggestAiDraft.reset()
      setContextOpen(false)
      focusEditor()
    }
    if (preview) discardThen(preview, close)
    else if (!busy) close()
  }
  const reviewDefinition = async () => {
    if (
      busy ||
      !confirmed ||
      assistantOpen ||
      !appliedMatches ||
      destinationChanged
    )
      return
    if (!(await form.trigger(["term", "definition", "initialExample"]))) return
    setStep("review")
    setContextOpen(false)
    setNotice("")
    focusHeading()
  }
  const publish = form.handleSubmit((data) => {
    if (
      step !== "review" ||
      busy ||
      !confirmed ||
      !appliedMatches ||
      destinationChanged ||
      preview
    )
      return
    activity.start()
    mutation.mutate({
      ...data,
      term: confirmed.term,
      surveyStepId,
      expectedInstructions,
      derivedFromRevisionId,
      replacesDefinitionId,
      expectedVocabularySlug:
        lockedTerm === undefined ? confirmed.vocabularySlug : undefined,
      references: selectedRevisionReferences(references, confirmed.term),
      attachments: isAdd ? selectedFilePublications(files) : undefined,
      aiSuggestionId: appliedDraft?.suggestionId
    })
  })
  const openTool = (nextProvider: ReferenceProvider) => {
    if (isAdd) {
      if (nextProvider === "chebi") setView("advanced")
      else setActiveTool("wolfram")
    }
    setProvider(nextProvider)
    setContextOpen(true)
  }
  const openAssistantContext = () => {
    setActiveTool("assistant")
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        modelContextRef.current?.focus()
        modelContextRef.current?.scrollIntoView({ block: "nearest" })
      })
    )
  }
  const context = confirmed ? (
    <ReferenceTools
      workspace={workspace}
      provider={provider}
      disabled={busy}
      canAdd={step === "write" && !assistantOpen}
      onAdd={addReference}
      allowModelInputs={step === "write" && canUseModel && !assistantOpen}
      onModelInputAdded={() => {
        setContextOpen(false)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            modelContextRef.current?.focus()
            modelContextRef.current?.scrollIntoView({ block: "nearest" })
          })
        )
      }}
      onBack={() => setContextOpen(false)}
      onProviderChange={setProvider}
    />
  ) : undefined
  const assistantControls =
    lockedTerm === undefined ? (
      <ModelPromptInputs
        embedded={isAdd}
        focusRef={modelContextRef}
        assistantControls={
          <div className="flex min-w-0 flex-col gap-4">
            <DefinitionAssistantSelector
              assistant={assistant}
              disabled={busy || assistantOpen || !!appliedDraft}
            />
            {isAdd && (
              <FieldSet className="gap-2">
                <FieldLegend variant="label">Optional context</FieldLegend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeDefinition}
                    disabled={busy || assistantOpen || !!appliedDraft}
                    onChange={(event) => {
                      clearSourceUndo()
                      setIncludeDefinition(event.target.checked)
                    }}
                  />
                  Use my definition draft
                </label>
                {acceptsInitialExample && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeExample}
                      disabled={busy || assistantOpen || !!appliedDraft}
                      onChange={(event) => {
                        clearSourceUndo()
                        setIncludeExample(event.target.checked)
                      }}
                    />
                    Use my example
                  </label>
                )}
              </FieldSet>
            )}
          </div>
        }
        assistantLabel={appliedDraft?.assistantLabel ?? submittedAssistant}
        term={confirmed?.term.trim().toLowerCase() ?? normalizedTerm}
        items={
          assistantOpen
            ? submittedInputs
            : appliedDraft
              ? appliedDraft.promptInputs
              : optionalPromptInputs
        }
        submitted={assistantOpen || !!appliedDraft}
        disabled={busy || assistantOpen || !!appliedDraft}
        onClearOptional={clearOptionalInputs}
      >
        {!assistantOpen && !appliedDraft && (
          <>
            {sourcesTooLong && (
              <p role="alert" className="text-sm text-destructive">
                The selected sources exceed the model input limit. Remove a
                source before requesting a suggestion.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy || !canUseModel || !assistant.available || sourcesTooLong
                }
                onClick={requestModelDraft}
              >
                <SparklesIcon aria-hidden />
                Suggest a definition
              </Button>
            </div>
          </>
        )}
      </ModelPromptInputs>
    ) : null
  const modelPreview = assistantOpen ? (
    <Card
      ref={assistantRef}
      tabIndex={-1}
      role="region"
      aria-label="Model draft preview"
      className="min-w-0"
    >
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          Model suggestion
        </CardTitle>
        <CardDescription>
          You can keep editing. Choosing Use this draft replaces the text
          currently in your editor and clears earlier citations. Undo restores
          both.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {suggestAiDraft.isPending ? (
          <ModelDraftingStatus key={suggestAiDraft.submittedAt} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {preview
              ? "Suggestion ready for review."
              : "A suggestion could not be created."}
          </p>
        )}
        <label htmlFor="new-term-model-preview" className="text-sm font-medium">
          Proposed definition
        </label>
        <Textarea
          id="new-term-model-preview"
          readOnly
          aria-busy={suggestAiDraft.isPending}
          value={preview?.definition ?? ""}
          placeholder="The suggestion will appear here."
          className="h-40 max-h-80 resize-y field-sizing-fixed"
        />
        <div className="flex min-h-16 flex-col gap-2">
          {preview && (
            <>
              <p className="text-xs text-muted-foreground">
                Drafted by {preview.assistantLabel}.{" "}
                {modelPromptReferenceSummary(preview.referenceCount)}
              </p>
              <ModelReferenceEvidence inputs={preview.referenceInputs} />
            </>
          )}
          {suggestAiDraft.error && (
            <p role="alert" className="text-sm text-destructive">
              {suggestAiDraft.error.message}
            </p>
          )}
          {discardAiDraft.error && (
            <p role="alert" className="text-sm text-destructive">
              The suggestion could not be dismissed. Your writing is unchanged.{" "}
              {discardAiDraft.error.message}
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !preview || preview.contextKey !== contextKey}
          onClick={usePreview}
        >
          Use this draft
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={keepWriting}
        >
          Keep my writing
        </Button>
        {suggestAiDraft.error && !preview && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={requestModelDraft}
          >
            Retry
          </Button>
        )}
      </CardFooter>
    </Card>
  ) : null

  const publishLabel = derivedFromRevisionId
    ? "Publish alternative"
    : replacesDefinitionId
      ? "Publish replacement proposal"
      : surveyStepId !== undefined
        ? "Publish new definition"
        : "Publish new term"

  const editorContent = (
    <Card className="py-0">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col gap-5">
          <ol
            aria-label="Contribution progress"
            className="flex flex-wrap gap-x-4 gap-y-2 border-b pb-4 text-sm"
          >
            {(
              [
                ["confirm", "Confirm term"],
                ["write", "Write definition"],
                ["review", "Review and publish"]
              ] as const
            ).map(([value, label], index) => (
              <li
                key={value}
                aria-current={step === value ? "step" : undefined}
                className={
                  step === value
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground"
                }
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>

          {confirmed && step !== "confirm" && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{confirmed.term}</p>
                <p className="text-xs text-muted-foreground">
                  {confirmed.vocabularyTitle ??
                    "Term fixed by this contribution"}
                  {replacesDefinitionId
                    ? " · Replacement proposal"
                    : derivedFromRevisionId
                      ? " · Suggested alternative"
                      : surveyStepId !== undefined
                        ? " · Study contribution"
                        : ""}
                </p>
              </div>
              {lockedTerm === undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy || assistantOpen}
                  onClick={editTerm}
                >
                  Edit term
                </Button>
              )}
            </div>
          )}

          {destinationChanged && step !== "confirm" && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 p-3 text-sm"
            >
              Your destination vocabulary has changed. Confirm the term in the
              current vocabulary before continuing.
              <Button
                type="button"
                variant="link"
                disabled={busy || assistantOpen}
                onClick={editTerm}
              >
                Review term
              </Button>
            </div>
          )}
          {reworkIntent && appliedDraft && (
            <div
              ref={reworkRef}
              tabIndex={-1}
              role="alert"
              className="flex flex-col gap-3 rounded-md border border-ai/30 bg-ai/5 p-4"
            >
              <p className="text-sm">
                This writing includes an applied model draft. Keep this
                contribution, or return to your earlier writing
                {reworkIntent === "term"
                  ? " before changing the term."
                  : " before requesting a new draft."}{" "}
                Your edits to the model draft will be removed only if you choose
                to return.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={returnToEarlierWriting}
                >
                  Return to my earlier writing
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setReworkIntent(null)}
                >
                  Keep this contribution
                </Button>
              </div>
            </div>
          )}
          {discardAiDraft.error && !assistantOpen && (
            <p role="alert" className="text-sm text-destructive">
              The model draft could not be discarded. Your writing and
              attribution are unchanged. {discardAiDraft.error.message}
            </p>
          )}

          {step === "confirm" ? (
            <section className="flex flex-col gap-4" aria-label="Confirm term">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-lg font-semibold"
              >
                Confirm your term
              </h2>
              <p className="text-sm text-muted-foreground">
                Destination: {targetVocabulary?.title ?? "Loading vocabulary…"}
              </p>
              <FormField
                control={form.control}
                name="term"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Term</FormLabel>
                    <FormControl>
                      <TermAutocomplete
                        key={entryKey}
                        defaultValue={field.value}
                        onValueChange={field.onChange}
                        options={terms ?? []}
                        placeholder="Start typing a materials science term…"
                        maxLength={TERM_MAX_LENGTH}
                        disabled={busy}
                      />
                    </FormControl>
                    <FormDescription aria-live="polite">
                      <TermGuidance
                        normalizedTerm={normalizedTerm}
                        isLoading={termsAreLoading}
                        existingTerm={existingTerm}
                        otherMatches={otherMatches}
                        targetVocabulary={targetVocabulary}
                      />
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {vocabularyError && (
                <p role="alert" className="text-sm text-destructive">
                  The destination vocabulary could not be loaded.
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => void refetchVocabulary()}
                  >
                    Retry
                  </Button>
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Confirmation opens the editor and searches ChEBI. No source is
                cited or sent to a model automatically.
              </p>
              {confirmed && definitionValue.trim() && (
                <p className="text-sm text-muted-foreground">
                  Your earlier writing will be kept. Changing the term clears
                  its source choices.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={
                    busy ||
                    termsAreLoading ||
                    !normalizedTerm ||
                    !!existingTerm ||
                    !targetVocabulary ||
                    !!vocabularyError
                  }
                  onClick={() => void confirmTerm()}
                >
                  Confirm term and find references
                </Button>
                {confirmed && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      form.setValue("term", confirmed.term)
                      setEntryKey((value) => value + 1)
                      setStep("write")
                      focusEditor()
                    }}
                  >
                    Cancel term edit
                  </Button>
                )}
              </div>
            </section>
          ) : (
            <>
              {!isAdd && (
                <ReferenceStatus
                  workspace={workspace}
                  onOpen={openTool}
                  disabled={busy || assistantOpen}
                />
              )}
              <ContributionWorkspace
                context={isAdd || assistantOpen ? undefined : context}
                contextOpen={isAdd ? false : contextOpen}
                onContextOpenChange={setContextOpen}
                contextTitle={
                  provider === "chebi" ? "ChEBI references" : "Wolfram lookup"
                }
              >
                {step === "write" ? (
                  <section
                    className="flex flex-col gap-4"
                    aria-label="Write definition"
                  >
                    <h2
                      ref={headingRef}
                      tabIndex={-1}
                      className="text-lg font-semibold"
                    >
                      Write your definition
                    </h2>
                    <div className="@container">
                      <div
                        className={cn(
                          "grid min-w-0 items-start gap-4",
                          !isAdd && assistantOpen && "@min-[48rem]:grid-cols-2"
                        )}
                      >
                        <div className="flex min-w-0 flex-col gap-4">
                          <FormField
                            control={form.control}
                            name="definition"
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <FormLabel>Definition</FormLabel>
                                  {!isAdd &&
                                    lockedTerm === undefined &&
                                    !includeDefinition &&
                                    definitionValue.trim() &&
                                    !appliedDraft && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        disabled={busy || assistantOpen}
                                        onClick={() =>
                                          setIncludeDefinition(true)
                                        }
                                      >
                                        Include my draft in assistant context
                                      </Button>
                                    )}
                                </div>
                                {!isAdd && (
                                  <FormDescription>
                                    Describe what it is, then what sets it
                                    apart.
                                  </FormDescription>
                                )}
                                <FormControl>
                                  <Textarea
                                    {...field}
                                    placeholder="Describe what this term means in the context where you use it."
                                    onChange={(event) => {
                                      clearSourceUndo()
                                      field.onChange(event)
                                      if (form.formState.errors.definition)
                                        void form.trigger("definition")
                                    }}
                                    ref={(node) => {
                                      field.ref(node)
                                      editorRef.current = node
                                    }}
                                    className="h-40 max-h-80 resize-y field-sizing-fixed"
                                    maxLength={DEFINITION_MAX_LENGTH}
                                    disabled={
                                      mutation.isPending ||
                                      discardAiDraft.isPending
                                    }
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {isAdd && acceptsInitialExample && (
                            <Button
                              type="button"
                              variant="link"
                              className="self-start px-0"
                              aria-expanded={exampleOpen}
                              onClick={() => setExampleOpen((open) => !open)}
                            >
                              {exampleOpen ? "Hide example" : "Add an example"}
                            </Button>
                          )}
                          {acceptsInitialExample && (!isAdd || exampleOpen) && (
                            <FormField
                              control={form.control}
                              name="initialExample"
                              render={({ field }) => (
                                <FormItem>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <FormLabel>
                                      Example of use (optional)
                                    </FormLabel>
                                    {!isAdd &&
                                      lockedTerm === undefined &&
                                      !appliedDraft &&
                                      (includeExample && exampleValue.trim() ? (
                                        <span className="text-xs text-muted-foreground">
                                          Included in assistant context
                                        </span>
                                      ) : (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          disabled={
                                            busy ||
                                            assistantOpen ||
                                            !exampleValue.trim()
                                          }
                                          onClick={() =>
                                            setIncludeExample(true)
                                          }
                                        >
                                          Include in assistant context
                                        </Button>
                                      ))}
                                  </div>
                                  <FormDescription>
                                    Show how this term is used. The example is
                                    published separately and credited to you.
                                  </FormDescription>
                                  <FormControl>
                                    <Textarea
                                      {...field}
                                      ref={(node) => {
                                        field.ref(node)
                                        exampleRef.current = node
                                      }}
                                      className="h-24 max-h-48 resize-y field-sizing-fixed"
                                      maxLength={EXAMPLE_MAX_LENGTH}
                                      disabled={
                                        mutation.isPending ||
                                        discardAiDraft.isPending
                                      }
                                      placeholder="A sentence or short scenario that illustrates the meaning."
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                          {!isAdd && assistantControls}
                          {isAdd && view === "simple" && (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setActiveTool("citations")}
                              >
                                Add a citation
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setActiveTool("files")}
                              >
                                Attach a file
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setActiveTool("assistant")}
                              >
                                Help me write
                              </Button>
                            </div>
                          )}
                          {isAdd && files.length > 0 && (
                            <p
                              role="status"
                              className="text-sm text-muted-foreground"
                            >
                              {files.length}{" "}
                              {files.length === 1
                                ? "file attached"
                                : "files attached"}
                              . Choose which files to publish during review.
                            </p>
                          )}
                          {!assistantOpen && (
                            <>
                              {lockedTerm === undefined && (
                                <div className="flex flex-col gap-2">
                                  {appliedDraft ? (
                                    <>
                                      <p className="text-xs text-muted-foreground">
                                        Model draft applied from{" "}
                                        {appliedDraft.assistantLabel}.{" "}
                                        {modelPromptReferenceSummary(
                                          appliedDraft.referenceCount
                                        )}{" "}
                                        Model attribution is retained as you
                                        edit.
                                      </p>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={busy || assistantOpen}
                                        onClick={() => {
                                          setReworkIntent("draft")
                                          requestAnimationFrame(() => {
                                            reworkRef.current?.focus()
                                            reworkRef.current?.scrollIntoView({
                                              block: "nearest"
                                            })
                                          })
                                        }}
                                      >
                                        Rework from my earlier writing
                                      </Button>
                                    </>
                                  ) : null}
                                </div>
                              )}
                              {undo && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy || assistantOpen}
                                  onClick={undoChange}
                                >
                                  <Undo2Icon aria-hidden />
                                  {undo.label}
                                </Button>
                              )}
                              {notice && (
                                <p
                                  role="status"
                                  className="text-sm text-muted-foreground"
                                >
                                  {notice}
                                </p>
                              )}
                              <Button
                                type="button"
                                disabled={
                                  busy ||
                                  assistantOpen ||
                                  !definitionValue.trim() ||
                                  !appliedMatches ||
                                  destinationChanged
                                }
                                onClick={() => void reviewDefinition()}
                              >
                                Review definition
                              </Button>
                            </>
                          )}
                        </div>
                        {!isAdd && modelPreview}
                      </div>
                    </div>
                  </section>
                ) : (
                  <section
                    className="flex flex-col gap-5"
                    aria-label="Review and publish"
                  >
                    <h2
                      ref={headingRef}
                      tabIndex={-1}
                      className="text-lg font-semibold"
                    >
                      Review your contribution
                    </h2>
                    <div className="flex flex-col gap-2">
                      <p className="font-medium">Definition</p>
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {definitionValue}
                      </p>
                      <Button
                        type="button"
                        variant="link"
                        className="px-0"
                        disabled={busy}
                        onClick={() => {
                          setStep("write")
                          setContextOpen(false)
                          focusEditor()
                        }}
                      >
                        Edit definition
                      </Button>
                    </div>
                    {acceptsInitialExample && (
                      <div className="flex flex-col gap-2">
                        <p className="font-medium">Example of use (optional)</p>
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {exampleValue.trim() || "No example added."}
                        </p>
                        {exampleValue.trim() && (
                          <p className="text-xs text-muted-foreground">
                            Published as your separate example contribution.
                            Model assistance does not rewrite it.
                          </p>
                        )}
                        <Button
                          type="button"
                          variant="link"
                          className="px-0"
                          disabled={busy}
                          onClick={() => {
                            setStep("write")
                            setContextOpen(false)
                            focusExample()
                          }}
                        >
                          {exampleValue.trim()
                            ? "Edit example"
                            : "Add an example"}
                        </Button>
                      </div>
                    )}
                    <div className="flex flex-col gap-1 text-sm">
                      <p className="font-medium">Model contribution</p>
                      {appliedDraft ? (
                        <p className="text-muted-foreground">
                          Drafted with {appliedDraft.assistantLabel}.{" "}
                          {modelPromptReferenceSummary(
                            appliedDraft.referenceCount
                          )}{" "}
                          These model inputs are recorded separately from your
                          citations.
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          No model draft is applied to this contribution.
                        </p>
                      )}
                    </div>
                    {appliedDraft && (
                      <>
                        <ModelPromptInputs
                          assistantLabel={appliedDraft.assistantLabel}
                          term={appliedDraft.term}
                          items={appliedDraft.promptInputs}
                          submitted
                        />
                        <ModelReferenceEvidence
                          inputs={appliedDraft.referenceInputs}
                        />
                      </>
                    )}
                    <ReferenceCitations workspace={workspace} disabled={busy} />
                    {isAdd && (
                      <ContributionFilesReview
                        files={files}
                        onFilesChange={setFiles}
                        disabled={busy}
                      />
                    )}
                    {mutation.error && (
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded-md border border-destructive/30 p-3 text-sm"
                      >
                        <CircleAlertIcon
                          className="mt-0.5 size-4 shrink-0 text-destructive"
                          aria-hidden
                        />
                        <div>
                          <p className="font-medium">
                            This definition could not be published.
                          </p>
                          <p>{mutation.error.message}</p>
                          <Button
                            type="button"
                            variant="link"
                            className="px-0"
                            disabled={busy}
                            onClick={() => {
                              setStep("write")
                              setContextOpen(false)
                              focusEditor()
                            }}
                          >
                            Return to writing
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        disabled={
                          busy ||
                          !appliedMatches ||
                          destinationChanged ||
                          !!preview
                        }
                      >
                        <SendIcon aria-hidden />
                        {mutation.isPending ? "Publishing…" : publishLabel}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setStep("write")
                          setContextOpen(false)
                          focusEditor()
                        }}
                      >
                        Back to writing
                      </Button>
                    </div>
                  </section>
                )}
              </ContributionWorkspace>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          if (step === "review") void publish(event)
          else {
            event.preventDefault()
            if (step === "confirm") void confirmTerm()
            else void reviewDefinition()
          }
        }}
        onChange={() => {
          if (mutation.error) mutation.reset()
        }}
      >
        {isAdd ? (
          <AddDefinitionWorkspace
            view={view}
            onViewChange={setView}
            references={
              confirmed ? (
                <div className="flex min-w-0 flex-col gap-4">
                  <ReferenceTools
                    workspace={workspace}
                    provider="chebi"
                    title="ChEBI matching terms"
                    revealFirst
                    visible={view === "advanced"}
                    disabled={busy}
                    canAdd={step === "write" && !assistantOpen}
                    onAdd={addReference}
                    allowModelInputs={
                      step === "write" && canUseModel && !assistantOpen
                    }
                    onProviderChange={openTool}
                    onModelInputAdded={openAssistantContext}
                  />
                  <OntologyContextPanel
                    term={confirmed.term}
                    variant="contribution"
                    enabled={view === "advanced"}
                    matchesTitle="Matches across ontologies"
                  />
                </div>
              ) : (
                <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                  Confirm your term to see matching terms and ontology context.
                </p>
              )
            }
            tools={
              confirmed ? (
                // Keep unfinished tool inputs when reviewing or cancelling a
                // term edit. A newly confirmed term gets a fresh tool workspace.
                <div key={contextKey} hidden={step !== "write"}>
                  <DefinitionToolbox
                    view={view}
                    active={assistantOpen ? "assistant" : activeTool}
                    disabled={assistantOpen}
                    onSelect={setActiveTool}
                    panels={{
                      wolfram: (
                        <ReferenceTools
                          workspace={workspace}
                          provider="wolfram"
                          embedded
                          visible={step === "write" && activeTool === "wolfram"}
                          disabled={busy}
                          canAdd={!assistantOpen}
                          onAdd={addReference}
                          allowModelInputs={canUseModel && !assistantOpen}
                          onProviderChange={openTool}
                          onModelInputAdded={openAssistantContext}
                        />
                      ),
                      assistant: (
                        <div className="flex min-w-0 flex-col gap-4">
                          {assistantControls}
                          {modelPreview}
                        </div>
                      ),
                      citations: (
                        <ReferenceCitations
                          workspace={workspace}
                          disabled={busy}
                        />
                      ),
                      files: confirmed.vocabularySlug ? (
                        <ContributionFiles
                          inline
                          term={confirmed.term}
                          vocabularySlug={confirmed.vocabularySlug}
                          files={files}
                          onFilesChange={setFiles}
                          disabled={busy}
                          onBusyChange={setFilesBusy}
                        />
                      ) : null
                    }}
                  />
                </div>
              ) : undefined
            }
          >
            {editorContent}
          </AddDefinitionWorkspace>
        ) : (
          editorContent
        )}
      </form>
    </Form>
  )
}
