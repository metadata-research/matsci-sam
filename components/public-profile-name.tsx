import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { modelPath } from "@/lib/public-identifiers"

type PublicProfileUser = {
  id?: number | null
  name?: string | null
  isAi?: boolean | null
  isProfilePublic?: boolean | null
  // Set for a model. A model has no visibility setting, because it has no
  // privacy interest and cannot consent, so its profile is always public.
  modelSlug?: string | null
}

export function PublicProfileName({
  user,
  fallback = "Unknown contributor",
  className
}: {
  user: PublicProfileUser | null | undefined
  fallback?: ReactNode
  className?: string
}) {
  const label = user?.name?.trim() || fallback

  if (user?.isAi === true && user.modelSlug) {
    return (
      <Link
        href={modelPath(user.modelSlug)}
        className={cn(
          "underline-offset-4 transition-colors hover:text-primary hover:underline",
          className
        )}
      >
        {label}
      </Link>
    )
  }

  if (
    typeof user?.id === "number" &&
    user.isProfilePublic === true &&
    user.isAi === false
  ) {
    return (
      <Link
        href={`/people/${user.id}`}
        className={cn(
          "underline-offset-4 transition-colors hover:text-primary hover:underline",
          className
        )}
      >
        {label}
      </Link>
    )
  }

  return <span className={className}>{label}</span>
}
