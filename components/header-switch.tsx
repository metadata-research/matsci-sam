"use client"

import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

// The walkthrough run page, where a participant works through the steps of
// a study. Every other route keeps the full navigation.
const RUN_PAGE = /^\/studies\/[^/]+\/run\/?$/

/*
 * Chooses the header for the route. Both headers arrive server-rendered as
 * nodes; this component only picks one, so the layout stays a server
 * component and the choice follows client-side navigation.
 */
export const HeaderSwitch = ({
  full,
  strip
}: {
  full: ReactNode
  strip: ReactNode
}) => (RUN_PAGE.test(usePathname()) ? strip : full)
