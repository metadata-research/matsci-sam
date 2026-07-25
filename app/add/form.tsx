"use client"

import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  GitCompareArrowsIcon,
  PlusCircleIcon,
  SendIcon,
  SparklesIcon
} from "lucide-react"
import { useRouter } from "next/navigation"
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
import { cn } from "@/lib/utils"
import { DefineTerm, DefineTermSchema } from "@/lib/schemas/terms"
import { trpc } from "@/trpc/client"
import {
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "@/lib/input-limits"
import { definitionPath } from "@/lib/public-identifiers"

const AI_WORKFLOWS = [
  {
    interactive: false,
    title: "Publish and compare",
    description:
      "Publish your definition as written. New terms also receive a separately attributed model definition.",
    icon: GitCompareArrowsIcon,
    iconClassName: "text-primary"
  },
  {
    interactive: true,
    title: "Publish, then refine",
    description:
      "Publish first, then request model suggestions and choose whether to accept a suggestion or keep your original.",
    icon: SparklesIcon,
    iconClassName: "text-ai"
  }
] as const

function TermGuidance({
  normalizedTerm,
  isExisting,
  isLoading
}: {
  normalizedTerm: string
  isExisting: boolean
  isLoading: boolean
}) {
  if (!normalizedTerm)
    return (
      <>
        Choose an existing term to add another definition, or enter a new
        vocabulary term.
      </>
    )

  if (isLoading) return <>Checking the vocabulary…</>

  if (isExisting)
    return (
      <span className="inline-flex items-start gap-1.5">
        <CircleCheckIcon
          className="mt-0.5 size-3.5 shrink-0 text-primary"
          aria-hidden
        />
        Existing term — your contribution will be added as a new, separate
        definition alongside the existing definitions.
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

export const DefineTermForm = ({
  interactive: interactiveDefault = false,
  initialTerm = ""
}: {
  // Initial mode; /add starts classic, /add/interactive starts interactive.
  // The choices switch modes in place without losing typed input.
  interactive?: boolean
  initialTerm?: string
}) => {
  const router = useRouter()
  const [interactive, setInteractive] = useState(interactiveDefault)

  const toggleMode = (checked: boolean) => {
    setInteractive(checked)
    // Keep both entry points deep-linkable without a navigation that would
    // discard what the contributor has typed.
    window.history.replaceState(null, "", checked ? "/add/interactive" : "/add")
  }

  const form = useForm<DefineTerm>({
    resolver: zodResolver(DefineTermSchema),
    defaultValues: { term: initialTerm, examples: "", definition: "" }
  })

  const mutation = trpc.definitions.create.useMutation({
    onSuccess: ({ definition, term }) =>
      router.push(definitionPath(term.slug, definition.definitionNumber))
  })

  const { data: terms, isLoading: termsAreLoading } =
    trpc.terms.list.useQuery(undefined)
  const termValue = useWatch({
    control: form.control,
    name: "term",
    defaultValue: initialTerm
  })
  const normalizedTerm = termValue.trim().toLowerCase()
  const existingTerms = useMemo(
    () => new Set((terms ?? []).map((term) => term.value.trim().toLowerCase())),
    [terms]
  )
  const isExistingTerm =
    normalizedTerm.length > 0 && existingTerms.has(normalizedTerm)
  const selectedWorkflow =
    AI_WORKFLOWS.find((workflow) => workflow.interactive === interactive) ??
    AI_WORKFLOWS[0]

  return (
    <Card className="py-0">
      <CardContent className="p-5 sm:p-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({ ...data, interactive })
            )}
            onChange={() => {
              if (mutation.error) mutation.reset()
            }}
            className="space-y-6"
          >
            <fieldset className="space-y-3 border-b pb-6">
              <div className="space-y-1">
                <legend className="text-sm font-semibold">
                  Choose an AI workflow
                </legend>
                <p className="text-sm text-muted-foreground">
                  Choose what happens after publication.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {AI_WORKFLOWS.map((workflow) => {
                  const selected = interactive === workflow.interactive
                  const Icon = workflow.icon
                  const value = workflow.interactive ? "refine" : "compare"

                  return (
                    <label
                      key={workflow.title}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                        "hover:border-primary/40 hover:bg-accent/50",
                        selected && "border-primary/60 bg-primary/5"
                      )}
                    >
                      <input
                        type="radio"
                        name="ai-workflow"
                        value={value}
                        checked={selected}
                        onChange={() => toggleMode(workflow.interactive)}
                        aria-label={`${workflow.title}. ${workflow.description}`}
                        className="mt-1 size-4 shrink-0 accent-primary"
                      />
                      <span className="flex min-w-0 items-start gap-1.5 text-sm font-medium leading-5 sm:text-base">
                        <Icon
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            workflow.iconClassName
                          )}
                          aria-hidden
                        />
                        {workflow.title}
                      </span>
                    </label>
                  )
                })}
              </div>
              <p
                aria-live="polite"
                className="text-sm leading-5 text-muted-foreground"
              >
                {selectedWorkflow.description}
              </p>
            </fieldset>

            <FormField
              control={form.control}
              name="term"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Term</FormLabel>
                  <FormControl>
                    <AutoComplete
                      defaultValue={field.value}
                      onValueChange={field.onChange}
                      options={terms ?? []}
                      placeholder="Start typing a materials science term…"
                      maxLength={TERM_MAX_LENGTH}
                    />
                  </FormControl>
                  <FormDescription aria-live="polite">
                    <TermGuidance
                      normalizedTerm={normalizedTerm}
                      isExisting={isExistingTerm}
                      isLoading={termsAreLoading}
                    />
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            <FormField
              control={form.control}
              name="examples"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Example of use</FormLabel>
                  <FormDescription>
                    Show how the term appears in a materials science context.
                  </FormDescription>
                  <FormControl>
                    <Textarea
                      className="min-h-20"
                      maxLength={EXAMPLE_MAX_LENGTH}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
              disabled={mutation.isPending}
              className="w-full"
            >
              <SendIcon aria-hidden />
              {mutation.isPending ? "Publishing…" : "Publish definition"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
