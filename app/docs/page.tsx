import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SITE_NAME } from "@/lib/site"
import { listAllDocs, renderDoc } from "@/lib/docs"
import { DocsShell } from "./shell"

export const metadata: Metadata = { title: `Documentation | ${SITE_NAME}` }

export default async function DocsPage() {
  const [doc, entries] = await Promise.all([
    renderDoc("guide", "index"),
    listAllDocs()
  ])
  if (!doc) notFound()

  return <DocsShell entries={entries} html={doc.html} activeSection="guide" />
}
