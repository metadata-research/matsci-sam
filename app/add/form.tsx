import { DefinitionForm } from "@/components/definition/definition-form"

export const DefineTermForm = ({
  initialTerm = "",
  ownerId,
  vocabularySlug,
  draftId,
  setupReturnTo
}: {
  initialTerm?: string
  ownerId: number
  vocabularySlug?: string
  draftId?: string
  setupReturnTo?: string
}) => (
  <DefinitionForm
    initialTerm={initialTerm}
    ownerId={ownerId}
    vocabularySlug={vocabularySlug}
    draftId={draftId}
    setupReturnTo={setupReturnTo}
  />
)
