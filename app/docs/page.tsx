import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Documentation | ${SITE_NAME}` }
import { listDocs, renderDoc } from "@/lib/docs"
import { DocsShell } from "./shell"
import { notFound } from "next/navigation"

export default async function DocsPage() {
  const [doc, entries] = await Promise.all([renderDoc("index"), listDocs()])
  if (!doc) notFound()

  return <DocsShell entries={entries} html={doc.html} />
}
