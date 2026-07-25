import Link from "next/link"
import { BookOpenIcon } from "lucide-react"
import type { DocEntry } from "@/lib/docs"

// Layout shared by the docs home and individual documents: a quiet sidebar
// listing every page in docs/, and the rendered markdown as the body. The
// markdown is our own repo content, so raw rendering is safe.
export const DocsShell = ({
  entries,
  html,
  activeSlug
}: {
  entries: DocEntry[]
  html: string
  activeSlug?: string
}) => (
  <main className="px-4 py-8">
    <div className="max-w-5xl w-full mx-auto flex flex-col gap-8 md:flex-row">
      <aside className="hidden md:block w-56 shrink-0">
        <div className="sticky top-4 space-y-1">
          <Link
            href="/docs"
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
              activeSlug
                ? "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                : "bg-accent text-accent-foreground font-medium"
            }`}
          >
            <BookOpenIcon className="size-3.5" />
            Documentation
          </Link>
          {entries.map((entry) => (
            <Link
              key={entry.slug}
              href={`/docs/${entry.slug}`}
              className={`block rounded-md px-3 py-1.5 text-sm ${
                entry.slug === activeSlug
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {entry.title}
            </Link>
          ))}
          <div className="mt-3 border-t border-border pt-3">
            <Link
              href="/about"
              className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              About MatSci SAM
            </Link>
          </div>
        </div>
      </aside>
      <nav
        aria-label="Project information"
        className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-4 text-sm md:hidden"
      >
        <Link href="/about" className="text-primary hover:underline">
          About MatSci SAM
        </Link>
        <Link
          href="/docs/metadata-access"
          className="text-primary hover:underline"
        >
          Metadata access
        </Link>
      </nav>
      <article
        className="prose dark:prose-invert max-w-none flex-1 min-w-0
          prose-headings:font-serif prose-a:text-primary
          prose-code:before:content-none prose-code:after:content-none
        prose-table:block prose-table:overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  </main>
)
