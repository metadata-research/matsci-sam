"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentProps } from "react"
import { DropdownMenuTrigger } from "./ui/dropdown-menu"

const isWithin = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`)

export function HeaderNavLink({
  href,
  exact = false,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string
  exact?: boolean
}) {
  const pathname = usePathname()

  return (
    <Link
      {...props}
      href={href}
      aria-current={pathname === href ? "page" : undefined}
      data-active={
        (exact ? pathname === href : isWithin(pathname, href)) || undefined
      }
    />
  )
}

export function HeaderNavMenuTrigger({
  activePaths,
  ...props
}: ComponentProps<typeof DropdownMenuTrigger> & { activePaths: string[] }) {
  const pathname = usePathname()

  return (
    <DropdownMenuTrigger
      {...props}
      data-active={
        activePaths.some((href) => isWithin(pathname, href)) || undefined
      }
    />
  )
}
