import "server-only"

import { promises as fs } from "node:fs"
import path from "node:path"
import { marked } from "marked"

/*
 * The /docs section renders the markdown under docs/ in two layers, each its
 * own directory and its own group in the sidebar:
 *
 *   docs/guide/      the user guide, at /docs/<slug>: how to use the site
 *   docs/reference/  knowledge organization, at /docs/reference/<slug>: what
 *                    the vocabulary, the tags and the metadata mean, for a
 *                    curator or a metadata consumer
 *
 * docs/technical/ is the third layer and is deliberately not served: it
 * documents the code for someone changing it and is read in the repository.
 */

export type DocSection = "guide" | "reference"

type SectionConfig = {
  dir: string
  title: string
  // Sidebar order follows a reader's journey, not the alphabet. Pages not
  // listed sort after these, alphabetically, so adding a file never requires
  // touching this list.
  order: string[]
}

const SECTIONS: Record<DocSection, SectionConfig> = {
  guide: {
    dir: path.join(process.cwd(), "docs", "guide"),
    title: "User guide",
    order: [
      "account-access",
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

export const sectionTitle = (section: DocSection) => SECTIONS[section].title

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

// Both groups, for the sidebar.
export const listAllDocs = async () => ({
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
    html: marked.parse(content, { async: false }) as string
  }
}
