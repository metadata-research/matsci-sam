"use client"

import { useId, useRef, type ReactNode, type Ref } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card"

export type ModelPromptInputItem = {
  id: string
  label: string
  text: string
  included: boolean
  required?: boolean
  onIncludedChange?: (included: boolean) => void
  onClear?: () => void
}

type ModelPromptInputsProps = {
  term: string
  items: ModelPromptInputItem[]
  disabled?: boolean
  submitted?: boolean
  onClearOptional?: () => void
  assistantControls?: ReactNode
  assistantLabel?: string
  focusRef?: Ref<HTMLDivElement>
  children?: ReactNode
  embedded?: boolean
}

/** Shows either the next request's context or an immutable submitted snapshot. */
export function ModelPromptInputs({
  term,
  items,
  disabled = false,
  submitted = false,
  onClearOptional,
  assistantControls,
  assistantLabel,
  focusRef,
  children,
  embedded = false
}: ModelPromptInputsProps) {
  const instanceId = useId()
  const contextRef = useRef<HTMLDivElement>(null)
  const changeInput = (action: () => void) => {
    const focused = document.activeElement
    const buttons = Array.from(
      contextRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-context-remove]:not(:disabled)"
      ) ?? []
    )
    const focusedIndex = buttons.findIndex((button) => button === focused)
    action()
    requestAnimationFrame(() => {
      if (
        focused?.isConnected &&
        !(focused instanceof HTMLButtonElement && focused.disabled)
      )
        return
      const remaining = contextRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-context-remove]:not(:disabled)"
      )
      const next = remaining?.[Math.max(0, focusedIndex)] ?? remaining?.[0]
      ;(next ?? contextRef.current)?.focus({ preventScroll: true })
    })
  }
  const visibleItems = items.filter(
    (item) => (item.required || item.included) && item.text.trim().length > 0
  )
  const hasOptionalInputs = visibleItems.some((item) => !item.required)
  const controlsDisabled = disabled || submitted
  const headingId = `${instanceId}-heading`

  return (
    <Card
      ref={focusRef}
      tabIndex={-1}
      className={cn(
        "min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        embedded && "border-0 p-0 shadow-none"
      )}
      role="region"
      aria-labelledby={headingId}
    >
      <CardHeader className={cn("min-w-0", embedded && "px-0")}>
        {!submitted && assistantControls ? (
          <div className="mb-3 min-w-0">{assistantControls}</div>
        ) : null}
        <CardTitle>
          <h3 id={headingId}>
            {submitted ? "Context for this request" : "Assistant context"}
          </h3>
        </CardTitle>
        {submitted && assistantLabel ? (
          <p className="text-sm font-medium">Assistant: {assistantLabel}</p>
        ) : null}
        <CardDescription>
          {submitted
            ? "These inputs stay fixed while you continue editing."
            : "Removing context keeps your writing and citations."}
        </CardDescription>
      </CardHeader>
      <CardContent
        className={cn("flex min-w-0 flex-col gap-3", embedded && "px-0")}
      >
        <div
          ref={contextRef}
          role="group"
          aria-label="Included assistant context"
          tabIndex={-1}
          className="min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ul
            className="flex min-w-0 flex-wrap gap-2"
            aria-label="Context items"
          >
            <li className="min-w-0 max-w-full">
              <Badge variant="outline" className="min-h-8 whitespace-normal">
                Term <span className="text-muted-foreground">· Required</span>
              </Badge>
            </li>
            {visibleItems.map((item) => (
              <li key={item.id} className="min-w-0 max-w-full">
                <Badge
                  variant="secondary"
                  className="min-h-8 max-w-full justify-start gap-1 whitespace-normal text-left"
                >
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {item.label}
                  </span>
                  {item.required ? (
                    <span className="text-muted-foreground">· Required</span>
                  ) : !submitted && (item.onClear || item.onIncludedChange) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      data-context-remove
                      disabled={controlsDisabled}
                      aria-label={`Remove ${item.label} from assistant context`}
                      onClick={() => {
                        if (!controlsDisabled)
                          changeInput(() => {
                            if (item.onClear) item.onClear()
                            else item.onIncludedChange?.(false)
                          })
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
          <details className="min-w-0 flex-1 basis-40">
            <summary className="cursor-pointer text-sm underline underline-offset-4">
              Inspect input text
            </summary>
            <div className="mt-3 max-h-64 min-w-0 overflow-y-auto overscroll-contain rounded-md border p-3 text-sm">
              <p className="mb-3 text-muted-foreground">
                SAM’s definition-writing instructions are sent with these
                inputs.
              </p>
              <dl className="flex min-w-0 flex-col gap-3">
                <div className="min-w-0">
                  <dt className="font-medium">Term</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {term.trim() || "Choose a term to begin."}
                  </dd>
                </div>
                {visibleItems.map((item) => (
                  <div key={item.id} className="min-w-0">
                    <dt className="break-words font-medium [overflow-wrap:anywhere]">
                      {item.label}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {item.text}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
          {!submitted && onClearOptional ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-auto min-h-7 max-w-full whitespace-normal px-1 py-0 text-left text-xs"
              disabled={controlsDisabled || !hasOptionalInputs}
              onClick={() => {
                if (!controlsDisabled) changeInput(onClearOptional)
              }}
            >
              Clear optional context
            </Button>
          ) : null}
        </div>
      </CardContent>
      {children ? (
        <CardFooter className={cn("flex-wrap gap-2", embedded && "px-0")}>
          {children}
        </CardFooter>
      ) : null}
    </Card>
  )
}
