"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import styles from "./admin.module.css"

const links = [
  { href: "/admin/integrations", label: "Service health" },
  { href: "/admin/prompts", label: "Prompt registry" }
]

export function AiSubnav() {
  const pathname = usePathname()

  return (
    <nav className={styles.subnavigation} aria-label="AI and service sections">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          data-active={pathname.startsWith(href)}
          aria-current={pathname.startsWith(href) ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
