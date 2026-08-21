"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from "../ui/dropdown-menu"

/*
 * The standing choice of which community to work in, and the only surface a
 * plain member needs.
 *
 * It renders nothing at all for a person who belongs to no community, so a
 * signed-out reader and someone who has joined nothing see no new chrome. The
 * value is the active community or "all", never a boolean, because "I have no
 * communities", "I have not chosen" and "I chose everything" all have to look
 * the same on screen and all mean the unscoped view.
 *
 * A success toast is a deliberate departure from the collection controls,
 * which use none. Switching scope changes pages the viewer may not be looking
 * at, so a refresh on its own would give them nothing to see.
 */
export const CommunitySwitcher = ({
  active,
  memberships
}: {
  active: { id: number } | null
  memberships: { id: number; title: string }[]
}) => {
  const router = useRouter()

  const { mutate: setActive } = trpc.communities.setActive.useMutation({
    onSuccess: ({ title }) => {
      toast.success(title ? `Now working in ${title}` : "Now showing everything")
      router.refresh()
    },
    onError: (error) => toast.error(error.message)
  })

  if (memberships.length === 0) return null

  return (
    <>
      <DropdownMenuLabel>Working in</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={String(active?.id ?? "all")}
        onValueChange={(value) =>
          setActive({ communityId: value === "all" ? null : Number(value) })
        }
      >
        <DropdownMenuRadioItem value="all">Everything</DropdownMenuRadioItem>
        {memberships.map((community) => (
          <DropdownMenuRadioItem
            key={community.id}
            value={String(community.id)}
          >
            {community.title}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}
