import Link from "next/link"
import { BookOpenIcon, NetworkIcon } from "lucide-react"
import { docPath, type DocEntry, type DocSection } from "@/lib/docs"

// Layout shared by every documentation page: a quiet sidebar listing both
// layers, and the rendered markdown as the body. The markdown is our own
// repository content, so raw rendering is safe.
export const DocsShell = ({
  entries,
  html,
  activeSection,
  activeSlug
}: {
  entries: { guide: DocEntry[]; reference: DocEntry[] }
  html: string
  activeSection?: DocSection
  activeSlug?: string
}) => {
  const linkClass = (active: boolean) =>
    `block rounded-md px-3 py-1.5 text-sm ${
      active
        ? "bg-accent text-accent-foreground font-medium"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    }`

  const group = (
    section: DocSection,
    label: string,
    Icon: typeof BookOpenIcon,
    items: DocEntry[]
  ) => (
    <div className="space-y-1">
      <Link
        href={section === "guide" ? "/docs" : "/docs/reference"}
        className={`flex items-center gap-2 ${linkClass(
          activeSection === section && !activeSlug
        )}`}
      >
        <Icon className="size-3.5" />
        {label}
      </Link>
      {items.map((entry) => (
        <Link
          key={entry.slug}
          href={docPath(section, entry.slug)}
          className={linkClass(
            activeSection === section && entry.slug === activeSlug
          )}
        >
          {entry.title}
        </Link>
      ))}
    </div>
  )

  return (
    <main className="px-4 py-8">
      <div className="max-w-5xl w-full mx-auto flex flex-col gap-8 md:flex-row">
        <aside className="hidden md:block w-56 shrink-0">
          <div className="sticky top-4 space-y-4">
            {group("guide", "User guide", BookOpenIcon, entries.guide)}
            {group(
              "reference",
              "Knowledge organization",
              NetworkIcon,
              entries.reference
            )}
            <div className="border-t border-border pt-3">
              <Link
                href="/about"
                className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                About MatSci-SAM
              </Link>
            </div>
          </div>
        </aside>
        <nav
          aria-label="Project information"
          className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-4 text-sm md:hidden"
        >
          <Link href="/docs" className="text-primary hover:underline">
            User guide
          </Link>
          <Link href="/docs/reference" className="text-primary hover:underline">
            Knowledge organization
          </Link>
          <Link href="/about" className="text-primary hover:underline">
            About MatSci-SAM
          </Link>
        </nav>
        <article
          className="prose dark:prose-invert max-w-none flex-1 min-w-0
            prose-a:text-primary
            prose-code:before:content-none prose-code:after:content-none
            prose-img:rounded-lg prose-img:border prose-img:border-border
          prose-table:block prose-table:overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </main>
  )
}
