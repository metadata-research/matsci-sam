"use client"

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
 * value is the active community or "all", not a boolean, because "I have no
 * communities", "I have not chosen" and "I chose everything" all have to look
 * the same on screen and all mean the unscoped view.
 *
 * Switching reloads the current route after the preference is saved. The
 * active vocabulary affects both the root layout and page-level server
 * queries, so a full navigation keeps those two surfaces in lockstep.
 */
export const CommunitySwitcher = ({
  active,
  memberships
}: {
  active: { id: number } | null
  memberships: { id: number; title: string }[]
}) => {
  const { mutate: setActive } = trpc.communities.setActive.useMutation({
    onSuccess: () => window.location.reload(),
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
