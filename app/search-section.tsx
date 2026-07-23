"use client"

import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { trpc } from "@/trpc/client"
import { SearchIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

export const SearchSection = ({ hideResults = false }: { hideResults?: boolean }) => {
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
      trimmedQuery
        ? `/search?q=${encodeURIComponent(trimmedQuery)}`
        : "/search"
    )
  }

  return (
    <div className="max-w-xl w-full space-y-2">
      <form
        className="relative h-[36px] bg-card rounded-md"
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          handleSearch()
        }}
      >
        <SearchIcon
          className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          aria-hidden
        />
        <Input
          type="search"
          className="absolute inset-0 pl-8 pr-24"
          placeholder="Search to get started..."
          aria-label="Search terms and definitions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-[28px] px-3 bg-secondary text-secondary-foreground text-sm rounded-md border cursor-pointer hover:bg-accent transition-colors"
        >
          Search
        </button>
      </form>
      {!hideResults && data?.map((item) => (
        <Card
          onClick={() => router.push(`/definition/${item.id}`)}
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
