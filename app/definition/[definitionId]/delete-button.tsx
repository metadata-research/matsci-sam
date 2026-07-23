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
import { trpc } from "@/trpc/client"
import { Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export const DeleteDefinitionButton = ({
  id,
  term
}: {
  id: number
  term: string
}) => {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { isPending, mutate } = trpc.definitions.delete.useMutation({
    onSuccess: () => {
      setOpen(false)
      router.replace("/terms")
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2Icon aria-hidden />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <div className="flex size-9 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <TriangleAlertIcon className="size-5" aria-hidden />
          </div>
          <DialogTitle className="font-serif text-2xl">
            Delete this definition permanently?
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              This administrator cleanup action removes the definition of{" "}
              <span className="font-medium text-foreground">{term}</span> and
              its votes, comments, tags, edit history, AI refinement rounds,
              Discussion suggestions, and refined versions.
            </span>
            <span className="block">
              If this is the last definition, the shared term is also removed.
              This action cannot be undone.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={() => mutate(id)}
          >
            <Trash2Icon aria-hidden />
            {isPending ? "Deleting..." : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
