"use client"

import { useSyncExternalStore } from "react"
import Link from "next/link"
import { ChevronDownIcon, UsersIcon } from "lucide-react"
import { buttonVariants } from "../ui/button"
import { cn } from "@/lib/utils"
import styles from "../header.module.css"
import { communityPath } from "@/lib/public-identifiers"
import { useCommunityNavigation } from "./community-link"
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
  const { isPending, select } = useCommunityNavigation(scope?.id ?? null)

  if (memberships.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!hydrated}
        className={cn(buttonVariants({ variant: "outline" }), styles.scopePill)}
        aria-label={
          scope ? `Community: ${scope.title}` : "Community: All communities"
        }
      >
        <UsersIcon aria-hidden />
        <span className={styles.scopeName}>
          {scope ? scope.title : "All communities"}
        </span>
        <ChevronDownIcon className={styles.navChevron} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Community</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(scope?.id ?? "all")}>
          <DropdownMenuRadioItem
            value="all"
            disabled={isPending}
            onSelect={() => void select(null, "/")}
          >
            All communities
          </DropdownMenuRadioItem>
          {memberships.map((community) => (
            <DropdownMenuRadioItem
              key={community.id}
              value={String(community.id)}
              disabled={isPending}
              onSelect={() =>
                void select(community.id, communityPath(community.slug))
              }
            >
              {community.title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {scope && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild disabled={isPending}>
                <Link href={`${communityPath(scope.slug)}?view=work`}>
                  My work
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild disabled={isPending}>
          <Link href="/communities">Find communities</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
