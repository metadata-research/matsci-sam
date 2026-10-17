"use client"

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent
} from "react"
import { MenuIcon } from "lucide-react"

const PORTALED_MENU_SELECTOR =
  '[data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"]'

export function MobileNavigationMenu({
  className,
  children
}: {
  className: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const triggerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    // Native details opens before its queued toggle event updates React.
    // Listen throughout and read the actual disclosure state so dismissal
    // also works immediately after opening it.
    const close = () => {
      if (detailsRef.current) detailsRef.current.open = false
      setOpen(false)
    }

    const closeForLink = (event: MouseEvent) => {
      if (!detailsRef.current?.open) return
      const target = event.target
      if (target instanceof Element && target.closest("a[href]")) close()
    }

    const closeForOutsidePointer = (event: PointerEvent) => {
      if (!detailsRef.current?.open) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (detailsRef.current?.contains(target)) return
      if (target instanceof Element && target.closest(PORTALED_MENU_SELECTOR))
        return

      close()
    }

    const closeForEscape = (event: KeyboardEvent) => {
      if (
        !detailsRef.current?.open ||
        event.key !== "Escape" ||
        event.defaultPrevented
      )
        return

      event.preventDefault()
      event.stopPropagation()
      close()
      triggerRef.current?.focus()
    }

    document.addEventListener("click", closeForLink)
    document.addEventListener("pointerdown", closeForOutsidePointer)
    document.addEventListener("keydown", closeForEscape)

    return () => {
      document.removeEventListener("click", closeForLink)
      document.removeEventListener("pointerdown", closeForOutsidePointer)
      document.removeEventListener("keydown", closeForEscape)
    }
  }, [])

  const syncOpenState = (event: SyntheticEvent<HTMLDetailsElement>) => {
    // Category disclosures have their own toggle events. Only the outer
    // disclosure controls the navigation panel and its dismissal listeners.
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open)
  }

  return (
    <details
      ref={detailsRef}
      className={className}
      open={open}
      onToggle={syncOpenState}
    >
      <summary
        ref={triggerRef}
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
      >
        <MenuIcon aria-hidden />
      </summary>
      {children}
    </details>
  )
}
