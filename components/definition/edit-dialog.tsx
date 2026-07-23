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

type EditTerm = z.infer<typeof EditTermSchema>
const EditTermSchema = z.object({
  definition: z.string().trim().min(1, "Definition is required"),
  example: z.string().trim().min(1, "Example of use is required"),
  changeNote: z
    .string()
    .trim()
    .min(3, "Briefly describe what changed")
    .max(500, "Change note must be 500 characters or fewer")
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
    setIsOpen(open)
    if (!open && !mutation.isPending)
      form.reset({ ...defaultValues, changeNote: "" })
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
              <DialogTitle className="font-serif text-2xl">
                Publish a revision
              </DialogTitle>
              <DialogDescription>
                This publishes a new immutable version under the same definition
                URL. Its definition, example, editor, and change note remain in
                history. Community voting restarts for the new version.
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
                      maxLength={500}
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
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Publishing..." : "Publish revision"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
