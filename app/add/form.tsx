import { DefinitionForm } from "@/components/definition/definition-form"

export const DefineTermForm = ({
  initialTerm = ""
}: {
  initialTerm?: string
}) => <DefinitionForm initialTerm={initialTerm} />
