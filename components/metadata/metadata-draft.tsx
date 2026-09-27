"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject
} from "react"
import type { MetadataFieldKey } from "@/lib/dictionary-metadata"

/** What the sidebar asks the Add metadata form to fill. Nothing is saved. */
export type MetadataDraftFill = {
  /** The kind of entry to switch to, or the one the form shows. */
  fieldKey?: MetadataFieldKey
  value?: string
  source: { label: string; iri: string; version: string }
  focus: "value" | "source"
  status: string
}

type Filler = (fill: MetadataDraftFill) => void

const MetadataDraftContext = createContext<RefObject<Filler | null> | null>(
  null
)

/** Lets the sidebar fill the form while neither owns the other. */
export function MetadataDraftProvider({ children }: { children: ReactNode }) {
  const fillerRef = useRef<Filler | null>(null)
  return (
    <MetadataDraftContext value={fillerRef}>{children}</MetadataDraftContext>
  )
}

/** The form registers how a fill is applied. */
export function useMetadataDraftFiller(fill: Filler) {
  const fillerRef = useContext(MetadataDraftContext)
  useEffect(() => {
    if (!fillerRef) return
    fillerRef.current = fill
    return () => {
      if (fillerRef.current === fill) fillerRef.current = null
    }
  }, [fillerRef, fill])
}

/** A fill request for the registered form, if there is one. */
export function useFillMetadataDraft() {
  const fillerRef = useContext(MetadataDraftContext)
  return (fill: MetadataDraftFill) => fillerRef?.current?.(fill)
}
