"use client"

import type { ComponentProps } from "react"
import { AutoComplete } from "@/components/autocomplete"

const SEARCH_KEYS = ["vocabularyTitle"]

/** One term picker for the homepage starter and the contribution form. */
export function TermAutocomplete(
  props: Omit<ComponentProps<typeof AutoComplete>, "searchKeys" | "renderFn">
) {
  return (
    <AutoComplete
      {...props}
      searchKeys={SEARCH_KEYS}
      renderFn={(option) => (
        <span className="flex min-w-0 w-full items-baseline justify-between gap-3">
          <span className="min-w-0 break-words">{option.value}</span>
          <span className="text-xs text-muted-foreground">
            {option.vocabularyTitle}
          </span>
        </span>
      )}
    />
  )
}
