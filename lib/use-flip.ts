"use client"

import { RefObject, useLayoutEffect, useRef } from "react"

/*
 * FLIP layout animation for a reorderable list, no dependency.
 *
 * Each animated child carries a `data-flip-key`. We keep the last measured
 * position of every key in a ref; on the render after the order changes, the
 * stored position is the element's *old* spot and its current box is the *new*
 * one. Playing the inverse transform out to zero makes the browser animate the
 * move (First-Last-Invert-Play).
 *
 * `orderKey` should change only when the order does -- typically the joined
 * list of keys -- so the effect runs on reorder and not on every render.
 * Honors prefers-reduced-motion.
 */
export const useFlip = (
  containerRef: RefObject<HTMLElement | null>,
  orderKey: string
) => {
  const positions = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    const nodes = container.querySelectorAll<HTMLElement>("[data-flip-key]")

    nodes.forEach((node) => {
      const key = node.dataset.flipKey
      if (!key) return

      const next = node.getBoundingClientRect()
      const prev = positions.current.get(key)
      positions.current.set(key, next)

      if (!prev || reduce) return

      const dx = prev.left - next.left
      const dy = prev.top - next.top
      if (dx === 0 && dy === 0) return

      node.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" }
        ],
        { duration: 280, easing: "cubic-bezier(0.2, 0, 0, 1)" }
      )
    })
  }, [containerRef, orderKey])
}
