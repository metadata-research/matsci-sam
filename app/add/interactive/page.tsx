import { permanentRedirect } from "next/navigation"
import { initialTermFromSearchParam } from "../initial-term"

// Preserve old bookmarks without preserving a second contribution workflow.
export default async function InteractiveAddTermPage({
  searchParams
}: {
  searchParams: Promise<{ term?: string | string[] }>
}) {
  const { term } = await searchParams
  const initialTerm = initialTermFromSearchParam(term)

  permanentRedirect(
    initialTerm ? `/add?term=${encodeURIComponent(initialTerm)}` : "/add"
  )
}
