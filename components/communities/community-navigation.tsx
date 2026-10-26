"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

export function CommunityNavigation({
  slug,
  view,
  showSurveys,
  showSettings = false,
  standardsEnabled = false,
  referenceReleaseId,
  vocabularyHref
}: {
  slug: string
  view: string
  showSurveys: boolean
  showSettings?: boolean
  standardsEnabled?: boolean
  referenceReleaseId?: string
  vocabularyHref: string
}) {
  const router = useRouter()
  useEffect(() => {
    // Existing survey links used this anchor on the single community page.
    if (view === "overview" && window.location.hash === "#studies")
      router.replace(`/communities/${slug}?view=surveys#studies`)
    if (
      view === "work" &&
      showSettings &&
      window.location.hash === "#workspace-tools"
    )
      router.replace(`/communities/${slug}?view=settings#workspace-tools`)
  }, [router, slug, view, showSettings])
  const sections = standardsEnabled
    ? [
        ["vocabulary", "Standard"],
        ["proposals", "Proposals"],
        ["work", "My drafts"],
        ["people", "People"]
      ]
    : [
        ["overview", "Overview"],
        ["vocabulary", "Vocabulary"],
        ["work", "My work"],
        ["collections", "Collections"],
        ["people", "People"],
        ...(showSurveys ? [["surveys", "Surveys"]] : []),
        ...(showSettings ? [["settings", "Settings"]] : [])
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
            href={`/communities/${slug}${key === "overview" ? "" : `?view=${key}${referenceReleaseId && ["vocabulary", "proposals"].includes(key) ? `&release=${encodeURIComponent(referenceReleaseId)}` : ""}`}`}
            aria-current={view === key ? "page" : undefined}
          >
            {label}
          </Link>
        </Button>
      ))}
      {standardsEnabled ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              More
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {[
              ["releases", "Community releases"],
              ["terms", "Vocabulary terms"],
              ["collections", "Collections"],
              ["overview", "About"],
              ...(showSurveys ? [["surveys", "Surveys"]] : []),
              ...(showSettings ? [["settings", "Settings"]] : [])
            ].map(([key, label]) => (
              <DropdownMenuItem asChild key={key}>
                <Link
                  href={
                    key === "terms"
                      ? vocabularyHref
                      : `/communities/${slug}?view=${key}`
                  }
                  aria-current={view === key ? "page" : undefined}
                >
                  {label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  )
}
