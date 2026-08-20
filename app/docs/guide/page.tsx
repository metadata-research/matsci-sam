import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SITE_NAME } from "@/lib/site"
import { listAllDocs, renderDoc } from "@/lib/docs"
import { DocsShell } from "../shell"

export const metadata: Metadata = { title: `User guide | ${SITE_NAME}` }

// The guide index moved here when the quick start took /docs. Guide pages
// themselves stay at /docs/<slug>, so no published address changed. This
// static segment takes precedence over app/docs/[slug].
export default async function GuideIndexPage() {
  const [doc, entries] = await Promise.all([
    renderDoc("guide", "index"),
    listAllDocs()
  ])
  if (!doc) notFound()

  return <DocsShell entries={entries} html={doc.html} activeSection="guide" />
}
