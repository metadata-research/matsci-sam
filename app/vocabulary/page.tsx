import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { findVocabulary } from "./_data"
import { VocabularySchemePage } from "./_pages"

export const metadata: Metadata = {
  title: "Vocabulary | " + SITE_NAME,
  description:
    "The " +
    SITE_NAME +
    " concept scheme and catalog of community vocabularies."
}

export default async function VocabularyPage() {
  const vocabulary = await findVocabulary(DEFAULT_VOCABULARY_SLUG)
  if (!vocabulary) notFound()

  return <VocabularySchemePage vocabulary={vocabulary} />
}
