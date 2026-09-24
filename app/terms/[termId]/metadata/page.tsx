import { notFound } from "next/navigation"
import { TRPCError } from "@trpc/server"
import type { Metadata } from "next"
import { TermMetadataPage } from "@/components/metadata/term-metadata-page"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"

export const metadata: Metadata = { title: `Term metadata | ${SITE_NAME}` }

export default async function TermMetadataRoute({
  params
}: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await params
  const id = Number(termId)
  if (!Number.isSafeInteger(id) || id < 1) notFound()
  const record = await trpc.termMetadata
    .get({ termId: id })
    .catch((error: unknown) => {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound()
      throw error
    })
  return <TermMetadataPage record={record} />
}
