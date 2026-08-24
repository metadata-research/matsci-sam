import { DefineTermForm } from "./form"

export function AddTermPageContent({
  initialTerm = ""
}: {
  initialTerm?: string
}) {
  return (
    <main className="flex-1 px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <section className="max-w-xl space-y-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Add a new term
          </h1>
          <p className="leading-7 text-muted-foreground">
            Contribute a new materials science term and its first definition.
            You can write it yourself or ask AI for an editable suggestion.
            After publishing, examples can be added separately so a definition
            can collect more than one.
          </p>
        </section>
        <DefineTermForm initialTerm={initialTerm} />
      </div>
    </main>
  )
}
