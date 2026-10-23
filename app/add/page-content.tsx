import { DefineTermForm } from "./form"
import type { WorkReturnLink } from "@/lib/community-work-return"

export function AddTermPageContent({
  initialTerm = "",
  ownerId,
  draftId,
  setupReturnTo,
  draftReturn,
  vocabularySlug,
  vocabularyTitle
}: {
  initialTerm?: string
  ownerId: number
  draftId?: string
  setupReturnTo?: string
  draftReturn?: WorkReturnLink
  vocabularySlug?: string
  vocabularyTitle: string
}) {
  return (
    <main className="flex-1 px-4 py-5 sm:py-6">
      <div className="mx-auto flex max-w-[60rem] flex-col gap-4">
        <section className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Add a new term</h1>
          <p className="leading-7 text-muted-foreground">
            {draftId ? (
              "Continue your saved term, then review and publish."
            ) : (
              <>
                Confirm a term in {vocabularyTitle}, write its definition, then
                review and publish.
              </>
            )}
          </p>
        </section>
        <DefineTermForm
          initialTerm={initialTerm}
          ownerId={ownerId}
          draftId={draftId}
          setupReturnTo={setupReturnTo}
          draftReturn={draftReturn}
          vocabularySlug={vocabularySlug}
        />
      </div>
    </main>
  )
}
