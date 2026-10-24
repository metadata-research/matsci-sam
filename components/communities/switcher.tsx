"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { ChevronDownIcon, UsersIcon } from "lucide-react"
import { buttonVariants } from "../ui/button"
import { cn } from "@/lib/utils"
import styles from "../header.module.css"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import { communityPath } from "@/lib/public-identifiers"
import { saveDraftsBeforeNavigation } from "@/lib/draft-navigation-guards"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from "../ui/dropdown-menu"

type Community = { id: number; slug: string; title: string }
const subscribeHydration = () => () => {}
const clientReady = () => true
const serverReady = () => false

// Keep pending state outside the menu content so closing and reopening it
// during a draft save cannot start a second switch.
export const CommunityMenu = ({
  scope,
  memberships
}: {
  scope: Community | null
  memberships: Community[]
}) => {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    clientReady,
    serverReady
  )
  const { mutateAsync: setActive } = trpc.communities.setActive.useMutation()
  const switching = useRef(false)
  const [isPending, setPending] = useState(false)

  async function select(community: (typeof memberships)[number] | null) {
    if (switching.current) return
    switching.current = true
    setPending(true)
    try {
      // Menu selection is not an anchor click, so ask the editors to save
      // before changing account context or leaving the page.
      try {
        await saveDraftsBeforeNavigation()
      } catch {
        toast.error(
          "Your draft could not be saved. Retry saving before switching communities."
        )
        return
      }
      const communityId = community?.id ?? null
      if (communityId !== (scope?.id ?? null)) await setActive({ communityId })
      // Full navigation refreshes both server scope and page content. Selecting
      // the current community also opens it, without another preference write.
      window.location.assign(community ? communityPath(community.slug) : "/")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not switch communities."
      )
    } finally {
      switching.current = false
      setPending(false)
    }
  }

  if (memberships.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!hydrated}
        className={cn(buttonVariants({ variant: "outline" }), styles.scopePill)}
        aria-label={
          scope ? `Community: ${scope.title}` : "Community: Everything"
        }
      >
        <UsersIcon aria-hidden />
        <span className="hidden text-xs text-muted-foreground lg:inline">
          Community
        </span>
        <span className={styles.scopeName}>
          {scope ? scope.title : "Everything"}
        </span>
        <ChevronDownIcon className={styles.navChevron} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Community</DropdownMenuLabel>
        <p className="max-w-64 px-2 pb-2 text-xs text-muted-foreground">
          Opens the community and uses it for browsing and new contributions.
        </p>
        <DropdownMenuRadioGroup value={String(scope?.id ?? "all")}>
          <DropdownMenuRadioItem
            value="all"
            disabled={isPending}
            onSelect={() => void select(null)}
          >
            Everything
          </DropdownMenuRadioItem>
          {memberships.map((community) => (
            <DropdownMenuRadioItem
              key={community.id}
              value={String(community.id)}
              disabled={isPending}
              onSelect={() => void select(community)}
            >
              {community.title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {scope && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href={`${communityPath(scope.slug)}?view=work`}>
                  My work
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
