import type { MatCoreDraftPayload } from "@/lib/matcore-workflow-types"

/** Community and vocabulary slugs are distinct route identities. */
export function workspaceDestination(
  vocabulary: { slug: string; communityId: number | null },
  communities: ReadonlyArray<{ id: number; slug: string }>
) {
  const community = communities.find(
    (item) => item.id === vocabulary.communityId
  )
  return community
    ? `/communities/${community.slug}?view=work`
    : `/metadata/workspace?vocabularySlug=${encodeURIComponent(vocabulary.slug)}`
}

export const profileChoices = [
  { key: "minimal", label: "Common core (Minimal)" },
  { key: "dft", label: "Density functional theory (DFT)" },
  { key: "md", label: "Molecular dynamics (MD)" },
  { key: "mbpt", label: "Many-body perturbation theory (MBPT)" },
  { key: "ml", label: "Machine learning (ML)" },
  { key: "pf", label: "Phase field (PF)" },
  { key: "derived", label: "Derived properties" }
] as const

export function profileLabel(key: string | null) {
  if (!key) return "Community field"
  return profileChoices.find((profile) => profile.key === key)?.label ?? key
}

export const requirementLabels = {
  unspecified: "Not specified",
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
  conditional: "Conditional"
} as const

export const valueTypeLabels = {
  unspecified: "Not specified",
  text: "Text",
  number: "Number",
  integer: "Integer",
  boolean: "Boolean",
  object: "Structured object",
  list: "List",
  reference: "Reference"
} as const

export const repeatabilityLabels = {
  unspecified: "Not specified",
  yes: "Yes",
  no: "No"
} as const

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed. Please try again."
}

export type ProposalDifference = {
  label: string
  before: string
  after: string
}

/** Review meaning and rules together; blank and unspecified are not optional. */
export function proposalDifferences(
  proposal: MatCoreDraftPayload,
  baseline: MatCoreDraftPayload | null
): ProposalDifference[] {
  const fields: Array<[string, (payload: MatCoreDraftPayload) => string]> = [
    ["Label", (p) => p.label],
    ["Definition", (p) => p.definition],
    ["Example", (p) => p.example],
    ["Field path", (p) => p.specification.path],
    ["Value type", (p) => valueTypeLabels[p.specification.valueType]],
    ["Format", (p) => p.specification.format],
    ["Requirement", (p) => requirementLabels[p.specification.requirement]],
    ["Condition", (p) => p.specification.condition],
    ["Repeatable", (p) => repeatabilityLabels[p.specification.repeatability]],
    ["Units", (p) => p.specification.units],
    ["Allowed values", (p) => p.specification.allowedValues.join("\n")],
    ["Example values", (p) => p.specification.examples.join("\n")],
    ["Value guidance", (p) => p.specification.guidance],
    ["Rationale", (p) => p.rationale],
    [
      "Citations",
      (p) =>
        p.citations
          .map((source) => `${source.title}\n${source.url}\n${source.note}`)
          .join("\n\n")
    ]
  ]
  return fields.flatMap(([label, read]) => {
    const before = baseline ? read(baseline) : ""
    const after = read(proposal)
    return before === after ? [] : [{ label, before, after }]
  })
}

export function emptyFieldPayload(): MatCoreDraftPayload {
  return {
    label: "",
    definition: "",
    example: "",
    rationale: "",
    specification: {
      path: "new-field",
      valueType: "unspecified",
      format: "",
      requirement: "unspecified",
      condition: "",
      repeatability: "unspecified",
      units: "",
      allowedValues: [],
      examples: [],
      guidance: ""
    },
    citations: []
  }
}
