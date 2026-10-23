import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

// Native selection matches the existing setup form and remains usable without
// an additional overlay dependency, including at mobile text sizes.
export function WorkspaceSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full min-w-0 rounded-md border px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}
