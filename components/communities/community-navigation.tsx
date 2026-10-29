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
  area,
  vocabularyHref
}: {
  slug: string
  view: string
  showSurveys: boolean
  showSettings?: boolean
  standardsEnabled?: boolean
  area?: string
  referenceReleaseId?: string
  vocabularyHref: string
}) {
  const router = useRouter()
  useEffect(() => {
    // Existing survey links used this anchor on the single community page.
    if (
      ["overview", "quickstart"].includes(view) &&
      window.location.hash === "#studies"
    )
      router.replace(`/communities/${slug}?view=surveys#studies`)
    if (
      view === "work" &&
      showSettings &&
      window.location.hash === "#workspace-tools"
    )
      router.replace(`/communities/${slug}?view=settings#workspace-tools`)
  }, [router, slug, view, showSettings])
  const sections = [
    ["quickstart", "Quick start"],
    ["review", "Review"],
    ["vocabulary", standardsEnabled ? "Standard" : "Vocabulary"],
    ["work", "My work"],
    ["people", "People"]
  ]
  const href = (key: string) =>
    `/communities/${slug}?` +
    new URLSearchParams({
      view: key,
      ...(area &&
      [
        "quickstart",
        "review",
        "vocabulary",
        "proposals",
        "work",
        "settings"
      ].includes(key)
        ? { profile: area }
        : {}),
      ...(referenceReleaseId && ["vocabulary", "proposals"].includes(key)
        ? { release: referenceReleaseId }
        : {})
    })
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
            href={href(key)}
            aria-current={view === key ? "page" : undefined}
          >
            {label}
          </Link>
        </Button>
      ))}
      {
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              More
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {[
              ...(standardsEnabled
                ? [
                    ["proposals", "Proposals"],
                    ["releases", "Community releases"],
                    ["terms", "Vocabulary terms"]
                  ]
                : []),
              ["collections", "Collections"],
              ["overview", "About"],
              ...(showSurveys ? [["surveys", "Surveys"]] : []),
              ...(showSettings ? [["settings", "Settings"]] : [])
            ].map(([key, label]) => (
              <DropdownMenuItem asChild key={key}>
                <Link
                  href={key === "terms" ? vocabularyHref : href(key)}
                  aria-current={view === key ? "page" : undefined}
                >
                  {label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    </nav>
  )
}
