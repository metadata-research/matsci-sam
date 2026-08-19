"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "../ui/form"
import { useForm } from "react-hook-form"
import { Textarea } from "../ui/textarea"
import { trpc } from "@/trpc/client"
import { useState } from "react"
import { PencilIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CHANGE_NOTE_MAX_LENGTH,
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH
} from "@/lib/input-limits"

type EditTerm = z.infer<typeof EditTermSchema>
const EditTermSchema = z.object({
  definition: z
    .string()
    .trim()
    .min(1, "Definition is required")
    .max(DEFINITION_MAX_LENGTH),
  example: z
    .string()
    .trim()
    .min(1, "Example of use is required")
    .max(EXAMPLE_MAX_LENGTH),
  changeNote: z
    .string()
    .trim()
    .min(3, "Briefly describe what changed")
    .max(
      CHANGE_NOTE_MAX_LENGTH,
      `Change note must be ${CHANGE_NOTE_MAX_LENGTH} characters or fewer`
    )
})

interface Props {
  defaultValues: {
    example: string
    definition: string
    changeNote?: string
  }
  definitionId: number
  expectedRevisionId: number
}

export const EditDefinitionDialog = ({
  defaultValues,
  definitionId,
  expectedRevisionId
}: Props) => {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const form = useForm<EditTerm>({
    resolver: zodResolver(EditTermSchema),
    defaultValues: { ...defaultValues, changeNote: "" }
  })

  const mutation = trpc.definitions.edit.useMutation({
    onSuccess: () => {
      setIsOpen(false)
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  const onOpenChange = (open: boolean) => {
    // Keep the dialog up while publishing: closing it mid-flight leaves the
    // mutation running invisibly and surfaces any error with the dialog gone.
    if (!open && mutation.isPending) return
    setIsOpen(open)
    if (!open) form.reset({ ...defaultValues, changeNote: "" })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PencilIcon aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) =>
              mutation.mutate({
                id: definitionId,
                expectedRevisionId,
                ...data
              })
            )}
            className="space-y-5"
          >
            <DialogHeader>
              <DialogTitle className="text-2xl">
                Publish a revision
              </DialogTitle>
              <DialogDescription>
                This publishes a new immutable revision under the same
                definition URL. Its definition, example, editor, and change note
                remain in history. Community voting restarts for the new
                revision.
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="definition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Definition</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="A _class_ of thing, followed by distinguishing characteristics, such as (for 'water'): 'A _clear liquid_ made up of hydrogen and oxygen molecules.'"
                      className="min-h-32 resize-y"
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
              name="changeNote"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Change note</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Summarize the reason for this revision."
                      className="min-h-20 resize-y"
                      maxLength={CHANGE_NOTE_MAX_LENGTH}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="example"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Example of use</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Show how the term is used in context."
                      className="min-h-24 resize-y"
                      maxLength={EXAMPLE_MAX_LENGTH}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Publishing…" : "Publish revision"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
