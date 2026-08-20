import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SITE_NAME } from "@/lib/site"
import { listAllDocs, renderDoc } from "@/lib/docs"
import { DocsShell } from "./shell"

export const metadata: Metadata = { title: `Documentation | ${SITE_NAME}` }

// /docs is the quick start. Somebody arriving from the navigation bar wants
// the shortest complete account of the workflow, not a table of contents.
export default async function DocsPage() {
  const [doc, entries] = await Promise.all([
    renderDoc("quickstart", "index"),
    listAllDocs()
  ])
  if (!doc) notFound()

  return (
    <DocsShell entries={entries} html={doc.html} activeSection="quickstart" />
  )
}
