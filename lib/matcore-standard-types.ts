/** The frozen source inventory is separate from editable local proposals. */
export type MatCoreProfileId =
  | "minimal"
  | "dft"
  | "md"
  | "mbpt"
  | "ml"
  | "pf"
  | "derived"

export interface MatCoreSourceLocation {
  profileId: MatCoreProfileId
  tableId: string
  /** One-based, definition-bearing row number; a headerless table is valid. */
  row: number
  /** One-based HTML tr position, including any header. */
  htmlRow: number
  anchor: string
  url: string
  rawKeyColumns: [string, string]
  rawText: string
  rawHtml: string
  links: { label: string; url: string }[]
}

export interface MatCoreStandardField {
  /** Local immutable identity, not an official MatCore identifier. */
  id: string
  sourceKey: string
  qualifiedLabel: string
  definition: string
  valuesGuidance: string
  /** Source statement only; effective profile rules belong to occurrences. */
  repeatable: boolean | null
  notes: string[]
  source: MatCoreSourceLocation
  additionalSources: MatCoreSourceLocation[]
  interpretationWarnings: string[]
}

export interface MatCoreStandardOccurrence {
  id: string
  fieldId: string
  profileId: MatCoreProfileId
  path: string[]
  parentPath: string[] | null
  /** Required within this parent context, not globally required in a dataset. */
  required: boolean | null
  repeatable: boolean | null
  inherited: false
  sourceTableId: string
}

export interface MatCoreStandardProfile {
  id: MatCoreProfileId
  label: string
  sourceAnchor: string
  description: string
  /** Direct dependencies; do not copy or flatten their occurrences. */
  inherits: MatCoreProfileId[]
  inheritanceNote: string | null
  /** Derived requires a selected method; this is not inheritance of all methods. */
  methodSelectionRequired: boolean
  examples: { text: string; sourceLinks: { label: string; url: string }[] }[]
}

export interface MatCoreStandardManifest {
  schemaVersion: 1
  standardKey: "matcore"
  release: {
    version: string
    sourceUrl: string
    retrievedOn: string
    sha256: string
    artifactPath: string
    attribution: string
    /** No license for the website's current standard text has been verified. */
    license: string | null
    parserVersion: string
    identityPolicy: string
  }
  profiles: MatCoreStandardProfile[]
  fields: MatCoreStandardField[]
  occurrences: MatCoreStandardOccurrence[]
  tables: {
    id: string
    profileId: MatCoreProfileId
    anchor: string
    caption: string
    sourceRowCount: number
  }[]
  warnings: string[]
}
