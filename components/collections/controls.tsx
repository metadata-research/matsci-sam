"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PlusIcon, TrashIcon, Undo2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { collectionPath } from "@/lib/public-identifiers"

/*
 * Curator affordances for collections. Every one of these is an affordance,
 * not the enforcement: the router checks the collection's assertableBy, and
 * for creation and retirement it checks the caller's role. Rendering a control
 * only means the page believes the viewer may use it.
 *
 * The pages stay server-rendered. Each mutation revalidates its path, so a
 * refresh after the call is enough and no second query endpoint is needed to
 * keep a client cache in step.
 */

const useRefreshingMutation = () => {
  const router = useRouter()
  return {
    onSuccess: () => router.refresh(),
    onError: (error: { message: string }) => toast.error(error.message)
  }
}

export const CreateCollection = () => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")

  const { mutate: create, isPending } = trpc.collections.create.useMutation({
    onSuccess: (created) => {
      setOpen(false)
      setTitle("")
      setDescription("")
      router.push(collectionPath(created.slug))
    },
    onError: (error) => toast.error(error.message)
  })

  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4 mr-1" />
        New collection
      </Button>
    )

  return (
    <form
      className="space-y-2 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim())
          create({ title, description: description || undefined })
      }}
    >
      <Input
        autoFocus
        value={title}
        placeholder="Title"
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        value={description}
        placeholder="What is this collection for?"
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending || !title.trim()}>
          Create
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

export const EditCollection = ({
  collectionId,
  title,
  description
}: {
  collectionId: number
  title: string
  description: string | null
}) => {
  const [open, setOpen] = useState(false)
  const [nextTitle, setNextTitle] = useState(title)
  const [nextDescription, setNextDescription] = useState(description ?? "")
  const router = useRouter()

  const { mutate: update, isPending } = trpc.collections.update.useMutation({
    onSuccess: () => {
      setOpen(false)
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit details
      </Button>
    )

  return (
    <form
      className="space-y-2 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        update({
          collectionId,
          title: nextTitle,
          description: nextDescription || null
        })
      }}
    >
      <Input
        value={nextTitle}
        onChange={(event) => setNextTitle(event.target.value)}
      />
      <Textarea
        value={nextDescription}
        onChange={(event) => setNextDescription(event.target.value)}
      />
      {/* The address is not re-derived from the title. A published collection
          IRI stays put however the title changes. */}
      <p className="text-xs text-muted-foreground">
        The address of this collection does not change when its title does.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

export const AddMember = ({
  collectionId,
  memberIds
}: {
  collectionId: number
  memberIds: number[]
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const handlers = useRefreshingMutation()
  const { mutate: setMember, isPending } =
    trpc.collections.setMember.useMutation(handlers)

  const { data: results } = trpc.search.termLookup.useQuery(
    { query, limit: 10 },
    { enabled: open }
  )

  const already = new Set(memberIds)
  const candidates = (results ?? []).filter((row) => !already.has(row.id))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          <PlusIcon className="size-4 mr-1" />
          Add a term
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-72" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search terms..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No term matches.</CommandEmpty>
            <CommandGroup>
              {candidates.map((term) => (
                <CommandItem
                  key={term.id}
                  value={`${term.term} ${term.vocabularyTitle}`}
                  onSelect={() => {
                    setMember({ collectionId, termId: term.id, on: true })
                    setOpen(false)
                  }}
                >
                  <span className="grid gap-0.5">
                    <span>{term.term}</span>
                    <span className="text-xs text-muted-foreground">
                      Defined in {term.vocabularyTitle}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export const RemoveMember = ({
  collectionId,
  termId,
  term
}: {
  collectionId: number
  termId: number
  term: string
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: setMember, isPending } =
    trpc.collections.setMember.useMutation(handlers)

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Remove ${term} from this collection`}
      disabled={isPending}
      onClick={() => setMember({ collectionId, termId, on: false })}
    >
      <XIcon className="size-4" />
    </Button>
  )
}

export const RetireCollection = ({
  collectionId,
  retired
}: {
  collectionId: number
  retired: boolean
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: retire, isPending: retiring } =
    trpc.collections.retire.useMutation(handlers)
  const { mutate: restore, isPending: restoring } =
    trpc.collections.restore.useMutation(handlers)

  if (retired)
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={restoring}
        onClick={() => restore({ collectionId })}
      >
        <Undo2Icon className="size-4 mr-1" />
        Restore
      </Button>
    )

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={retiring}
      onClick={() => retire({ collectionId })}
    >
      <TrashIcon className="size-4 mr-1" />
      Retire
    </Button>
  )
}
