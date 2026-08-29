import type { ReactNode } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export function StudyActionButton({
  href,
  children
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Button
      asChild
      className="bg-red-600 text-white shadow-xs hover:bg-red-700 focus-visible:ring-red-600/30 dark:bg-red-600 dark:hover:bg-red-700"
    >
      <Link href={href}>{children}</Link>
    </Button>
  )
}
