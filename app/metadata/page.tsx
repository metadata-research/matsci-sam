import { permanentRedirect } from "next/navigation"

export default function MetadataVocabularyPage() {
  // Fragment-bearing RDF terms such as /metadata#version dereference through
  // this base document. The guide defines the small application vocabulary.
  permanentRedirect("/docs/metadata-access#application-metadata-vocabulary")
}
