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
    if (!open) return

    const closeForLink = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest("a[href]")) setOpen(false)
    }

    const closeForOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (detailsRef.current?.contains(target)) return
      if (target instanceof Element && target.closest(PORTALED_MENU_SELECTOR))
        return

      setOpen(false)
    }

    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return

      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
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
  }, [open])

  const syncOpenState = (event: SyntheticEvent<HTMLDetailsElement>) =>
    setOpen(event.currentTarget.open)

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
