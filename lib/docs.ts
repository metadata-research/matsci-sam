import "server-only"

import { promises as fs } from "node:fs"
import path from "node:path"
import { marked } from "marked"

// The /docs section is the user guide: it renders the markdown in
// docs/guide/ and nothing else. Internal working documents (tracker,
// assessments, demo script) stay in docs/ one level up and are not served.

const GUIDE_DIR = path.join(process.cwd(), "docs", "guide")

// Sidebar order follows a reader's journey, not the alphabet. Pages not
// listed here sort after these, alphabetically, so adding a file never
// requires touching this list.
const PAGE_ORDER = [
  "adding-terms",
  "ai-refinement",
  "community",
  "search",
  "provenance",
  "metadata-access",
  "identifiers"
]

export type DocEntry = { slug: string; title: string }

const titleOf = (content: string, slug: string) =>
  content.match(/^#\s+(.+)$/m)?.[1] ?? slug

export const listDocs = async (): Promise<DocEntry[]> => {
  const files = (await fs.readdir(GUIDE_DIR)).filter(
    (f) => f.endsWith(".md") && f !== "index.md"
  )

  const entries = await Promise.all(
    files.map(async (file) => {
      const slug = file.replace(/\.md$/, "")
      const content = await fs.readFile(path.join(GUIDE_DIR, file), "utf8")
      return { slug, title: titleOf(content, slug) }
    })
  )

  const rank = (slug: string) => {
    const i = PAGE_ORDER.indexOf(slug)
    return i === -1 ? PAGE_ORDER.length : i
  }

  return entries.sort(
    (a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title)
  )
}

// Slugs are only accepted if they name a real file in the listing, which
// rules out path traversal.
export const renderDoc = async (slug: string) => {
  const valid =
    slug === "index" ||
    (await listDocs()).some((entry) => entry.slug === slug)
  if (!valid) return null

  const content = await fs.readFile(
    path.join(GUIDE_DIR, `${slug}.md`),
    "utf8"
  )

  return {
    title: titleOf(content, slug),
    html: marked.parse(content, { async: false }) as string
  }
}
