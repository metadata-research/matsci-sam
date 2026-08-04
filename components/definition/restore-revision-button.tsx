"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
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
import { Textarea } from "@/components/ui/textarea"

export function RestoreRevisionButton({
  definitionId,
  revisionId,
  version,
  expectedRevisionId,
  returnHref
}: {
  definitionId: number
  revisionId: number
  version: number
  expectedRevisionId: number
  returnHref: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [changeNote, setChangeNote] = useState(`Restore revision ${version}`)

  const restore = trpc.definitions.restoreRevision.useMutation({
    onSuccess: (result) => {
      setOpen(false)
      toast.success(`Published revision ${result.revision.version}.`)
      router.push(returnHref)
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <RotateCcwIcon aria-hidden />
          Restore this revision
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">
            Restore revision {version}
          </DialogTitle>
          <DialogDescription>
            Restoration does not erase later history. It copies this text and
            example into a new current revision, with a fresh community vote
            tally.
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-2 text-sm font-medium">
          Change note
          <Textarea
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
            maxLength={500}
            className="mt-2 min-h-20 resize-y"
          />
        </label>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={restore.isPending || changeNote.trim().length < 3}
            onClick={() =>
              restore.mutate({
                definitionId,
                revisionId,
                expectedRevisionId,
                changeNote
              })
            }
          >
            {restore.isPending ? "Publishing…" : "Publish restoration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
