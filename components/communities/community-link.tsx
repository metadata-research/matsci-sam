"use client"

import { useSyncExternalStore, type ComponentProps } from "react"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import { saveDraftsBeforeNavigation } from "@/lib/draft-navigation-guards"

// A directory can contain several links beside the header selector. Share the
// pending state so a second choice cannot overtake the first while saving.
let navigationPending = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const pendingSnapshot = () => navigationPending
const serverSnapshot = () => false
const setPending = (value: boolean) => {
  navigationPending = value
  for (const listener of listeners) listener()
}

export function useCommunityNavigation(activeCommunityId: number | null) {
  const isPending = useSyncExternalStore(
    subscribe,
    pendingSnapshot,
    serverSnapshot
  )
  const { mutateAsync: setActive } = trpc.communities.setActive.useMutation()

  async function select(communityId: number | null, href: string) {
    if (navigationPending) return
    setPending(true)
    try {
      try {
        await saveDraftsBeforeNavigation()
      } catch {
        toast.error(
          "Your draft could not be saved. Retry saving before switching communities."
        )
        return
      }
      if (communityId !== activeCommunityId) await setActive({ communityId })
      // Reload the document so both the selected community and page content
      // reflect the same completed preference change.
      window.location.assign(href)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not switch communities."
      )
    } finally {
      setPending(false)
    }
  }

  return { isPending, select }
}

/** Known members select and open. Other readers follow an ordinary link. */
export function CommunityLink({
  communityId,
  activeCommunityId,
  href,
  ...props
}: Omit<ComponentProps<"a">, "onClick" | "href"> & {
  communityId?: number
  activeCommunityId: number | null
  href: string
}) {
  const { isPending, select } = useCommunityNavigation(activeCommunityId)
  return (
    <a
      {...props}
      href={href}
      aria-disabled={communityId !== undefined && isPending ? true : undefined}
      data-draft-navigation={communityId !== undefined ? "handled" : undefined}
      onClick={(event) => {
        // Preserve copy-link, modifier clicks and new-tab browsing. Preference
        // changes only follow an ordinary activation in this document.
        if (
          communityId === undefined ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          (event.currentTarget.target &&
            event.currentTarget.target !== "_self") ||
          event.currentTarget.hasAttribute("download")
        )
          return
        event.preventDefault()
        void select(communityId, href)
      }}
    />
  )
}
