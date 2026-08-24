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
import { DEFINITION_MAX_LENGTH, TERM_MAX_LENGTH } from "@/lib/input-limits"
import { definitionPath } from "@/lib/public-identifiers"
import { loginToast } from "@/components/login-toast"

function TermGuidance({
  normalizedTerm,
  isExisting,
  isLoading,
  existingSlug
}: {
  normalizedTerm: string
  isExisting: boolean
  isLoading: boolean
  existingSlug?: string
}) {
  if (!normalizedTerm) return <>Enter a new vocabulary term.</>

  if (isLoading) return <>Checking the vocabulary…</>

  if (isExisting)
    return (
      <span className="inline-flex items-start gap-1.5">
        <CircleCheckIcon
          className="mt-0.5 size-3.5 shrink-0 text-primary"
          aria-hidden
        />
        <span>
          This term already exists.{" "}
          {existingSlug ? (
            <Link
              href={"/vocabulary/" + existingSlug}
              className="font-medium text-primary underline"
            >
              Open it
            </Link>
          ) : (
            "Open it"
          )}{" "}
          to suggest a revision, propose a replacement, comment, or add an
          example.
        </span>
      </span>
    )

  return (
    <span className="inline-flex items-start gap-1.5">
      <PlusCircleIcon
        className="mt-0.5 size-3.5 shrink-0 text-primary"
        aria-hidden
      />
      New term — publishing creates a vocabulary concept and stable public
      identifier.
    </span>
  )
}

export type PublishedDefinition = RouterOutput["definitions"]["create"]

/*
 * The definition form, shared by /add and the define step of a
 * walkthrough. On /add the contributor picks the term. In the walkthrough
 * the step fixes the term. A suggested revision opens with the text of the
 * candidate it derives from; a proposed replacement opens empty. /add
 * navigates to the published definition, while the walkthrough advances.
 * Examples are separate contributions and are added after publication.
 */
export const DefinitionForm = ({
  initialTerm = "",
  initialDefinition = "",
  lockedTerm,
  surveyStepId,
  expectedInstructions,
  derivedFromRevisionId,
  replacesDefinitionId,
  onPublished
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
}) => {
  const router = useRouter()
  const term = lockedTerm ?? initialTerm
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
      definition: initialDefinition
    }
  })

  const mutation = trpc.definitions.create.useMutation({
    onSuccess: (published) => {
      const { definition, term } = published
      if (onPublished) {
        onPublished(published)
        return
      }
      router.push(definitionPath(term.slug, definition.definitionNumber))
    }
  })

  const { data: terms, isLoading: termsAreLoading } = trpc.terms.list.useQuery(
    undefined,
    { enabled: lockedTerm === undefined }
  )
  const termValue = useWatch({
    control: form.control,
    name: "term",
    defaultValue: term
  })
  const normalizedTerm = termValue.trim().toLowerCase()
  const existingTermByName = useMemo(
    () =>
      new Map(
        (terms ?? []).map((term) => [term.value.trim().toLowerCase(), term])
      ),
    [terms]
  )
  const existingTerm = existingTermByName.get(normalizedTerm)
  const isExistingTerm = normalizedTerm.length > 0 && Boolean(existingTerm)

  const discardAiDraft = trpc.aiAssist.discard.useMutation()
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
        loginToast("ask AI for a new-term definition")
    }
  })

  const clearAiDraft = () => {
    if (aiDraft && !discardAiDraft.isPending)
      discardAiDraft.mutate({ suggestionId: aiDraft.suggestionId })
    setAiDraft(null)
    form.setValue("definition", "", {
      shouldDirty: true,
      shouldValidate: true
    })
  }

  return (
    <Card className="py-0">
      <CardContent className="p-5 sm:p-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
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
            )}
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
                            if (!discardAiDraft.isPending)
                              discardAiDraft.mutate({
                                suggestionId: aiDraft.suggestionId
                              })
                            setAiDraft(null)
                            form.setValue("definition", "", {
                              shouldDirty: true,
                              shouldValidate: true
                            })
                          }
                          field.onChange(value)
                        }}
                        options={terms ?? []}
                        placeholder="Start typing a materials science term…"
                        maxLength={TERM_MAX_LENGTH}
                        disabled={
                          mutation.isPending || suggestAiDraft.isPending
                        }
                      />
                    </FormControl>
                    <FormDescription aria-live="polite">
                      <TermGuidance
                        normalizedTerm={normalizedTerm}
                        isExisting={isExistingTerm}
                        isLoading={termsAreLoading}
                        existingSlug={existingTerm?.slug}
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
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {lockedTerm === undefined && !isExistingTerm ? (
              <div className="space-y-3 rounded-lg border border-ai/30 bg-ai/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="flex items-center gap-1.5 font-medium text-ai">
                      <SparklesIcon className="size-4" aria-hidden />
                      Optional AI assistance
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Ask for an editable definition draft. Nothing is published
                      until you review and submit it.
                    </p>
                  </div>
                  {aiDraft ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={
                        mutation.isPending ||
                        suggestAiDraft.isPending ||
                        discardAiDraft.isPending
                      }
                      onClick={clearAiDraft}
                    >
                      <XIcon aria-hidden />
                      Remove AI draft
                    </Button>
                  ) : null}
                </div>

                {aiDraft ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    Drafted by{" "}
                    <span className="font-mono">{aiDraft.model}</span>. You can
                    edit it before publishing; the model will remain credited as
                    a coauthor.
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !normalizedTerm ||
                      termsAreLoading ||
                      mutation.isPending ||
                      suggestAiDraft.isPending
                    }
                    onClick={() =>
                      suggestAiDraft.mutate({
                        term: termValue,
                        context: form.getValues("definition") || undefined
                      })
                    }
                  >
                    <SparklesIcon aria-hidden />
                    {suggestAiDraft.isPending
                      ? "Drafting…"
                      : "Suggest a definition with AI"}
                  </Button>
                )}

                {suggestAiDraft.error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {suggestAiDraft.error.message}
                  </p>
                ) : null}
              </div>
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
                mutation.isPending ||
                suggestAiDraft.isPending ||
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
