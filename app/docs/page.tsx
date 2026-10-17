import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SITE_NAME } from "@/lib/site"
import { listAllDocs, renderDoc } from "@/lib/docs"
import { DocsShell } from "./shell"

export const metadata: Metadata = {
  title: `Quick Start · Help & Guides | ${SITE_NAME}`
}

// /docs matches the Quick start actions, with short instructions that can be
// linked directly from each task's help link.
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
