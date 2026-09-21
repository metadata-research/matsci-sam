import { DefineTermForm } from "./form"

export function AddTermPageContent({
  initialTerm = "",
  vocabularyTitle
}: {
  initialTerm?: string
  vocabularyTitle: string
}) {
  return (
    <main className="flex-1 px-4 py-5 sm:py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <section className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Add a new term</h1>
          <p className="leading-7 text-muted-foreground">
            Confirm a term in {vocabularyTitle}, write its definition, then
            review and publish.
          </p>
        </section>
        <DefineTermForm initialTerm={initialTerm} />
      </div>
    </main>
  )
}
