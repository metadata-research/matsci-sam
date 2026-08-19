import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SITE_NAME } from "@/lib/site"
import { listAllDocs, renderDoc } from "@/lib/docs"
import { DocsShell } from "../shell"

export const metadata: Metadata = {
  title: `Knowledge organization | ${SITE_NAME}`
}

export default async function ReferenceIndexPage() {
  const [doc, entries] = await Promise.all([
    renderDoc("reference", "index"),
    listAllDocs()
  ])
  if (!doc) notFound()

  return (
    <DocsShell entries={entries} html={doc.html} activeSection="reference" />
  )
}
