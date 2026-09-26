"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

const ARRIVED = "data-arrived"
// The fade in app/globals.css lasts as long as the mark.
const MARK_MS = 2400
// A target can stream in, or wait for a view to reveal it.
const WAIT_MS = 3000

const fragmentId = (hash: string) => {
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return ""
  }
}

/** The section a targeted heading labels, or the target itself. */
const regionFor = (target: HTMLElement) =>
  (/^H[1-6]$/.test(target.tagName) &&
    target.closest<HTMLElement>(
      `[aria-labelledby~="${CSS.escape(target.id)}"]`
    )) ||
  target

/**
 * Marks the section a link's fragment names for a moment, so a reader sees
 * where the link led. A Next.js Link changes the address with pushState,
 * which :target does not follow, so the mark is set here.
 */
export function ArrivalHighlight() {
  const pathname = usePathname()
  useEffect(() => {
    let frame = 0
    let timer = 0
    let marked: HTMLElement | null = null
    let markedAt = 0
    const clear = () => {
      marked?.removeAttribute(ARRIVED)
      marked = null
    }
    const mark = (id: string) => {
      cancelAnimationFrame(frame)
      if (!id) return
      const started = performance.now()
      const attempt = () => {
        const target = document.getElementById(id)
        if (!target?.checkVisibility()) {
          if (performance.now() - started < WAIT_MS)
            frame = requestAnimationFrame(attempt)
          return
        }
        const region = regionFor(target)
        if (region.tagName === "MAIN" || region === document.body) return
        const now = performance.now()
        // A plain fragment link reports both its click and its hashchange.
        if (region === marked && now - markedAt < 500) return
        clear()
        window.clearTimeout(timer)
        // Reading layout restarts the fade when the same section is marked again.
        void region.offsetWidth
        region.setAttribute(ARRIVED, "")
        marked = region
        markedAt = now
        timer = window.setTimeout(clear, MARK_MS + 100)
        // A heading lands at the top of the window, above which its section
        // begins. Show the whole mark.
        const top = region.getBoundingClientRect().top
        if (top < 16 && top > -window.innerHeight / 2)
          region.scrollIntoView({ block: "start" })
      }
      frame = requestAnimationFrame(attempt)
    }
    const markFromAddress = () => mark(fragmentId(window.location.hash))
    // A link to another page is marked when that page renders, below.
    const markSamePage = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a[href]")
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        !anchor.hash ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        (anchor.target && anchor.target !== "_self") ||
        anchor.pathname !== window.location.pathname ||
        anchor.search !== window.location.search
      )
        return
      mark(fragmentId(anchor.hash))
    }
    window.addEventListener("hashchange", markFromAddress)
    document.addEventListener("click", markSamePage, true)
    markFromAddress()
    return () => {
      window.removeEventListener("hashchange", markFromAddress)
      document.removeEventListener("click", markSamePage, true)
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      clear()
    }
  }, [pathname])
  return null
}
