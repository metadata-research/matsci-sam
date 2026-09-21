import type { Metadata } from "next"
import { OntologyContextWorkbench } from "./workbench"

export const metadata: Metadata = {
  title: "Ontology context preview | MatSci-SAM"
}

export default function OntologyContextPreviewPage() {
  return (
    <main className="px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Ontology context preview</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Find a term, then compare its immediate parents in different
            ontologies and vocabularies. The draft and selections on this test
            page are not saved.
          </p>
        </header>
        <OntologyContextWorkbench />
      </div>
    </main>
  )
}
