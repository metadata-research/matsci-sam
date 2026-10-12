import { notFound } from "next/navigation"
import { TRPCError } from "@trpc/server"
import type { Metadata } from "next"
import { TermMetadataPage } from "@/components/metadata/term-metadata-page"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { cache } from "react"

const loadRecord = cache(async (termId: string) => {
  const id = Number(termId)
  if (!Number.isSafeInteger(id) || id < 1) notFound()
  return trpc.termMetadata.get({ termId: id }).catch((error: unknown) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound()
    throw error
  })
})

export async function generateMetadata({
  params
}: {
  params: Promise<{ termId: string }>
}): Promise<Metadata> {
  const { termId } = await params
  const record = await loadRecord(termId)
  return {
    title: `Term metadata | ${SITE_NAME}`,
    robots: record.term.hiddenAt ? { index: false, follow: false } : undefined
  }
}

export default async function TermMetadataRoute({
  params
}: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await params
  const record = await loadRecord(termId)
  return <TermMetadataPage record={record} />
}
