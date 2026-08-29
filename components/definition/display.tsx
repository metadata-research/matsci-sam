import type { ReactNode } from "react"

import { Card } from "@/components/ui/card"

type DefinitionContentValue = {
  definition: string
  example?: string | null
}

// Shared by definition cards and focused references so the definition and its
// supporting example do not acquire slightly different labels or treatment.
export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
    {children}
  </div>
)

export const DefinitionContent = ({
  definition,
  children
}: {
  definition: DefinitionContentValue
  children?: ReactNode
}) => (
  <>
    {children}
    <div>
      <Eyebrow>Definition</Eyebrow>
      <p>{definition.definition}</p>
    </div>
    {definition.example?.trim() ? (
      <div>
        <Eyebrow>Featured example · supporting context</Eyebrow>
        <p className="text-muted-foreground">{definition.example}</p>
      </div>
    ) : null}
  </>
)

// A definition shown only as the source of another task. It deliberately
// excludes support, status, attribution, comments, links and action controls.
export const DefinitionReference = ({
  definition,
  label = "Candidate being revised"
}: {
  definition: DefinitionContentValue & {
    definitionNumber: number
    version: number
  }
  label?: string
}) => (
  <div className="space-y-2">
    <Eyebrow>{label}</Eyebrow>
    <Card className="p-4">
      <div className="space-y-3">
        <DefinitionContent definition={definition} />
        <p className="text-sm text-muted-foreground">
          Definition {definition.definitionNumber} · revision{" "}
          {definition.version}
        </p>
      </div>
    </Card>
  </div>
)
