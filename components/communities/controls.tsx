"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  CopyIcon,
  LinkIcon,
  PlusIcon,
  RefreshCwIcon,
  TrashIcon,
  Undo2Icon,
  XIcon
} from "lucide-react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu"
import { communityPath } from "@/lib/public-identifiers"

/*
 * Affordances for communities, not the enforcement. The router checks the same
 * rules from lib/communities.ts, and rendering a control only means the page
 * believes the viewer may use it.
 *
 * The pages stay server-rendered. Each mutation revalidates its path, so a
 * refresh after the call keeps them current and no query endpoint is needed to
 * hold a client cache in step. The one exception is the people search, which
 * has to be a query because the picker reads it as you type.
 */

const useRefreshingMutation = () => {
  const router = useRouter()
  return {
    onSuccess: () => router.refresh(),
    onError: (error: { message: string }) => toast.error(error.message)
  }
}

// A link is shown once and cannot be read back, so copying it is the whole
// point of the control that displays it.
const CopyableLink = ({ link, note }: { link: string; note: string }) => {
  const href = typeof window === "undefined" ? link : `${location.origin}${link}`

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{note}</p>
      <div className="flex gap-2">
        <Input
          readOnly
          aria-label="Link to copy"
          value={href}
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          aria-label="Copy the link"
          onClick={() => {
            navigator.clipboard
              .writeText(href)
              .then(() => toast.success("Link copied"))
              .catch(() => toast.error("Could not copy the link"))
          }}
        >
          <CopyIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export const CreateCommunity = () => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")

  const { mutate: create, isPending } = trpc.communities.create.useMutation({
    onSuccess: (created) => {
      setOpen(false)
      setTitle("")
      setDescription("")
      router.push(communityPath(created.slug))
    },
    onError: (error) => toast.error(error.message)
  })

  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4 mr-1" />
        New community
      </Button>
    )

  return (
    <form
      className="space-y-2 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim()) create({ title, description: description || undefined })
      }}
    >
      <Input
        autoFocus
        placeholder="Name, for example Zhang Lab"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        placeholder="What this group is, in a sentence"
        value={description}
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

export const EditCommunity = ({
  communityId,
  title: initialTitle,
  description: initialDescription
}: {
  communityId: number
  title: string
  description: string | null
}) => {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription ?? "")
  const handlers = useRefreshingMutation()
  const { mutate: update, isPending } = trpc.communities.update.useMutation({
    ...handlers,
    onSuccess: () => {
      setOpen(false)
      handlers.onSuccess()
    }
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
        if (title.trim()) update({ communityId, title, description })
      }}
    >
      <Input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        The address does not change when the name does.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending || !title.trim()}>
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

export const RetireCommunity = ({
  communityId,
  retired
}: {
  communityId: number
  retired: boolean
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: retire, isPending: retiring } =
    trpc.communities.retire.useMutation(handlers)
  const { mutate: restore, isPending: restoring } =
    trpc.communities.restore.useMutation(handlers)

  return retired ? (
    <Button
      variant="outline"
      size="sm"
      disabled={restoring}
      onClick={() => restore({ communityId })}
    >
      <Undo2Icon className="size-4 mr-1" />
      Restore
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      disabled={retiring}
      onClick={() => retire({ communityId })}
    >
      <TrashIcon className="size-4 mr-1" />
      Retire
    </Button>
  )
}

/*
 * Find someone by name. This reads communities.searchPeople, which is gated on
 * the same rule as the control and never returns an email address. Affiliation
 * comes back only for a profile its owner made public, which is what lets a
 * steward tell two people of the same name apart without disclosing anything
 * the person kept private.
 */
export const AddPerson = ({ communityId }: { communityId: number }) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const handlers = useRefreshingMutation()
  const { mutate: setMember, isPending } =
    trpc.communities.setMember.useMutation(handlers)

  const { data: results, isFetching } =
    trpc.communities.searchPeople.useQuery(
      { communityId, query },
      {
        enabled: open && query.trim().length >= 2,
        // Hold the previous rows while the next query runs, so the list does
        // not flash empty between keystrokes and read as "nobody matches".
        placeholderData: (previous) => previous
      }
    )

  const candidates = results ?? []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          <PlusIcon className="size-4 mr-1" />
          Add a person
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-80" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {query.trim().length < 2
                ? "Type at least two letters."
                : isFetching
                  ? "Searching…"
                  : "Nobody with an account matches that name."}
            </CommandEmpty>
            <CommandGroup>
              {candidates.map((person) => (
                <CommandItem
                  key={person.id}
                  value={String(person.id)}
                  disabled={person.isMember}
                  onSelect={() => {
                    if (person.isMember) return
                    setMember({ communityId, userId: person.id, on: true })
                    setOpen(false)
                  }}
                >
                  <span>{person.name ?? "Unnamed account"}</span>
                  {person.affiliation && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {person.affiliation}
                    </span>
                  )}
                  {person.isMember && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      already in
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export const RemovePerson = ({
  communityId,
  userId,
  name
}: {
  communityId: number
  userId: number
  name: string
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: setMember, isPending } =
    trpc.communities.setMember.useMutation(handlers)

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Remove ${name} from this community`}
      disabled={isPending}
      onClick={() => setMember({ communityId, userId, on: false })}
    >
      <XIcon className="size-4" />
    </Button>
  )
}

export const LeaveCommunity = ({
  communityId,
  userId
}: {
  communityId: number
  userId: number
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: setMember, isPending } =
    trpc.communities.setMember.useMutation(handlers)

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => setMember({ communityId, userId, on: false })}
    >
      Leave
    </Button>
  )
}

export const SetRole = ({
  communityId,
  userId,
  role
}: {
  communityId: number
  userId: number
  role: "member" | "steward"
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: setRole, isPending } =
    trpc.communities.setRole.useMutation(handlers)
  const next = role === "steward" ? "member" : "steward"

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => setRole({ communityId, userId, role: next })}
    >
      {role === "steward" ? "Remove steward" : "Make steward"}
    </Button>
  )
}

export const AddCollection = ({
  communityId,
  collections
}: {
  communityId: number
  collections: { id: number; title: string }[]
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: setCollection, isPending } =
    trpc.communities.setCollection.useMutation(handlers)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          <PlusIcon className="size-4 mr-1" />
          Add a collection
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {collections.length === 0 && (
          <DropdownMenuItem disabled>
            Nothing to add. Every collection is already here, or none exists
            yet.
          </DropdownMenuItem>
        )}
        {collections.map((collection) => (
          <DropdownMenuItem
            key={collection.id}
            onSelect={() =>
              setCollection({
                communityId,
                collectionId: collection.id,
                on: true
              })
            }
          >
            {collection.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const RemoveCollection = ({
  communityId,
  collectionId,
  title
}: {
  communityId: number
  collectionId: number
  title: string
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: setCollection, isPending } =
    trpc.communities.setCollection.useMutation(handlers)

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Remove ${title} from the worklist`}
      disabled={isPending}
      onClick={() =>
        setCollection({ communityId, collectionId, on: false })
      }
    >
      <XIcon className="size-4" />
    </Button>
  )
}

export const InvitePerson = ({ communityId }: { communityId: number }) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [link, setLink] = useState<string | null>(null)

  const { mutate: invite, isPending } = trpc.communities.invite.useMutation({
    onSuccess: (created) => {
      setEmail("")
      setLink(created.link)
      toast.success(created.sent ? "Invitation sent" : "Invitation created")
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  if (!open && !link)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4 mr-1" />
        Invite someone
      </Button>
    )

  return (
    <div className="space-y-2">
      {link && (
        <CopyableLink
          link={link}
          note="Copy this now. Only a digest is stored, so it cannot be shown again. If it goes astray, reissue the invitation to get a new one."
        />
      )}
      {open && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (email.trim())
              invite({ communityId, email, send: false })
          }}
        >
          <Input
            autoFocus
            type="email"
            placeholder="their@address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={isPending || !email.trim()}>
              Create a link
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending || !email.trim()}
              onClick={() => invite({ communityId, email, send: true })}
            >
              Create and email it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setLink(null)
              }}
            >
              Done
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

export const InvitationActions = ({
  invitationId,
  live
}: {
  invitationId: number
  live: boolean
}) => {
  const router = useRouter()
  const [link, setLink] = useState<string | null>(null)
  const handlers = useRefreshingMutation()

  const { mutate: revoke, isPending: revoking } =
    trpc.communities.revokeInvitation.useMutation(handlers)
  const { mutate: reissue, isPending: reissuing } =
    trpc.communities.reissueInvitation.useMutation({
      onSuccess: (result) => {
        setLink(result.link)
        toast.success("New link created, and the old one no longer works")
        router.refresh()
      },
      onError: (error) => toast.error(error.message)
    })

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {live && (
          <Button
            variant="ghost"
            size="sm"
            disabled={reissuing}
            onClick={() => reissue({ invitationId, send: false })}
          >
            <RefreshCwIcon className="size-4 mr-1" />
            Reissue
          </Button>
        )}
        {live && (
          <Button
            variant="ghost"
            size="sm"
            disabled={revoking}
            onClick={() => revoke({ invitationId })}
          >
            <XIcon className="size-4 mr-1" />
            Revoke
          </Button>
        )}
      </div>
      {link && (
        <CopyableLink
          link={link}
          note="The replacement link. Copy it now, and note that the previous one has stopped working."
        />
      )}
    </div>
  )
}

/*
 * The open join link. Unlike an invitation it is stored readable, so the page
 * passes the current one in and it can be shown whenever the page is loaded.
 * Turning it on when it is already on returns the same link, and rotating is a
 * separate deliberate act, because a rotation breaks a link already pasted
 * somewhere.
 */
export const JoinLink = ({
  communityId,
  link: current
}: {
  communityId: number
  link: string | null
}) => {
  const handlers = useRefreshingMutation()
  const { mutate: setJoinLink, isPending } =
    trpc.communities.setJoinLink.useMutation(handlers)

  return (
    <div className="space-y-2">
      {current ? (
        <>
          <CopyableLink
            link={current}
            note="Anyone signed in who opens this joins. It stays valid until you turn it off or replace it."
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() =>
                setJoinLink({ communityId, on: true, rotate: true })
              }
            >
              <RefreshCwIcon className="size-4 mr-1" />
              Replace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => setJoinLink({ communityId, on: false })}
            >
              <XIcon className="size-4 mr-1" />
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setJoinLink({ communityId, on: true })}
        >
          <LinkIcon className="size-4 mr-1" />
          Create an open join link
        </Button>
      )}
    </div>
  )
}
