"use client"

import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpenIcon,
  ClipboardCheckIcon,
  HomeIcon,
  MessageSquareTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagsIcon,
  UsersIcon
} from "lucide-react"
import styles from "./admin.module.css"

const SECTIONS = [
  {
    href: "/admin",
    label: "Overview",
    icon: HomeIcon,
    matches: ["/admin"]
  },
  {
    href: "/admin/review",
    label: "Review",
    icon: ClipboardCheckIcon,
    matches: ["/admin/review"]
  },
  {
    href: "/admin/feedback",
    label: "Feedback",
    icon: MessageSquareTextIcon,
    matches: ["/admin/feedback"]
  },
  {
    href: "/admin/terms",
    label: "Vocabulary",
    icon: BookOpenIcon,
    matches: ["/admin/terms"]
  },
  {
    href: "/admin/tags",
    label: "Tags",
    icon: TagsIcon,
    matches: ["/admin/tags"]
  },
  {
    href: "/admin/users",
    label: "People",
    icon: UsersIcon,
    matches: ["/admin/users"]
  },
  {
    href: "/admin/integrations",
    label: "AI & services",
    icon: SparklesIcon,
    ai: true,
    matches: ["/admin/integrations", "/admin/prompts"]
  },
  {
    href: "/admin/audit",
    label: "Audit & safety",
    icon: ShieldCheckIcon,
    matches: ["/admin/audit"]
  }
]

export const AdminNav = () => {
  const pathname = usePathname()

  const isActive = (matches: string[]) =>
    matches.some((match) =>
      match === "/admin" ? pathname === match : pathname.startsWith(match)
    )

  return (
    <nav className={styles.navigation} aria-label="Administration">
      {SECTIONS.map(({ href, label, icon: Icon, ai, matches }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(matches) ? "page" : undefined}
          className={cn(
            styles.navigationLink,
            isActive(matches) && styles.navigationLinkActive
          )}
        >
          <Icon
            aria-hidden
            className={cn(styles.navigationIcon, ai && styles.navigationIconAi)}
          />
          {label}
        </Link>
      ))}
    </nav>
  )
}
