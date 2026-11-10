"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import {
  COMMUNITY_SECTIONS,
  communitySection,
  communitySectionHref
} from "@/lib/community-navigation"

export function CommunityNavigation({
  slug,
  view,
  showSurveys,
  showSettings = false,
  referenceReleaseId,
  area
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
  const searchParams = useSearchParams()
  const selected = communitySection(view)
  const href = (key: string) =>
    communitySectionHref(slug, key, searchParams, {
      profile: area,
      release: referenceReleaseId
    })
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
  return (
    <nav
      aria-label="Community workspace"
      className="flex flex-wrap gap-1 border-b pb-3"
    >
      {COMMUNITY_SECTIONS.map(({ id: key, label }) => (
        <Button
          asChild
          key={key}
          variant={selected === key ? "secondary" : "ghost"}
          size="sm"
          className="min-h-11"
        >
          <Link
            href={href(key)}
            aria-current={selected === key ? "page" : undefined}
          >
            {label}
          </Link>
        </Button>
      ))}
      {showSettings && (
        <Button
          asChild
          size="sm"
          className="min-h-11"
          variant={view === "settings" ? "secondary" : "outline"}
        >
          <Link
            href={href("settings")}
            aria-current={view === "settings" ? "page" : undefined}
          >
            Manage community
          </Link>
        </Button>
      )}
      {
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={
                ["collections", "overview", "surveys"].includes(view)
                  ? "secondary"
                  : "ghost"
              }
              size="sm"
              className="min-h-11"
            >
              More
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {[
              ["collections", "Collections"],
              ["overview", "About"],
              ...(showSurveys ? [["surveys", "Surveys"]] : [])
            ].map(([key, label]) => (
              <DropdownMenuItem asChild key={key}>
                <Link
                  href={href(key)}
                  aria-current={selected === key ? "page" : undefined}
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
