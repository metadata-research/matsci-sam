"use client"

import { useId, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { PencilIcon, Undo2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"
import { trpc } from "@/trpc/client"
import {
  ReferenceCitations,
  ReferenceStatus,
  ReferenceTools,
  useTermReferenceWorkspace,
  selectedRevisionReferences,
  type DraftReferenceSelection
} from "./chebi-reference-panel"
import { ContributionWorkspace } from "./contribution-workspace"
import type { ReferenceProvider } from "@/lib/reference-types"
import {
  CHANGE_NOTE_MAX_LENGTH,
  DEFINITION_MAX_LENGTH
} from "@/lib/input-limits"

const EditTermSchema = z.object({
  definition: z
    .string()
    .trim()
    .min(1, "Definition is required")
    .max(DEFINITION_MAX_LENGTH),
  changeNote: z
    .string()
    .trim()
    .min(3, "Briefly describe what changed")
    .max(
      CHANGE_NOTE_MAX_LENGTH,
      `Change note must be ${CHANGE_NOTE_MAX_LENGTH} characters or fewer`
    )
})
type EditTerm = z.infer<typeof EditTermSchema>
interface Props {
  term: string
  defaultValues: { definition: string; changeNote?: string }
  definitionId: number
  expectedRevisionId: number
}

export const EditDefinitionDialog = (props: Props) => (
  <RevisionEditor
    key={`${props.definitionId}:${props.expectedRevisionId}`}
    {...props}
  />
)

function RevisionEditor({
  term,
  defaultValues,
  definitionId,
  expectedRevisionId
}: Props) {
  const id = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [session, setSession] = useState(0)
  const [review, setReview] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [provider, setProvider] = useState<ReferenceProvider>("chebi")
  const [undo, setUndo] = useState<{
    definition: string
    references: DraftReferenceSelection[]
  } | null>(null)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const [references, setReferences] = useState<DraftReferenceSelection[]>([])
  const router = useRouter()
  const form = useForm<EditTerm>({
    resolver: zodResolver(EditTermSchema),
    defaultValues: { ...defaultValues, changeNote: "" }
  })
  const workspace = useTermReferenceWorkspace({
    term,
    contextKey: `edit:${definitionId}:${expectedRevisionId}:${session}`,
    enabled: isOpen,
    selection: references,
    onSelectionChange: setReferences,
    onSelectionEdit: () => setUndo(null)
  })
  const mutation = trpc.definitions.edit.useMutation({
    onSuccess: () => {
      setIsOpen(false)
      setReferences([])
      router.refresh()
    }
  })
  const openTool = (next: ReferenceProvider) => {
    setProvider(next)
    setContextOpen(true)
  }
  const focusEditor = () =>
    requestAnimationFrame(() => {
      form.setFocus("definition")
      document
        .getElementById(`${id}-definition`)
        ?.scrollIntoView({ block: "nearest" })
    })
  const onOpenChange = (open: boolean) => {
    if (!open && mutation.isPending) return
    if (open) {
      form.reset({ ...defaultValues, changeNote: "" })
      setReferences([])
      setReview(false)
      setContextOpen(false)
      setProvider("chebi")
      setUndo(null)
      setSession((current) => current + 1)
      mutation.reset()
    }
    setIsOpen(open)
  }
  const add = (text: string) => {
    if (review || mutation.isPending) return false
    const previous = form.getValues("definition")
    const next = previous.trim() ? `${previous}\n\n${text}` : text
    if (next.length > DEFINITION_MAX_LENGTH) return false
    setUndo({
      definition: previous,
      references: references.map((reference) => ({
        ...reference,
        citedReferenceIds: [...reference.citedReferenceIds],
        modelReferenceIds: [...reference.modelReferenceIds]
      }))
    })
    form.setValue("definition", next, {
      shouldDirty: true,
      shouldValidate: true
    })
    setContextOpen(false)
    focusEditor()
    return true
  }
  const publish = form.handleSubmit((data) => {
    if (!review || mutation.isPending) return
    mutation.mutate({
      id: definitionId,
      expectedRevisionId,
      references: selectedRevisionReferences(references, term),
      ...data
    })
  })

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <div className="min-w-0 max-w-56 space-y-1.5">
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 max-w-full whitespace-normal"
            aria-describedby={`${id}-version-help`}
          >
            <PencilIcon aria-hidden />
            Create a new version
          </Button>
        </DialogTrigger>
        <p id={`${id}-version-help`} className="text-xs text-muted-foreground">
          Earlier versions remain in history.
        </p>
      </div>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Create a new version of {term}</DialogTitle>
          <DialogDescription>
            Edit this definition, then review before publishing its next
            version. It keeps the same definition number. Earlier text and
            citations stay in history. Examples remain separate.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {review ? "2. Review and publish" : "1. Edit definition"}
        </p>
        <Form {...form}>
          <form onSubmit={publish} className="flex min-w-0 flex-col gap-4">
            <ReferenceStatus
              workspace={workspace}
              onOpen={openTool}
              disabled={mutation.isPending}
            />
            <ContributionWorkspace
              contextOpen={contextOpen}
              onContextOpenChange={setContextOpen}
              contextTitle={
                provider === "chebi" ? "ChEBI reference" : "Wolfram lookup"
              }
              returnLabel={review ? "Back to review" : "Back to definition"}
              context={
                !review || contextOpen ? (
                  <ReferenceTools
                    workspace={workspace}
                    provider={provider}
                    disabled={mutation.isPending}
                    canAdd={!review}
                    onAdd={add}
                    allowModelInputs={false}
                    onBack={() => setContextOpen(false)}
                    onProviderChange={openTool}
                  />
                ) : undefined
              }
            >
              <FieldGroup>
                {review ? (
                  <>
                    <h2
                      ref={reviewHeading}
                      tabIndex={-1}
                      className="font-semibold"
                    >
                      Review new version
                    </h2>
                    <Field>
                      <FieldLabel>Definition to publish</FieldLabel>
                      <p className="whitespace-pre-wrap break-words">
                        {form.getValues("definition")}
                      </p>
                    </Field>
                    <Field>
                      <FieldLabel>Change note</FieldLabel>
                      <p className="whitespace-pre-wrap break-words">
                        {form.getValues("changeNote")}
                      </p>
                    </Field>
                    <ReferenceCitations
                      workspace={workspace}
                      disabled={mutation.isPending}
                    />
                    <p className="text-sm text-muted-foreground">
                      Publishing creates the next version of this definition
                      under the same number and URL. Earlier versions stay in
                      history. Community voting starts afresh for the new
                      version.
                    </p>
                    {mutation.error && (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {mutation.error.message}
                        </AlertDescription>
                      </Alert>
                    )}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={() => {
                          setReview(false)
                          setContextOpen(false)
                          focusEditor()
                        }}
                      >
                        Back to editing
                      </Button>
                      <Button type="submit" disabled={mutation.isPending}>
                        {mutation.isPending
                          ? "Publishing…"
                          : "Publish new version"}
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <FormField
                      control={form.control}
                      name="definition"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel htmlFor={`${id}-definition`}>
                            Definition
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              onChange={(event) => {
                                setUndo(null)
                                field.onChange(event)
                              }}
                              id={`${id}-definition`}
                              className="min-h-32 resize-y"
                              maxLength={DEFINITION_MAX_LENGTH}
                              disabled={mutation.isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {undo !== null && (
                      <div className="flex flex-wrap items-center gap-3">
                        <p
                          role="status"
                          className="text-sm text-muted-foreground"
                        >
                          Reference text added.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            form.setValue("definition", undo.definition, {
                              shouldDirty: true,
                              shouldValidate: true
                            })
                            setReferences((current) =>
                              current.map(
                                (reference) =>
                                  undo.references.find(
                                    (previous) =>
                                      previous.lookupId === reference.lookupId
                                  ) ?? reference
                              )
                            )
                            setUndo(null)
                            focusEditor()
                          }}
                        >
                          <Undo2Icon aria-hidden />
                          Undo
                        </Button>
                      </div>
                    )}
                    <FormField
                      control={form.control}
                      name="changeNote"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Change note</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              placeholder="Summarize the reason for this revision."
                              className="min-h-20 resize-y"
                              maxLength={CHANGE_NOTE_MAX_LENGTH}
                              disabled={mutation.isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={async () => {
                          if (await form.trigger()) {
                            setReview(true)
                            setContextOpen(false)
                            requestAnimationFrame(() => {
                              reviewHeading.current?.focus()
                              reviewHeading.current?.scrollIntoView({
                                block: "nearest"
                              })
                            })
                          }
                        }}
                      >
                        Review new version
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </FieldGroup>
            </ContributionWorkspace>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
