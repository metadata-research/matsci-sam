import { notFound } from "next/navigation"
import { TermProvenancePage } from "@/components/provenance/page"

export default async function PublicTermProvenancePage({
  params
}: {
  params: Promise<{ termId: string }>
}) {
  const { termId } = await params
  const id = Number(termId)
  if (!Number.isSafeInteger(id) || id < 1) notFound()
  return <TermProvenancePage termId={id} />
}
