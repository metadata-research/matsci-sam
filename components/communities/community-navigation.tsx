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
  communityPrimarySections,
  communityMoreSections,
  communitySection,
  communitySectionHref
} from "@/lib/community-navigation"

export function CommunityNavigation({
  slug,
  view,
  showSurveys,
  showSettings = false,
  signedIn,
  referenceReleaseId,
  area
}: {
  slug: string
  view: string
  showSurveys: boolean
  showSettings?: boolean
  signedIn: boolean
  standardsEnabled?: boolean
  area?: string
  referenceReleaseId?: string
  vocabularyHref: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selected = communitySection(view)
  const moreSections = communityMoreSections({ showSurveys, showSettings })
  const selectedMore = moreSections.find(({ id }) => id === selected)
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
      className="flex min-w-0 gap-1 overflow-x-auto border-b pb-3"
    >
      {communityPrimarySections(signedIn).map(({ id: key, label }) => (
        <Button
          asChild
          key={key}
          variant={selected === key ? "secondary" : "ghost"}
          size="sm"
          className="min-h-11 shrink-0 px-2 sm:px-3"
        >
          <Link
            href={href(key)}
            aria-current={selected === key ? "page" : undefined}
          >
            {label}
          </Link>
        </Button>
      ))}
      {
        // Save guards intercept link clicks before Radix can close the menu.
        // Reset only after navigation succeeds, and keep save errors accessible.
        <DropdownMenu key={`${slug}:${searchParams.toString()}`} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant={selectedMore ? "secondary" : "ghost"}
              size="sm"
              className="min-h-11 shrink-0 px-2 sm:px-3"
              aria-label={selectedMore ? `More: ${selectedMore.label}` : "More"}
            >
              More
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {moreSections.map(({ id: key, label }) => (
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
