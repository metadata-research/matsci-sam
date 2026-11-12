"use client"

import Link from "next/link"
import { useLayoutEffect, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { matchingHierarchy, type HierarchyNode } from "@/lib/hierarchy"
import { cn } from "@/lib/utils"

type SavedOutline = {
  expanded: string[]
  selection?: string
  search?: string
  scroll?: number
  searchClosed?: string[]
}

/** Reusable disclosure navigation, with standard buttons and links, not an ARIA tree. */
export function HierarchyOutline({
  nodes,
  search,
  label,
  initialExpanded = [],
  activeHref,
  restoreFocus = true
}: {
  nodes: HierarchyNode[]
  search: string
  label: string
  initialExpanded?: string[]
  activeHref?: string
  restoreFocus?: boolean
}) {
  // Keep expansion during field navigation, but start a fresh visit collapsed.
  // A direct field link supplies only the ancestors needed to reveal that field.
  const [saved, save] = useState<SavedOutline>(() => ({
    expanded: initialExpanded
  }))
  const expanded = saved.expanded
  const searchClosed =
    saved?.search === search ? (saved.searchClosed ?? []) : []
  const selection = saved?.search === search ? saved.selection : undefined
  const container = useRef<HTMLElement>(null)
  const restored = useRef(false)
  const visible = search ? matchingHierarchy(nodes) : nodes

  useLayoutEffect(() => {
    if (!restoreFocus) {
      restored.current = false
      return
    }
    if (restored.current || !saved) return
    if (saved.search !== search || typeof saved.selection !== "string") return
    const frame = requestAnimationFrame(() => {
      restored.current = true
      const target = Array.from(
        container.current?.querySelectorAll<HTMLAnchorElement>(
          "a[data-outline-id]"
        ) ?? []
      ).find((link) => link.dataset.outlineId === saved.selection)
      if (target) {
        target.focus({ preventScroll: true })
        if (typeof saved.scroll === "number" && Number.isFinite(saved.scroll))
          window.scrollTo({
            top: Math.max(0, saved.scroll),
            behavior: "instant"
          })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [saved, search, restoreFocus])

  function render(nodes: HierarchyNode[], nested = false) {
    return (
      <ul
        className={cn(
          "flex min-w-0 flex-col",
          nested && "ml-3 border-l pl-2 sm:ml-5 sm:pl-3"
        )}
      >
        {nodes.map((node) => {
          const open = search
            ? !searchClosed.includes(node.id)
            : expanded.includes(node.id)
          const toggle = (next: boolean) => {
            // A collapse invoked while focus is inside the branch returns focus to its trigger.
            const row = container.current?.querySelector<HTMLElement>(
              `[data-branch-id="${CSS.escape(node.id)}"]`
            )
            const active = document.activeElement
            if (!next && active instanceof HTMLElement && row?.contains(active))
              row.querySelector<HTMLButtonElement>("button")?.focus()
            if (search) {
              const ids = next
                ? searchClosed.filter((id) => id !== node.id)
                : [...searchClosed, node.id]
              save({ expanded, search, searchClosed: ids })
            } else {
              const ids = next
                ? [...expanded, node.id]
                : expanded.filter((id) => id !== node.id)
              save({ expanded: ids })
            }
          }
          return (
            <li key={node.id}>
              <Collapsible
                open={open}
                onOpenChange={toggle}
                data-branch-id={node.id}
              >
                <div className="flex min-w-0 items-start gap-1 py-1">
                  {node.children.length ? (
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        className="size-11 shrink-0"
                        aria-label={`${open ? "Collapse" : "Expand"} ${node.label}`}
                      >
                        <ChevronRight
                          className={cn("size-4", open && "rotate-90")}
                          aria-hidden="true"
                        />
                      </Button>
                    </CollapsibleTrigger>
                  ) : (
                    <span className="w-11 shrink-0" aria-hidden="true" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    {node.href ? (
                      <Link
                        href={node.href}
                        data-outline-id={node.id}
                        aria-current={
                          node.href === activeHref ? "page" : undefined
                        }
                        className={cn(
                          "inline-flex min-h-11 min-w-0 items-center break-words rounded-sm py-2 underline underline-offset-4 [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-ring",
                          (activeHref
                            ? node.href === activeHref
                            : selection === node.id) && "bg-muted"
                        )}
                        onClick={() => {
                          save({
                            expanded,
                            selection: node.id,
                            search,
                            scroll: window.scrollY,
                            searchClosed
                          })
                        }}
                      >
                        {node.label}
                      </Link>
                    ) : (
                      <span className="flex min-h-11 items-center break-words py-2 font-medium [overflow-wrap:anywhere]">
                        {node.label}
                      </span>
                    )}
                    {node.labels?.map((text) => (
                      <Badge key={text} variant="outline">
                        {text}
                      </Badge>
                    ))}
                  </div>
                </div>
                {node.children.length ? (
                  <CollapsibleContent>
                    {render(node.children, true)}
                  </CollapsibleContent>
                ) : null}
              </Collapsible>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <nav
      ref={container}
      aria-label={label}
      className="min-w-0 rounded-lg border p-2"
    >
      {render(visible)}
    </nav>
  )
}
