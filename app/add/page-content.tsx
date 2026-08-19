import { DefineTermForm } from "./form"

export function AddTermPageContent({
  interactive = false,
  initialTerm = ""
}: {
  interactive?: boolean
  initialTerm?: string
}) {
  return (
    <main className="flex-1 px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <section className="max-w-xl space-y-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Define a term
          </h1>
          <p className="leading-7 text-muted-foreground">
            Contribute a materials science term with a clear definition and
            example of use. Definitions are public and open to community voting,
            comments, and alternatives.
          </p>
        </section>
        <DefineTermForm interactive={interactive} initialTerm={initialTerm} />
      </div>
    </main>
  )
}
