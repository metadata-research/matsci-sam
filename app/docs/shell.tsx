import Link from "next/link"
import {
  BookOpenIcon,
  ChevronRightIcon,
  NetworkIcon,
  RocketIcon
} from "lucide-react"
import {
  docPath,
  sectionBlurb,
  sectionIndexPath,
  sectionTitle,
  type DocEntry,
  type DocHeading,
  type DocSection
} from "@/lib/docs"
import { cn } from "@/lib/utils"

/*
 * Layout shared by every documentation page. The sidebar carries three groups
 * with distinct headings, and the rendered markdown is the body. The markdown
 * is our own repository content, so raw rendering is safe.
 *
 * Quick start is a direct link. The guide and reference groups start collapsed,
 * including the current section. Native details controls keep navigation compact
 * and keyboard-accessible without client state. The current section and page
 * remain highlighted when browsing.
 */

const linkClass = (active: boolean) =>
  cn(
    "block rounded-md border-l-2 px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
    active
      ? "border-primary bg-accent text-accent-foreground font-medium"
      : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  )

const Heading = ({
  Icon,
  label,
  blurb
}: {
  Icon: typeof BookOpenIcon
  label: string
  blurb: string
}) => (
  <span className="min-w-0">
    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon aria-hidden className="size-4 shrink-0 text-primary" />
      {label}
    </span>
    <span className="mt-0.5 block text-xs text-muted-foreground">{blurb}</span>
  </span>
)

const CollapsibleGroup = ({
  section,
  label,
  Icon,
  items,
  activeSection,
  activeSlug
}: {
  section: DocSection
  label: string
  Icon: typeof BookOpenIcon
  items: DocEntry[]
  activeSection?: DocSection
  activeSlug?: string
}) => (
  <details className="group">
    <summary
      className={cn(
        "flex cursor-pointer list-none items-start gap-1.5 rounded-md border-l-2 px-2 py-1.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden",
        activeSection === section
          ? "border-primary bg-accent"
          : "border-transparent"
      )}
    >
      <ChevronRightIcon
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
      />
      <Heading Icon={Icon} label={label} blurb={sectionBlurb[section]} />
    </summary>
    <div className="mt-1 ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
      <Link
        href={sectionIndexPath(section)}
        className={linkClass(activeSection === section && !activeSlug)}
        aria-current={
          activeSection === section && !activeSlug ? "page" : undefined
        }
      >
        Overview
      </Link>
      {items.map((entry) => (
        <Link
          key={entry.slug}
          href={docPath(section, entry.slug)}
          className={linkClass(
            activeSection === section && entry.slug === activeSlug
          )}
          aria-current={
            activeSection === section && entry.slug === activeSlug
              ? "page"
              : undefined
          }
        >
          {entry.title}
        </Link>
      ))}
    </div>
  </details>
)

export const DocsShell = ({
  entries,
  html,
  activeSection,
  activeSlug
}: {
  entries: {
    quickstart: DocHeading[]
    guide: DocEntry[]
    reference: DocEntry[]
  }
  html: string
  activeSection?: DocSection
  activeSlug?: string
}) => {
  const onQuickstart = activeSection === "quickstart"

  return (
    <main className="px-4 py-8">
      <div className="max-w-5xl w-full mx-auto flex flex-col gap-8 md:flex-row">
        <aside className="hidden md:block w-60 shrink-0">
          <nav
            aria-label="Help and reference"
            className="sticky top-4 flex flex-col gap-3"
          >
            <h2 className="px-3 text-base font-semibold text-primary">
              Help &amp; Guides
            </h2>
            <div>
              <Link
                href="/docs"
                aria-current={onQuickstart ? "page" : undefined}
                className={cn(
                  "flex items-start gap-1.5 rounded-md border-l-2 px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-ring",
                  onQuickstart
                    ? "border-primary bg-accent"
                    : "border-transparent hover:bg-accent"
                )}
              >
                <span className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <Heading
                  Icon={RocketIcon}
                  label="Quick start"
                  blurb={sectionBlurb.quickstart}
                />
              </Link>
            </div>

            <CollapsibleGroup
              section="guide"
              label={sectionTitle("guide")}
              Icon={BookOpenIcon}
              items={entries.guide}
              activeSection={activeSection}
              activeSlug={activeSlug}
            />

            <section
              aria-label="Technical documentation"
              className="border-t border-border pt-3"
            >
              <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">
                Technical documentation
              </p>
              <CollapsibleGroup
                section="reference"
                label={sectionTitle("reference")}
                Icon={NetworkIcon}
                items={entries.reference}
                activeSection={activeSection}
                activeSlug={activeSlug}
              />
            </section>

            <div className="border-t border-border pt-3">
              <Link
                href="/about"
                className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                About MatSci-SAM
              </Link>
            </div>
          </nav>
        </aside>

        <nav
          aria-label="Help and reference"
          className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-4 text-sm md:hidden"
        >
          <Link
            href="/docs"
            aria-current={onQuickstart ? "page" : undefined}
            className="text-primary hover:underline aria-[current=page]:font-semibold"
          >
            Quick start
          </Link>
          <Link
            href="/docs/guide"
            aria-current={
              activeSection === "guide" && !activeSlug ? "page" : undefined
            }
            className="text-primary hover:underline aria-[current=page]:font-semibold"
          >
            User guide
          </Link>
          <Link
            href="/docs/reference"
            aria-current={
              activeSection === "reference" && !activeSlug ? "page" : undefined
            }
            className="text-primary hover:underline aria-[current=page]:font-semibold"
          >
            Technical reference
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
            prose-h2:scroll-mt-20
          prose-table:block prose-table:overflow-x-auto
          [&_details]:my-6 [&_details]:rounded-md [&_details]:border
          [&_details]:border-border [&_details]:px-4 [&_details]:py-3
          [&_details[open]]:bg-secondary/20
          [&_summary]:cursor-pointer [&_summary]:font-medium
          [&_summary]:text-foreground [&_summary]:marker:text-muted-foreground
          [&_details>*:last-child]:mb-0"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </main>
  )
}
