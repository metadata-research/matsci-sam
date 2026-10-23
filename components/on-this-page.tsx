"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export type PageSection = { id: string; label: string }

/** Section links within one view; destinations come from its rendering rules. */
export function OnThisPage({
  sections,
  children
}: {
  sections: PageSection[]
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [current, setCurrent] = useState("")
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const sectionKey = sections.map(({ id }) => id).join("|")

  useEffect(() => {
    if (!sectionKey.includes("|")) return
    const ids = sectionKey.split("|")
    const targets = ids.flatMap((id) => {
      const target = document.getElementById(id)
      return target && root.current?.contains(target) ? [target] : []
    })
    const update = () => {
      const visible = targets.filter((target) => target.checkVisibility())
      let active: HTMLElement | undefined = visible[0]
      for (const target of visible) {
        if (target.getBoundingClientRect().top <= 104) active = target
      }
      if (
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2
      ) {
        // Short pages cannot scroll each heading to the top. Keep an explicitly
        // focused destination current while it remains visible at the bottom.
        const focused = visible.find((target) => {
          const bounds = target.getBoundingClientRect()
          return (
            target === document.activeElement &&
            bounds.bottom > 80 &&
            bounds.top < window.innerHeight
          )
        })
        active = focused ?? visible.at(-1)
      }
      setCurrent(active?.id ?? "")
    }
    // Only a few section headings are observed, never every list row.
    const observer = new IntersectionObserver(update, {
      rootMargin: "-80px 0px -50% 0px",
      threshold: [0, 1]
    })
    targets.forEach((target) => observer.observe(target))
    let bottom = false
    const updateAtBottom = () => {
      const next =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2
      if (bottom !== next) {
        bottom = next
        update()
      }
    }
    update()
    window.addEventListener("hashchange", update)
    window.addEventListener("scroll", updateAtBottom, { passive: true })
    const container = root.current
    container?.addEventListener("focusin", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("hashchange", update)
      window.removeEventListener("scroll", updateAtBottom)
      container?.removeEventListener("focusin", update)
    }
  }, [sectionKey, pathname, search, children])

  if (sections.length < 2) return children
  const active = sections.find(({ id }) => id === current) ?? sections[0]
  return (
    <div
      ref={root}
      className="section-layout grid items-start gap-5 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-8"
    >
      <nav
        aria-label="On this page"
        className="sticky top-2 z-20 rounded-lg border bg-background p-2 lg:top-6 lg:z-auto lg:border-0 lg:p-0"
        onKeyDown={(event) => {
          if (event.key === "Escape" && expanded) {
            setExpanded(false)
            event.currentTarget
              .querySelector<HTMLButtonElement>("button")
              ?.focus()
          }
        }}
      >
        <p className="mb-2 hidden text-sm font-semibold lg:block">
          On this page
        </p>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          className="h-auto min-h-10 w-full justify-between gap-3 whitespace-normal px-2 text-left lg:hidden"
        >
          <span>
            <span className="font-semibold">On this page</span>
            <span className="text-muted-foreground"> · {active.label}</span>
          </span>
          <ChevronDownIcon
            aria-hidden
            data-icon="inline-end"
            className={cn(expanded && "rotate-180")}
          />
        </Button>
        <ul
          id={listId}
          className={cn(
            "max-h-[55dvh] flex-col gap-1 overflow-y-auto lg:flex lg:max-h-[calc(100dvh-5rem)]",
            expanded ? "flex" : "hidden"
          )}
        >
          {sections.map(({ id, label }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                data-section-link
                aria-current={id === active.id ? "location" : undefined}
                className={cn(
                  "block rounded-md border-l-2 px-3 py-2 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                  id === active.id
                    ? "border-primary bg-accent font-medium text-foreground"
                    : "border-transparent text-muted-foreground"
                )}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return
                  setExpanded(false)
                  setCurrent(id)
                }}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-7">{children}</div>
    </div>
  )
}
