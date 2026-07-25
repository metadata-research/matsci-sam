import { listDocs, renderDoc } from "@/lib/docs"
import { SITE_NAME } from "@/lib/site"
import { DocsShell } from "../shell"
import { notFound } from "next/navigation"

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const doc = await renderDoc(slug)
  return { title: `${doc?.title ?? "Documentation"} | ${SITE_NAME}` }
}

export default async function DocPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const [doc, entries] = await Promise.all([renderDoc(slug), listDocs()])
  if (!doc) notFound()

  return <DocsShell entries={entries} html={doc.html} activeSlug={slug} />
}
