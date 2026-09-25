"use client"

import { useEffect, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

/** Mount for one pending request. Keep the ticking state out of the editor. */
export function ModelDraftingStatus({
  label = "Drafting a definition…"
}: {
  label?: string
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    const startedAt = performance.now()
    const updateElapsed = () =>
      setElapsedSeconds(Math.floor((performance.now() - startedAt) / 1000))
    // Calculate elapsed time rather than counting ticks: background tabs can
    // throttle callbacks without stopping the provider request.
    const timer = window.setInterval(updateElapsed, 1000)
    document.addEventListener("visibilitychange", updateElapsed)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", updateElapsed)
    }
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <p role="status" className="flex items-center gap-2">
        <LoaderCircleIcon
          aria-hidden
          className="size-4 shrink-0 motion-safe:animate-spin motion-reduce:animate-none"
        />
        <span>{label}</span>
      </p>
      <p
        role="timer"
        aria-label="Time waiting for the model"
        aria-live="off"
        className="shrink-0 tabular-nums"
      >
        {elapsedSeconds} s elapsed
      </p>
    </div>
  )
}
