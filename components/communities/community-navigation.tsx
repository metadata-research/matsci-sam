"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function CommunityNavigation({
  slug,
  view,
  showSurveys
}: {
  slug: string
  view: string
  showSurveys: boolean
}) {
  const router = useRouter()
  useEffect(() => {
    // Existing survey links used this anchor on the single community page.
    if (view === "overview" && window.location.hash === "#studies")
      router.replace(`/communities/${slug}?view=surveys#studies`)
  }, [router, slug, view])
  const sections = [
    ["overview", "Overview"],
    ["vocabulary", "Vocabulary"],
    ["work", "My work"],
    ["collections", "Collections"],
    ["people", "People"],
    ...(showSurveys ? [["surveys", "Surveys"]] : [])
  ]
  return (
    <nav
      aria-label="Community workspace"
      className="flex flex-wrap gap-1 border-b pb-3"
    >
      {sections.map(([key, label]) => (
        <Button
          asChild
          key={key}
          variant={view === key ? "secondary" : "ghost"}
          size="sm"
        >
          <Link
            href={`/communities/${slug}${key === "overview" ? "" : `?view=${key}`}`}
            aria-current={view === key ? "page" : undefined}
          >
            {label}
          </Link>
        </Button>
      ))}
    </nav>
  )
}
