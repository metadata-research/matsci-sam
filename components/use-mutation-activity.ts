"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Mutation lifecycle callbacks let a parent keep navigation mounted and
 * disabled from the initiating click until every overlapping write settles.
 */
export interface MutationActivityCallbacks {
  onMutationStart?: () => void
  onMutationEnd?: () => void
}

interface MutationActivityOptions extends MutationActivityCallbacks {
  onBusyChange?: (busy: boolean) => void
}

/**
 * Count mutation lifecycles rather than mirroring one `isPending` boolean.
 * That makes nested and overlapping controls safe, and `start` can be called
 * synchronously in the initiating event before navigation is possible.
 */
export function useMutationActivity(options: MutationActivityOptions = {}) {
  const optionsRef = useRef(options)
  const pendingRef = useRef(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const start = useCallback(() => {
    pendingRef.current += 1
    optionsRef.current.onMutationStart?.()
    if (pendingRef.current === 1) {
      setBusy(true)
      optionsRef.current.onBusyChange?.(true)
    }
  }, [])

  const end = useCallback(() => {
    if (pendingRef.current === 0) return

    pendingRef.current -= 1
    optionsRef.current.onMutationEnd?.()
    if (pendingRef.current === 0) {
      setBusy(false)
      optionsRef.current.onBusyChange?.(false)
    }
  }, [])

  useEffect(
    () => () => {
      // A successful mutation can navigate before TanStack Query invokes its
      // settled callback. Release every lifecycle owned by this component;
      // any later callback sees zero and is therefore harmless.
      const pending = pendingRef.current
      pendingRef.current = 0
      for (let index = 0; index < pending; index += 1)
        optionsRef.current.onMutationEnd?.()
      if (pending > 0) optionsRef.current.onBusyChange?.(false)
    },
    []
  )

  return { busy, start, end }
}
