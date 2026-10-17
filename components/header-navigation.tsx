"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, type ComponentProps } from "react"
import {
  headerDestinationPath,
  headerLinkState,
  headerMenuIsActive,
  type HeaderLinkDestination,
  type HeaderMenuDestinations
} from "@/lib/header-navigation"
import { DropdownMenuTrigger } from "./ui/dropdown-menu"

type HeaderNavLinkProps = Omit<ComponentProps<typeof Link>, "href"> &
  HeaderLinkDestination

export function HeaderNavLink(props: HeaderNavLinkProps) {
  if (headerDestinationPath(props.href) !== "/setup")
    return <HeaderNavLinkRoute {...props} />

  // Keep the link available during static rendering while isolating the
  // search-param subscription needed to distinguish the setup tasks.
  return (
    <Suspense fallback={<HeaderNavLinkRoute {...props} />}>
      <HeaderNavLinkWithTask {...props} />
    </Suspense>
  )
}

function HeaderNavLinkWithTask(props: HeaderNavLinkProps) {
  const searchParams = useSearchParams()
  return <HeaderNavLinkRoute {...props} searchParams={searchParams} />
}

function HeaderNavLinkRoute({
  href,
  exact = false,
  activePaths,
  searchParams,
  ...props
}: HeaderNavLinkProps & {
  searchParams?: Pick<URLSearchParams, "get">
}) {
  const pathname = usePathname()
  const { active, current } = headerLinkState(
    pathname,
    { href, exact, activePaths },
    searchParams
  )

  return (
    <Link
      {...props}
      href={href}
      aria-current={current ? "page" : undefined}
      data-active={active || undefined}
    />
  )
}

type HeaderNavMenuTriggerProps = ComponentProps<typeof DropdownMenuTrigger> &
  HeaderMenuDestinations

export function HeaderNavMenuTrigger(props: HeaderNavMenuTriggerProps) {
  if (!props.activeHrefs?.length)
    return <HeaderNavMenuTriggerRoute {...props} />

  return (
    <Suspense fallback={<HeaderNavMenuTriggerRoute {...props} />}>
      <HeaderNavMenuTriggerWithTask {...props} />
    </Suspense>
  )
}

function HeaderNavMenuTriggerWithTask(props: HeaderNavMenuTriggerProps) {
  const searchParams = useSearchParams()
  return <HeaderNavMenuTriggerRoute {...props} searchParams={searchParams} />
}

function HeaderNavMenuTriggerRoute({
  activePaths,
  activeHrefs,
  searchParams,
  ...props
}: HeaderNavMenuTriggerProps & {
  searchParams?: Pick<URLSearchParams, "get">
}) {
  const pathname = usePathname()

  return (
    <DropdownMenuTrigger
      {...props}
      data-active={
        headerMenuIsActive(
          pathname,
          { activePaths, activeHrefs },
          searchParams
        ) || undefined
      }
    />
  )
}
