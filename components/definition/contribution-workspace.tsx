"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { ArrowLeftIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** The controller belongs to the form; changing visible panels never owns a lookup. */
export function ContributionWorkspace({
  children,
  context,
  contextOpen,
  onContextOpenChange,
  contextTitle = "Reference resources",
  returnLabel = "Back to definition"
}: {
  children: ReactNode
  context?: ReactNode
  contextOpen: boolean
  onContextOpenChange: (open: boolean) => void
  contextTitle?: string
  returnLabel?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const main = useRef<HTMLDivElement>(null)
  const contextPane = useRef<HTMLElement>(null)
  const wasWide = useRef(false)
  const changeOpen = useRef(onContextOpenChange)
  useEffect(() => {
    changeOpen.current = onContextOpenChange
  }, [onContextOpenChange])
  const heading = useRef<HTMLHeadingElement>(null)
  const previousOpen = useRef(contextOpen)
  const previousTitle = useRef(contextTitle)
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      // Match actual available space, including embedded forms and browser zoom.
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      const nextWide = entry.contentRect.width >= 52 * rem
      if (wasWide.current && !nextWide) {
        if (main.current?.contains(document.activeElement))
          changeOpen.current(false)
        else if (contextPane.current?.contains(document.activeElement))
          changeOpen.current(true)
      }
      wasWide.current = nextWide
      setWide(nextWide)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const openChanged = previousOpen.current !== contextOpen
    const titleChanged = previousTitle.current !== contextTitle
    const changed = openChanged || titleChanged
    previousOpen.current = contextOpen
    previousTitle.current = contextTitle
    if (!changed) return
    const frame = requestAnimationFrame(() => {
      // The caller may already have focused the inserted text or context panel.
      if (!contextOpen && main.current?.contains(document.activeElement)) return
      const target =
        contextOpen || (!openChanged && titleChanged)
          ? heading.current
          : main.current?.querySelector<HTMLElement>(
              "textarea:not(:disabled), input:not(:disabled), button:not(:disabled)"
            )
      target?.focus({ preventScroll: true })
      target?.scrollIntoView({ block: "nearest" })
    })
    return () => cancelAnimationFrame(frame)
  }, [contextOpen, contextTitle])

  const hasContext = context !== undefined && context !== null
  const showContext = hasContext && (wide || contextOpen)
  return (
    <div ref={container} className="min-w-0" data-contribution-workspace>
      <div
        className={cn(
          "grid min-w-0 items-start gap-5",
          wide && hasContext && "grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
        )}
      >
        {(!showContext || wide) && (
          <div ref={main} className="min-w-0" data-workspace-main>
            {children}
          </div>
        )}
        {showContext && (
          <aside
            ref={contextPane}
            aria-label={contextTitle}
            className="flex min-w-0 flex-col gap-3"
            data-workspace-context
          >
            {!wide && (
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => onContextOpenChange(false)}
              >
                <ArrowLeftIcon aria-hidden data-icon="inline-start" />
                {returnLabel}
              </Button>
            )}
            <h2 ref={heading} tabIndex={-1} className="sr-only">
              {contextTitle}
            </h2>
            {context}
          </aside>
        )}
      </div>
    </div>
  )
}
