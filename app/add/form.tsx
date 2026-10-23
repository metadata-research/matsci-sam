import { DefinitionForm } from "@/components/definition/definition-form"
import type { WorkReturnLink } from "@/lib/community-work-return"

export const DefineTermForm = ({
  initialTerm = "",
  ownerId,
  vocabularySlug,
  draftId,
  setupReturnTo,
  draftReturn
}: {
  initialTerm?: string
  ownerId: number
  vocabularySlug?: string
  draftId?: string
  setupReturnTo?: string
  draftReturn?: WorkReturnLink
}) => (
  <DefinitionForm
    initialTerm={initialTerm}
    ownerId={ownerId}
    vocabularySlug={vocabularySlug}
    draftId={draftId}
    setupReturnTo={setupReturnTo}
    draftReturn={draftReturn}
  />
)
