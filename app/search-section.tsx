"use client"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { trpc } from "@/trpc/client"
import { SearchIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { definitionPath } from "@/lib/public-identifiers"

export const SearchSection = ({
  hideResults = false,
  prominent = false
}: {
  hideResults?: boolean
  prominent?: boolean
}) => {
  const [query, setQuery] = useState("")
  const router = useRouter()

  const { data } = trpc.search.definitions.useQuery(
    { query, limit: 4 },
    {
      enabled: !hideResults,
      placeholderData: (old) => old
    }
  )

  const handleSearch = () => {
    const trimmedQuery = query.trim()
    router.push(
      trimmedQuery ? `/search?q=${encodeURIComponent(trimmedQuery)}` : "/search"
    )
  }

  return (
    <div className={cn("w-full space-y-2", !prominent && "max-w-xl")}>
      <form
        className={cn(
          "relative bg-card rounded-md",
          prominent ? "h-12" : "h-[36px]"
        )}
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          handleSearch()
        }}
      >
        <SearchIcon
          className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
            prominent ? "size-5" : "size-4"
          )}
          aria-hidden
        />
        <Input
          type="search"
          className={cn(
            "absolute inset-0 h-full",
            prominent ? "pl-10 pr-24 text-base" : "pl-8 pr-24"
          )}
          placeholder="Search terms and definitions..."
          aria-label="Search terms and definitions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className={cn(
            "absolute right-1 top-1/2 -translate-y-1/2 px-3 text-sm rounded-md border cursor-pointer transition-colors",
            prominent
              ? "h-10 bg-primary text-primary-foreground border-primary hover:bg-primary/90"
              : "h-[28px] bg-secondary text-secondary-foreground hover:bg-accent"
          )}
        >
          Search
        </button>
      </form>
      {!hideResults &&
        data?.map((item) => (
          <Card
            onClick={() =>
              router.push(definitionPath(item.termSlug, item.definitionNumber))
            }
            className="!gap-0 !p-2 cursor-pointer"
            key={item.id}
          >
            <h3 className="text-lg font-semibold">{item.term}</h3>
            <p>{item.definition}</p>
          </Card>
        ))}
      {!hideResults && data?.length === 0 && (
        <div className="text-sm text-center py-12">no results found</div>
      )}
    </div>
  )
}
