import { DefineTermForm } from "./form"

export function AddTermPageContent({
  initialTerm = "",
  vocabularyTitle
}: {
  initialTerm?: string
  vocabularyTitle: string
}) {
  return (
    <main className="flex-1 px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <section className="max-w-xl space-y-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Add a new term
          </h1>
          <p className="leading-7 text-muted-foreground">
            Add a term and its first definition to the {vocabularyTitle}{" "}
            vocabulary. Write the definition or prompt a language model for an
            editable draft.
          </p>
        </section>
        <DefineTermForm initialTerm={initialTerm} />
      </div>
    </main>
  )
}
