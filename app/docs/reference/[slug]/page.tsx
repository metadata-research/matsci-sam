import { notFound } from "next/navigation"
import { listAllDocs, renderDoc } from "@/lib/docs"
import { SITE_NAME } from "@/lib/site"
import { DocsShell } from "../../shell"

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const doc = await renderDoc("reference", slug)
  return { title: `${doc?.title ?? "Knowledge organization"} | ${SITE_NAME}` }
}

export default async function ReferenceDocPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const [doc, entries] = await Promise.all([
    renderDoc("reference", slug),
    listAllDocs()
  ])
  if (!doc) notFound()

  return (
    <DocsShell
      entries={entries}
      html={doc.html}
      activeSection="reference"
      activeSlug={slug}
    />
  )
}
