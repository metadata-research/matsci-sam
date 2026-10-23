import { createHash } from "node:crypto"
import type {
  MatCoreStandardManifest,
  MatCoreProfileId
} from "../../lib/matcore-standard-types"

/** Entirely invented material. Never load the protected MatCore corpus in tests. */
export const MATCORE_FIXTURE_ARTIFACT =
  "Synthetic MatCore workflow fixture. No standard definitions are included.\n"
export const MATCORE_FIXTURE_VERSION = "ci-fixture-v1"
export const MATCORE_FIXTURE_RELEASE_ID = `matcore:${MATCORE_FIXTURE_VERSION}`
const profiles: MatCoreProfileId[] = [
  "minimal",
  "dft",
  "md",
  "mbpt",
  "ml",
  "pf",
  "derived"
]
const sourceUrl = "https://example.invalid/synthetic-metadata"
export const MATCORE_STANDARD_MANIFEST: MatCoreStandardManifest = {
  schemaVersion: 1,
  standardKey: "matcore",
  release: {
    version: MATCORE_FIXTURE_VERSION,
    sourceUrl,
    retrievedOn: "2026-10-23",
    sha256: createHash("sha256").update(MATCORE_FIXTURE_ARTIFACT).digest("hex"),
    artifactPath: "synthetic-fixture.txt",
    attribution: "Synthetic test fixture authors",
    license: "CC0-1.0",
    parserVersion: "synthetic-fixture-v1",
    identityPolicy: "Synthetic immutable identities for isolated tests only."
  },
  profiles: profiles.map((id) => ({
    id,
    label: id.toUpperCase(),
    sourceAnchor: id,
    description: `Invented ${id} profile used only to test metadata workflows.`,
    inherits:
      id === "minimal" ? [] : id === "mbpt" ? ["minimal", "dft"] : ["minimal"],
    inheritanceNote:
      id === "minimal" ? null : "Synthetic dependency on the base profile.",
    methodSelectionRequired: id === "derived",
    examples: [{ text: `Synthetic ${id} example.`, sourceLinks: [] }]
  })),
  fields: [],
  occurrences: [],
  tables: [],
  warnings: []
}
for (const profileId of profiles) {
  const count = profileId === "dft" ? 44 : profileId === "minimal" ? 4 : 1
  const tableId = `Fixture-${profileId}`
  MATCORE_STANDARD_MANIFEST.tables.push({
    id: tableId,
    profileId,
    anchor: profileId,
    caption: `Invented ${profileId} fields`,
    sourceRowCount: count
  })
  for (let index = 0; index < count; index++) {
    const key =
      profileId === "minimal" && index === 0
        ? "creation-date"
        : profileId === "minimal" && index === 1
          ? "specimen"
          : profileId === "minimal" && index === 2
            ? "specimen.label"
            : `synthetic-${String(index).padStart(3, "0")}`
    const id = `fixture-field:${profileId}:${index}`
    const definition = `Invented field ${index + 1} in the ${profileId} test profile; this wording is not from any metadata standard.`
    const valuesGuidance = `Synthetic value guidance ${profileId}-${index + 1}.`
    MATCORE_STANDARD_MANIFEST.fields.push({
      id,
      sourceKey: key,
      qualifiedLabel: `Synthetic ${profileId} / ${key}`,
      definition,
      valuesGuidance,
      repeatable: false,
      notes: [],
      additionalSources: [],
      interpretationWarnings: [],
      source: {
        profileId,
        tableId,
        row: index + 1,
        htmlRow: index + 2,
        anchor: profileId,
        url: `${sourceUrl}#${profileId}`,
        rawKeyColumns: [key, ""],
        rawText: `Definition: ${definition} Values: ${valuesGuidance} Repeatable: False`,
        rawHtml: `<tr><td>${key}</td><td></td><td>${definition}</td></tr>`,
        links: []
      }
    })
    MATCORE_STANDARD_MANIFEST.occurrences.push({
      id: `${MATCORE_FIXTURE_RELEASE_ID}:${profileId}:${key}`,
      fieldId: id,
      profileId,
      path: key.split("."),
      parentPath: key.includes(".") ? key.split(".").slice(0, -1) : null,
      required: index === 0 || key === "specimen.label",
      repeatable: false,
      inherited: false,
      sourceTableId: tableId
    })
  }
}
