"use client"

import { useState } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { trpc } from "@/trpc/client"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

type MatchedTerm = { id: number; term: string; slug: string }

export function TagModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tagName, setTagName] = useState("")
  // A tag whose name matches a term is very likely the same concept. The
  // application says so and lets the author decide; it never links on its own.
  const [offer, setOffer] = useState<{
    conceptId: number
    label: string
    term: MatchedTerm
  } | null>(null)

  const close = () => {
    setOpen(false)
    setTagName("")
    setOffer(null)
    router.refresh()
  }

  const createTag = trpc.tags.create.useMutation({
    onSuccess: (concept) => {
      if (concept.matchedTerm) {
        setOffer({
          conceptId: concept.id,
          label: concept.name,
          term: concept.matchedTerm
        })
        setTagName("")
        return
      }
      close()
    },
    onError: (error) => toast.error(error.message)
  })

  const linkTag = trpc.tags.setLink.useMutation({
    onSuccess: close,
    onError: (error) => {
      toast.error(error.message)
      close()
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (tagName.trim()) createTag.mutate({ name: tagName.trim() })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Add Tag</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        {offer ? (
          <div>
            <DialogHeader>
              <DialogTitle>Is this the same as a term?</DialogTitle>
              <DialogDescription>
                The vocabulary already defines a term with this name. Saying
                they are the same concept lets the tag carry that definition.
                You can leave them separate.
              </DialogDescription>
            </DialogHeader>
            <p className="py-4 text-sm">
              <span className="font-semibold">{offer.label}</span> and the term{" "}
              <span className="font-serif">{offer.term.term}</span>
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Keep separate
              </Button>
              <Button
                disabled={linkTag.isPending}
                onClick={() =>
                  linkTag.mutate({
                    conceptId: offer.conceptId,
                    termId: offer.term.id,
                    on: true
                  })
                }
              >
                {linkTag.isPending ? "Linking…" : "Same concept"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Create New Tag</DialogTitle>
              <DialogDescription>
                Add a new tag to categorize terms.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Name
                </Label>
                <Input
                  id="name"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  className="col-span-3"
                  placeholder="Enter tag name"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createTag.isPending}>
                {createTag.isPending ? "Creating…" : "Create Tag"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
