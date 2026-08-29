"use client"

import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  PlusCircleIcon,
  SendIcon,
  SparklesIcon,
  XIcon
} from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AutoComplete } from "@/components/autocomplete"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
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
          to suggest a revision, propose a replacement, comment, or add an
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

/*
 * The definition form, shared by /add and the define step of a
 * walkthrough. On /add the contributor picks the term. In the walkthrough
 * the step fixes the term. A suggested revision opens with the text of the
 * candidate it derives from; a proposed replacement opens empty. /add
 * navigates to the published definition, while the walkthrough advances. A
 * new term or replacement may publish an independently attributed first
 * example in the same action.
 */
export const DefinitionForm = ({
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
}: {
  initialTerm?: string
  // What the fields open with: the text of the candidate being revised.
  initialDefinition?: string
  // The term is decided before the form opens, so the field is not shown and
  // the vocabulary list is not loaded.
  lockedTerm?: string
  // The define step the definition is written inside.
  surveyStepId?: number
  expectedInstructions?: string | null
  // The current revision of the candidate this definition revises.
  derivedFromRevisionId?: number
  // The stable candidate this separately voteable proposal would supersede.
  replacesDefinitionId?: number
  // Where a publish leads when it is not the term page.
  onPublished?: (published: PublishedDefinition) => void
  // Lets an enclosing action shell keep this form mounted during a request.
  onBusyChange?: (busy: boolean) => void
} & MutationActivityCallbacks) => {
  const router = useRouter()
  const activity = useMutationActivity({
    onBusyChange,
    onMutationStart,
    onMutationEnd
  })
  const term = lockedTerm ?? initialTerm
  const acceptsInitialExample =
    derivedFromRevisionId === undefined &&
    (lockedTerm === undefined || replacesDefinitionId !== undefined)
  const [aiDraft, setAiDraft] = useState<{
    suggestionId: number
    definition: string
    model: string
    term: string
  } | null>(null)

  const form = useForm<DefineTerm>({
    resolver: zodResolver(DefineTermSchema),
    defaultValues: {
      term,
      definition: initialDefinition,
      initialExample: ""
    }
  })

  const mutation = trpc.definitions.create.useMutation({
    onSuccess: (published) => {
      const { definition, term } = published
      if (onPublished) {
        onPublished(published)
        return
      }
      router.push(
        definitionPath(
          term.slug,
          definition.definitionNumber,
          term.vocabularySlug
        )
      )
    },
    onSettled: activity.end
  })

  const { data: vocabularyContext, isLoading: termsAreLoading } =
    trpc.terms.list.useQuery(undefined, { enabled: lockedTerm === undefined })
  const terms = vocabularyContext?.terms
  const targetVocabulary = vocabularyContext?.targetVocabulary
  const termValue = useWatch({
    control: form.control,
    name: "term",
    defaultValue: term
  })
  const normalizedTerm = termValue.trim().toLowerCase()
  const matchingTerms = useMemo(
    () =>
      (terms ?? []).filter(
        (term) => term.value.trim().toLowerCase() === normalizedTerm
      ),
    [terms, normalizedTerm]
  )
  const existingTerm = matchingTerms.find(
    (term) => term.vocabularySlug === targetVocabulary?.slug
  )
  const otherMatches = useMemo(
    () =>
      Array.from(
        new Map(
          matchingTerms
            .filter((term) => term.vocabularySlug !== targetVocabulary?.slug)
            .map((term) => [term.vocabularySlug, term])
        ).values()
      ),
    [matchingTerms, targetVocabulary?.slug]
  )
  const isExistingTerm = normalizedTerm.length > 0 && Boolean(existingTerm)

  const discardAiDraft = trpc.aiAssist.discard.useMutation({
    onSuccess: (_, variables) => {
      if (aiDraft?.suggestionId !== variables.suggestionId) return
      setAiDraft(null)
      form.setValue("definition", "", {
        shouldDirty: true,
        shouldValidate: true
      })
    },
    onSettled: activity.end
  })
  const suggestAiDraft = trpc.aiAssist.suggestNewTerm.useMutation({
    onSuccess: (suggestion, variables) => {
      setAiDraft({
        ...suggestion,
        term: variables.term.trim().toLowerCase()
      })
      form.setValue("definition", suggestion.definition, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true
      })
    },
    onError: (error) => {
      if (error.data?.code === "UNAUTHORIZED")
        loginToast("prompt a language model to draft a new-term definition")
    },
    onSettled: activity.end
  })

  const clearAiDraft = () => {
    if (!aiDraft || discardAiDraft.isPending) return
    activity.start()
    discardAiDraft.mutate({ suggestionId: aiDraft.suggestionId })
  }

  const busy =
    activity.busy ||
    mutation.isPending ||
    suggestAiDraft.isPending ||
    discardAiDraft.isPending
  const aiDraftMatchesTerm = aiDraft?.term === normalizedTerm

  return (
    <Card className="py-0">
      <CardContent className="p-5 sm:p-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => {
              activity.start()
              mutation.mutate({
                ...data,
                surveyStepId,
                expectedInstructions,
                derivedFromRevisionId,
                replacesDefinitionId,
                aiSuggestionId:
                  aiDraft?.term === normalizedTerm
                    ? aiDraft.suggestionId
                    : undefined
              })
            })}
            onChange={() => {
              if (mutation.error) mutation.reset()
            }}
            className="space-y-6"
          >
            {lockedTerm === undefined && (
              <FormField
                control={form.control}
                name="term"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Term</FormLabel>
                    <FormControl>
                      <AutoComplete
                        defaultValue={field.value}
                        onValueChange={(value) => {
                          const nextTerm = value.trim().toLowerCase()
                          if (aiDraft && nextTerm !== aiDraft.term) {
                            if (
                              !discardAiDraft.isPending &&
                              !discardAiDraft.isError
                            ) {
                              activity.start()
                              discardAiDraft.mutate({
                                suggestionId: aiDraft.suggestionId
                              })
                            }
                          }
                          field.onChange(value)
                        }}
                        options={terms ?? []}
                        searchKeys={["vocabularyTitle"]}
                        renderFn={(option) => (
                          <span className="flex w-full items-baseline justify-between gap-3">
                            <span>{option.value}</span>
                            <span className="text-xs text-muted-foreground">
                              {option.vocabularyTitle}
                            </span>
                          </span>
                        )}
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
            )}

            <FormField
              control={form.control}
              name="definition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Definition</FormLabel>
                  <FormDescription>
                    Describe what it is, then what sets it apart.
                  </FormDescription>
                  <FormControl>
                    <Textarea
                      className="min-h-24"
                      maxLength={DEFINITION_MAX_LENGTH}
                      disabled={busy}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {lockedTerm === undefined && (!isExistingTerm || aiDraft) ? (
              <div className="space-y-3 rounded-lg border border-ai/30 bg-ai/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="flex items-center gap-1.5 font-medium text-ai">
                      <SparklesIcon className="size-4" aria-hidden />
                      Optional language model assistance
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Prompt the configured language model for an editable
                      definition draft. Nothing is published until you review
                      and submit it.
                    </p>
                  </div>
                  {aiDraft ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={clearAiDraft}
                    >
                      <XIcon aria-hidden />
                      Remove model draft
                    </Button>
                  ) : null}
                </div>

                {aiDraft ? (
                  aiDraftMatchesTerm ? (
                    <p className="text-xs text-muted-foreground" role="status">
                      Drafted by{" "}
                      <span className="font-mono">{aiDraft.model}</span>. You
                      can edit it before publishing; the model will remain
                      credited as a coauthor.
                    </p>
                  ) : (
                    <p className="text-xs text-destructive" role="alert">
                      This model draft was written for “{aiDraft.term}”. Remove
                      it before publishing a different term.
                    </p>
                  )
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!normalizedTerm || termsAreLoading || busy}
                    onClick={() => {
                      activity.start()
                      suggestAiDraft.mutate({
                        term: termValue,
                        context: form.getValues("definition") || undefined
                      })
                    }}
                  >
                    <SparklesIcon aria-hidden />
                    {suggestAiDraft.isPending
                      ? "Drafting…"
                      : "Draft with a language model"}
                  </Button>
                )}

                {suggestAiDraft.error || discardAiDraft.error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {(suggestAiDraft.error ?? discardAiDraft.error)?.message}
                  </p>
                ) : null}
              </div>
            ) : null}

            {acceptsInitialExample ? (
              <FormField
                control={form.control}
                name="initialExample"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Example of use (optional)</FormLabel>
                    <FormDescription>
                      Show how this definition is used in a materials science
                      context. The example is recorded as a separate
                      contribution credited to you.
                      {lockedTerm === undefined
                        ? " Language-model drafting affects only the definition."
                        : " It remains separate from the definition's revision history and votes."}
                    </FormDescription>
                    <FormControl>
                      <Textarea
                        className="min-h-20"
                        maxLength={EXAMPLE_MAX_LENGTH}
                        disabled={busy}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {mutation.error ? (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
              >
                <CircleAlertIcon
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden
                />
                <div className="space-y-1">
                  <p className="font-medium text-destructive">
                    This definition could not be published.
                  </p>
                  <p className="text-muted-foreground">
                    {mutation.error.message}
                  </p>
                </div>
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              disabled={
                busy ||
                Boolean(aiDraft && !aiDraftMatchesTerm) ||
                (lockedTerm === undefined && termsAreLoading) ||
                (lockedTerm === undefined && isExistingTerm)
              }
              className="w-full"
            >
              <SendIcon aria-hidden />
              {mutation.isPending
                ? "Publishing…"
                : derivedFromRevisionId
                  ? "Publish suggested revision"
                  : replacesDefinitionId
                    ? "Publish replacement proposal"
                    : "Publish new term"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
