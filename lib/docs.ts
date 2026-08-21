import "server-only"

import { promises as fs } from "node:fs"
import path from "node:path"
import { marked } from "marked"

/*
 * The /docs section renders the markdown under docs/ in three layers, each its
 * own directory and its own group in the sidebar:
 *
 *   docs/quickstart/ one page at /docs, the landing page: the ordinary path
 *                    from a new term to its recorded history
 *   docs/guide/      the user guide, at /docs/<slug>: how to use the site
 *   docs/reference/  knowledge organization, at /docs/reference/<slug>: what
 *                    the vocabulary, the tags and the metadata mean, for a
 *                    curator or a metadata consumer
 *
 * Guide pages stay at /docs/<slug> with no prefix. Moving them under
 * /docs/guide/ would read more evenly but would break every published guide
 * address, so only the guide *index* moved, from /docs to /docs/guide.
 *
 * docs/technical/ is the fourth layer and is deliberately not served: it
 * documents the code for someone changing it and is read in the repository.
 */

export type DocSection = "quickstart" | "guide" | "reference"

type SectionConfig = {
  dir: string
  title: string
  // Sidebar order follows a reader's journey, not the alphabet. Pages not
  // listed sort after these, alphabetically, so adding a file never requires
  // touching this list.
  order: string[]
}

const SECTIONS: Record<DocSection, SectionConfig> = {
  quickstart: {
    dir: path.join(process.cwd(), "docs", "quickstart"),
    title: "Quick start",
    // A single page. Its sidebar entries are the headings within it, not
    // sibling files, which is what keeps the landing page one uninterrupted
    // read.
    order: []
  },
  guide: {
    dir: path.join(process.cwd(), "docs", "guide"),
    title: "User guide",
    order: [
      "account-access",
      "communities",
      "adding-terms",
      "community",
      "ai-refinement",
      "discussion",
      "search",
      "tags",
      "provenance",
      "metadata-access",
      "identifiers"
    ]
  },
  reference: {
    dir: path.join(process.cwd(), "docs", "reference"),
    title: "Knowledge organization",
    order: [
      "knowledge-organization",
      "skos-and-metadata",
      "matcore-and-the-vocabulary",
      "identifier-policy",
      "curation-and-ai",
      "provenance-model"
    ]
  }
}

export type DocEntry = { section: DocSection; slug: string; title: string }

const titleOf = (content: string, slug: string) =>
  content.match(/^#\s+(.+)$/m)?.[1] ?? slug

export const docPath = (section: DocSection, slug: string) =>
  section === "guide" ? `/docs/${slug}` : `/docs/${section}/${slug}`

// Where a group heading points. Quick start is the landing page, so it owns
// /docs itself.
export const sectionIndexPath = (section: DocSection) =>
  section === "quickstart" ? "/docs" : `/docs/${section}`

export const sectionTitle = (section: DocSection) => SECTIONS[section].title

// One line under each sidebar heading, so a reader can tell the three groups
// apart before opening any of them.
export const sectionBlurb: Record<DocSection, string> = {
  quickstart: "The whole workflow, start to finish",
  guide: "Every feature in detail",
  reference: "The model, SKOS, and identifiers"
}

const slugifyHeading = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

// Headings carry ids so the quick start can be linked section by section and
// the sidebar can list its steps.
const withHeadingIds = (html: string) =>
  html.replace(
    /<h([2-3])>(.*?)<\/h\1>/g,
    (_m, level: string, inner: string) =>
      `<h${level} id="${slugifyHeading(inner)}">${inner}</h${level}>`
  )

export type DocHeading = { id: string; text: string }

// The h2 headings of one page, for the sidebar entries of a single-page group.
export const docHeadings = async (
  section: DocSection,
  slug: string
): Promise<DocHeading[]> => {
  const content = await fs.readFile(
    path.join(SECTIONS[section].dir, `${slug}.md`),
    "utf8"
  )

  return [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => ({
    id: slugifyHeading(m[1]),
    text: m[1].trim()
  }))
}

export const listDocs = async (section: DocSection): Promise<DocEntry[]> => {
  const { dir, order } = SECTIONS[section]
  const files = (await fs.readdir(dir)).filter(
    (f) => f.endsWith(".md") && f !== "index.md"
  )

  const entries = await Promise.all(
    files.map(async (file) => {
      const slug = file.replace(/\.md$/, "")
      const content = await fs.readFile(path.join(dir, file), "utf8")
      return { section, slug, title: titleOf(content, slug) }
    })
  )

  const rank = (slug: string) => {
    const i = order.indexOf(slug)
    return i === -1 ? order.length : i
  }

  return entries.sort(
    (a, b) => rank(a.slug) - rank(b.slug) || a.title.localeCompare(b.title)
  )
}

// Every group, for the sidebar. Quick start is one page, so its entries are
// the steps inside it.
export const listAllDocs = async () => ({
  quickstart: await docHeadings("quickstart", "index"),
  guide: await listDocs("guide"),
  reference: await listDocs("reference")
})

// Slugs are only accepted if they name a real file in the listing, which
// rules out path traversal.
export const renderDoc = async (section: DocSection, slug: string) => {
  const valid =
    slug === "index" ||
    (await listDocs(section)).some((entry) => entry.slug === slug)
  if (!valid) return null

  const content = await fs.readFile(
    path.join(SECTIONS[section].dir, `${slug}.md`),
    "utf8"
  )

  return {
    title: titleOf(content, slug),
    html: withHeadingIds(marked.parse(content, { async: false }) as string)
  }
}
