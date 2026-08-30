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
import { communityPath, studyPath } from "@/lib/public-identifiers"

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
  const href =
    typeof window === "undefined" ? link : `${location.origin}${link}`

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
        if (title.trim())
          create({ title, description: description || undefined })
      }}
    >
      <Input
        autoFocus
        placeholder="Name, for example Materials Data Group"
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

  const { data: results, isFetching } = trpc.communities.searchPeople.useQuery(
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
      onClick={() => setCollection({ communityId, collectionId, on: false })}
    >
      <XIcon className="size-4" />
    </Button>
  )
}

/*
 * Two deliberately separate invitation workflows share this control. With a
 * study it creates a participant invitation for that exact study, and
 * without one it creates a plain community invitation. There is no selector
 * between them: a study invitation is created beside its study, and a
 * community invitation beside the roster.
 */
export const InvitePerson = ({
  communityId,
  study
}: {
  communityId: number
  study?: { id: number; title: string }
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [createdInvitation, setCreatedInvitation] = useState<{
    email: string
    link: string
    sent: boolean
    expiresLabel: string
  } | null>(null)

  const { mutate: invite, isPending } = trpc.communities.invite.useMutation({
    onSuccess: (created, variables) => {
      setEmail("")
      setCreatedInvitation({
        email: variables.email.trim(),
        link: created.link,
        sent: created.sent,
        expiresLabel: created.expiresLabel
      })
      toast.success(created.sent ? "Invitation sent" : "Invitation created")
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  if (!open && !createdInvitation)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4 mr-1" />
        {study ? "Invite a participant" : "Invite someone"}
      </Button>
    )

  return (
    <div className="space-y-2">
      {createdInvitation && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">
            Invitation created for {createdInvitation.email}
          </p>
          <p className="text-xs text-muted-foreground">
            {createdInvitation.sent
              ? "Email sent."
              : "Link only—no email was sent."}{" "}
            Expires {createdInvitation.expiresLabel}.
          </p>
          <CopyableLink
            link={createdInvitation.link}
            note="Copy this now. Only a digest is stored, so it cannot be shown again. If it goes astray, reissue the invitation to get a new one."
          />
        </div>
      )}
      {open && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (email.trim())
              invite({
                communityId,
                email,
                send: false,
                studyId: study?.id
              })
          }}
        >
          <div className="space-y-1.5">
            <label
              htmlFor={`invitation-email-${communityId}-${study?.id ?? "community"}`}
              className="text-sm font-medium"
            >
              {study
                ? "Participant email (required)"
                : "Email address (required)"}
            </label>
            <Input
              id={`invitation-email-${communityId}-${study?.id ?? "community"}`}
              autoFocus
              required
              type="email"
              placeholder="their@address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-describedby={`invitation-email-help-${communityId}-${study?.id ?? "community"}`}
            />
          </div>
          <p
            id={`invitation-email-help-${communityId}-${study?.id ?? "community"}`}
            className="text-xs text-muted-foreground"
          >
            {study
              ? `This records who the one-person invitation is intended for. Create a link to deliver it yourself, or create and send an email. The invitation opens ${study.title}, and joins the participant to the community first if they are not already in it.`
              : "This records who the one-person invitation is intended for. Accepting it joins the person to this community."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !email.trim()}
            >
              {study ? "Create link for this person" : "Create a link"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending || !email.trim()}
              onClick={() =>
                invite({
                  communityId,
                  email,
                  send: true,
                  studyId: study?.id
                })
              }
            >
              {study ? "Create and send email" : "Create and email it"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setCreatedInvitation(null)
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
  live,
  deletable = false
}: {
  invitationId: number
  live: boolean
  // A revoked or expired record nobody redeemed may be deleted; a redeemed
  // one records that its person arrived and carries no action at all.
  deletable?: boolean
}) => {
  const router = useRouter()
  const [link, setLink] = useState<string | null>(null)
  const handlers = useRefreshingMutation()

  const { mutate: revoke, isPending: revoking } =
    trpc.communities.revokeInvitation.useMutation(handlers)
  const { mutate: remove, isPending: removing } =
    trpc.communities.deleteInvitation.useMutation(handlers)
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
        {deletable && (
          <Button
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={() => remove({ invitationId })}
          >
            <TrashIcon className="size-4 mr-1" />
            Delete record
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

/*
 * Start a study: a set of terms, what to do with them, and who is doing it.
 *
 * The collection is either one that already exists or a fresh one made here.
 * That choice is the point of the control. Sending a curator to /collections
 * first, then back here to attach it, then back again to invite, is three
 * pages for one intention, and the middle step is the one that gets forgotten.
 */
export const CreateStudy = ({
  communityId,
  collections
}: {
  communityId: number
  collections: { id: number; title: string }[]
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [welcome, setWelcome] = useState("")
  const [newCollection, setNewCollection] = useState(true)
  const [collectionTitle, setCollectionTitle] = useState("")
  const [collectionId, setCollectionId] = useState<number | null>(null)

  const { mutate: create, isPending } =
    trpc.communities.createStudy.useMutation({
      onSuccess: (created) => {
        setOpen(false)
        router.push(studyPath(created.slug))
      },
      onError: (error) => toast.error(error.message)
    })

  const chosen = collections.find((c) => c.id === collectionId)
  const ready =
    title.trim() &&
    (newCollection ? collectionTitle.trim() : collectionId !== null)

  if (!open)
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4 mr-1" />
        Start a study
      </Button>
    )

  return (
    <form
      className="w-full space-y-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        create({
          communityId,
          title,
          welcome: welcome || undefined,
          ...(newCollection
            ? { newCollectionTitle: collectionTitle }
            : { collectionId: collectionId! })
        })
      }}
    >
      <Input
        autoFocus
        aria-label="Study name"
        placeholder="Study name, for example Second ID4 round"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Terms
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={newCollection ? "default" : "outline"}
            onClick={() => setNewCollection(true)}
          >
            Start a new collection
          </Button>
          <Button
            type="button"
            size="sm"
            variant={newCollection ? "outline" : "default"}
            disabled={collections.length === 0}
            onClick={() => setNewCollection(false)}
          >
            Use an existing one
          </Button>
        </div>

        {newCollection ? (
          <Input
            aria-label="New collection name"
            placeholder="Collection name, for example ID4 round two terms"
            value={collectionTitle}
            onChange={(event) => setCollectionTitle(event.target.value)}
          />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                {chosen ? chosen.title : "Choose a collection"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {collections.map((collection) => (
                <DropdownMenuItem
                  key={collection.id}
                  onSelect={() => setCollectionId(collection.id)}
                >
                  {collection.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Textarea
        aria-label="What participants are asked to do"
        placeholder="What are you asking people to do? This is what they read when they open their invitation, and what they come back to later."
        rows={5}
        value={welcome}
        onChange={(event) => setWelcome(event.target.value)}
      />

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending || !ready}>
          Start it
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

/*
 * Make a collection and put it on the worklist in one act. The alternative is
 * to leave, make it on the Collections page, come back, and attach it, and the
 * middle step is the one that gets forgotten.
 */
export const CreateWorklistCollection = ({
  communityId
}: {
  communityId: number
}) => {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const handlers = useRefreshingMutation()
  const { mutate: create, isPending } =
    trpc.communities.createWorklistCollection.useMutation({
      ...handlers,
      onSuccess: () => {
        setOpen(false)
        setTitle("")
        toast.success("Collection created and added")
        handlers.onSuccess()
      }
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
      className="flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim()) create({ communityId, title })
      }}
    >
      <Input
        autoFocus
        aria-label="New collection name"
        placeholder="Collection name"
        className="w-56"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
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
    </form>
  )
}

/*
 * Generate the walkthrough of a study from its collection: instructions, a
 * define and a review step per term, and the two closing questions unless
 * the steward leaves them out. The steps are replaced wholesale until
 * somebody completes one, and are then only added to, because a
 * participant's place is a position in the list. The router refuses past
 * that point, and on a retired study; here the button gives way to the
 * count.
 */
export const GenerateWalkthrough = ({
  studyId,
  steps,
  inUse,
  retired
}: {
  studyId: number
  steps: number
  inUse: boolean
  retired: boolean
}) => {
  const [closingQuestions, setClosingQuestions] = useState(true)
  const handlers = useRefreshingMutation()
  const { mutate: generate, isPending } =
    trpc.surveys.generateSteps.useMutation({
      ...handlers,
      onSuccess: (result) => {
        toast.success(
          `${result.steps} study ${result.steps === 1 ? "step is" : "steps are"} ready`
        )
        handlers.onSuccess()
      }
    })

  if (inUse)
    return (
      <span className="text-xs text-muted-foreground">
        {steps} {steps === 1 ? "step" : "steps"}, in use
      </span>
    )

  if (retired)
    return (
      <span className="text-xs text-muted-foreground">
        {steps} {steps === 1 ? "step" : "steps"}
      </span>
    )

  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        generate({ studyId, includeDefaultQuestions: closingQuestions })
      }}
    >
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {steps > 0 ? "Regenerate study steps" : "Generate study steps"}
      </Button>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={closingQuestions}
          onChange={(event) => setClosingQuestions(event.target.checked)}
          className="size-3.5 accent-primary"
        />
        Include the two closing questions
      </label>
      {steps > 0 && (
        <span className="text-xs text-muted-foreground">
          {steps} {steps === 1 ? "step" : "steps"}
        </span>
      )}
    </form>
  )
}
