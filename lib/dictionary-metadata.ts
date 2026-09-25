import { matCoreProfiles, matCoreSourceSnapshot } from "./matcore"

/** Human-facing metadata on a dictionary entry, not values for a research run. */
export const metadataFieldKeys = [
  "alternateLabel",
  "usageNote",
  "usedAsValueFor",
  "describesMetadataField",
  "relatedConcept"
] as const

export type MetadataFieldKey = (typeof metadataFieldKeys)[number]
export type DictionaryMetadataField = {
  key: MetadataFieldKey
  label: string
  valueType: "text" | "iri"
  description: string
  advanced: boolean
  predicate: string
}

export const dictionaryMetadataFields: readonly DictionaryMetadataField[] = [
  {
    key: "usageNote",
    label: "Usage note",
    valueType: "text",
    description: "Explain when to use this term and any limits on its meaning.",
    advanced: false,
    predicate: "skos:scopeNote"
  },
  {
    key: "usedAsValueFor",
    label: "Used as a value for",
    valueType: "iri",
    description:
      "Identify a metadata field where this term can supply a value.",
    advanced: false,
    predicate: "matsci:usedAsValueFor"
  },
  {
    key: "describesMetadataField",
    label: "Describes a metadata field",
    valueType: "iri",
    description:
      "Link an entry explaining a field to that field's specification.",
    advanced: false,
    predicate: "matsci:describesMetadataField"
  },
  {
    key: "alternateLabel",
    label: "Alternative label",
    valueType: "text",
    description: "Add an abbreviation, synonym, or alternative name.",
    advanced: true,
    predicate: "skos:altLabel"
  },
  {
    key: "relatedConcept",
    label: "Related external concept",
    valueType: "iri",
    description:
      "Keep a relevant external concept as context. This relationship does not assert equivalence or ontology membership.",
    advanced: true,
    predicate: "matsci:relatedConcept"
  }
]

export const metadataFieldByKey = (key: string) =>
  dictionaryMetadataFields.find((field) => field.key === key)

/** The caller supplies the server's identifier base. Clients must use its output. */
export const metadataPredicateIri = (
  key: MetadataFieldKey,
  identifierBase: string
) => {
  const field = metadataFieldByKey(key)
  if (!field) throw new Error(`Unknown dictionary metadata field: ${key}`)
  const [prefix, local] = field.predicate.split(":")
  return prefix === "skos"
    ? `http://www.w3.org/2004/02/skos/core#${local}`
    : `${identifierBase.replace(/\/+$/, "")}/metadata#${local}`
}

export type MetadataCatalogField = {
  key: string
  iri: string
  label: string
  profileKey: string
  profileLabel: string
  sourceUrl: string
  sourceVersion: string
  status: "preliminary" | "proposed"
  description: string
  required: boolean | null
  valueGuidance: string | null
  path: string
}

export const experimentalMetadataFields = [
  {
    key: "processing-method",
    label: "Processing method",
    description:
      "The method used by a particular material processing activity, such as atomic layer deposition.",
    valueGuidance:
      "A method concept from a named vocabulary. More than one method may be described as separate activities."
  },
  {
    key: "deposition-temperature",
    label: "Deposition temperature",
    description:
      "The temperature associated with a specified deposition activity, with the measured or controlled location identified.",
    valueGuidance:
      "A numerical quantity with an explicit temperature unit and a statement of what the temperature refers to."
  }
] as const

/**
 * Frozen published source plus a separately identified local design example.
 * The experimental fields are not official ICoN-PCL or MatCore requirements.
 */
export const getMetadataCatalogFields = (
  identifierBase: string
): MetadataCatalogField[] => {
  const base = identifierBase.replace(/\/+$/, "")
  return [
    ...matCoreProfiles.flatMap((profile) =>
      profile.elements.map((element) => ({
        key: `matcore-2025:${element.key}`,
        iri: `${base}/metadata/matcore#${element.key}`,
        label: element.label,
        profileKey: `matcore-2025:${profile.key}`,
        profileLabel: `${profile.name} · 2025 preliminary snapshot`,
        sourceUrl: matCoreSourceSnapshot.sourceUrl,
        sourceVersion: matCoreSourceSnapshot.snapshotLabel,
        status: "preliminary" as const,
        description: element.description,
        required: element.required,
        valueGuidance: null,
        path: `/metadata/matcore#${element.key}`
      }))
    ),
    ...experimentalMetadataFields.map((field) => ({
      key: `experimental-v1:${field.key}`,
      iri: `${base}/metadata/experimental#${field.key}`,
      label: field.label,
      profileKey: "experimental-v1",
      profileLabel: "Experimental methods · local proposal",
      sourceUrl: `${base}/metadata/experimental`,
      sourceVersion: "proposal-1",
      status: "proposed" as const,
      description: field.description,
      required: null,
      valueGuidance: field.valueGuidance,
      path: `/metadata/experimental#${field.key}`
    }))
  ]
}

export const knownMetadataCatalogField = (
  iri: string,
  identifierBase: string
) => getMetadataCatalogFields(identifierBase).find((field) => field.iri === iri)
