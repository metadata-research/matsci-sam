import { z } from "zod"
import {
  emptyMatcoreDraftPayload,
  matcoreDraftPayloadSchema,
  matcoreProfileSchema,
  type MatcoreSourceOccurrence
} from "./matcore-workflow-types"
import type {
  MatCoreProfileId,
  MatCoreStandardManifest
} from "./matcore-standard-types"

const text = z.string().max(100_000)
const identifier = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[a-zA-Z0-9_.:-]+$/)
const url = z
  .string()
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//.test(value))
const link = z.object({ label: text, url }).strict()
const source = z
  .object({
    profileId: matcoreProfileSchema,
    tableId: identifier,
    row: z.number().int().positive(),
    htmlRow: z.number().int().positive(),
    anchor: text,
    url,
    rawKeyColumns: z.tuple([text, text]),
    rawText: text,
    rawHtml: text,
    links: z.array(link).max(100)
  })
  .strict()
export const matcoreSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    standardKey: z.literal("matcore"),
    release: z
      .object({
        version: identifier,
        sourceUrl: url,
        retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        artifactPath: z.string().min(1).max(2000),
        attribution: text,
        license: z.string().max(2000).nullable(),
        parserVersion: z.string().min(1).max(500),
        identityPolicy: text
      })
      .strict(),
    profiles: z
      .array(
        z
          .object({
            id: matcoreProfileSchema,
            label: text,
            sourceAnchor: text,
            description: text,
            inherits: z.array(matcoreProfileSchema).max(7),
            inheritanceNote: text.nullable(),
            methodSelectionRequired: z.boolean(),
            examples: z
              .array(
                z.object({ text, sourceLinks: z.array(link).max(100) }).strict()
              )
              .max(100)
          })
          .strict()
      )
      .min(1)
      .max(7),
    fields: z
      .array(
        z
          .object({
            id: identifier,
            sourceKey: text,
            qualifiedLabel: text,
            definition: text,
            valuesGuidance: text,
            repeatable: z.boolean().nullable(),
            notes: z.array(text).max(100),
            source,
            additionalSources: z.array(source).max(100),
            interpretationWarnings: z.array(text).max(100)
          })
          .strict()
      )
      .min(1)
      .max(500),
    occurrences: z
      .array(
        z
          .object({
            id: identifier,
            fieldId: identifier,
            profileId: matcoreProfileSchema,
            path: z.array(z.string().min(1).max(500)).min(1).max(30),
            parentPath: z
              .array(z.string().min(1).max(500))
              .min(1)
              .max(30)
              .nullable(),
            required: z.boolean().nullable(),
            repeatable: z.boolean().nullable(),
            inherited: z.literal(false),
            sourceTableId: identifier
          })
          .strict()
      )
      .min(1)
      .max(500),
    tables: z
      .array(
        z
          .object({
            id: identifier,
            profileId: matcoreProfileSchema,
            anchor: text,
            caption: text,
            sourceRowCount: z.number().int().positive()
          })
          .strict()
      )
      .min(1)
      .max(100),
    warnings: z.array(text).max(1000)
  })
  .strict()

/** Validate protected installation input. No source corpus is bundled with code. */
export function parseMatcoreSourceManifest(
  input: unknown
): MatCoreStandardManifest {
  const manifest = matcoreSourceManifestSchema.parse(input)
  const unique = (values: string[], name: string) => {
    if (new Set(values).size !== values.length)
      throw new Error(`Duplicate MatCore ${name}`)
  }
  unique(
    manifest.profiles.map((row) => row.id),
    "profile"
  )
  unique(
    manifest.fields.map((row) => row.id),
    "field identity"
  )
  unique(
    manifest.occurrences.map((row) => row.id),
    "occurrence identity"
  )
  unique(
    manifest.tables.map((row) => row.id),
    "source table"
  )
  const profiles = new Map(manifest.profiles.map((row) => [row.id, row]))
  const fields = new Map(manifest.fields.map((row) => [row.id, row]))
  const tables = new Map(manifest.tables.map((row) => [row.id, row]))
  for (const profile of manifest.profiles) {
    if (profile.inherits.some((id) => !profiles.has(id)))
      throw new Error("Unknown inherited MatCore profile")
    getMatCoreStandardProfileClosure(manifest, profile.id)
  }
  for (const occurrence of manifest.occurrences) {
    const field = fields.get(occurrence.fieldId)
    if (
      !field ||
      !profiles.has(occurrence.profileId) ||
      tables.get(occurrence.sourceTableId)?.profileId !== occurrence.profileId
    )
      throw new Error("Unresolved MatCore source occurrence")
    if (!occurrence.id.startsWith(`matcore:${manifest.release.version}:`))
      throw new Error("Source occurrence belongs to a different release")
    if (field.source.profileId !== occurrence.profileId)
      throw new Error("Source field/profile mismatch")
    if (
      occurrence.parentPath &&
      !manifest.occurrences.some(
        (row) =>
          row.profileId === occurrence.profileId &&
          row.path.join(".") === occurrence.parentPath!.join(".")
      )
    )
      throw new Error("Unresolved MatCore parent path")
    if (
      (occurrence.parentPath?.join(".") ?? "") !==
      occurrence.path.slice(0, -1).join(".")
    )
      throw new Error("MatCore occurrence parent does not match its path")
  }
  for (const field of manifest.fields) {
    if (!manifest.occurrences.some((row) => row.fieldId === field.id))
      throw new Error("Unused MatCore source field")
    for (const location of [field.source, ...field.additionalSources]) {
      const table = tables.get(location.tableId)
      if (
        !table ||
        table.profileId !== location.profileId ||
        location.row > table.sourceRowCount
      )
        throw new Error("Invalid MatCore source location")
    }
  }
  // Applying UI payload limits here makes installation fail before partial data can persist.
  matcoreManifestRows(manifest)
  return manifest
}

export function matcoreManifestRelease(manifest: MatCoreStandardManifest) {
  const {
    version,
    sourceUrl,
    sha256,
    attribution,
    license,
    parserVersion,
    retrievedOn,
    artifactPath
  } = manifest.release
  return {
    version,
    sourceUrl,
    sha256,
    attribution,
    license,
    parserVersion,
    retrievedOn,
    artifactPath
  }
}

export function matcoreManifestRows(manifest: MatCoreStandardManifest) {
  const definitions = new Map(manifest.fields.map((field) => [field.id, field]))
  return manifest.occurrences
    .map((occurrence) => {
      const field = definitions.get(occurrence.fieldId)
      if (!field) throw new Error("MatCore manifest occurrence has no field")
      const payload = emptyMatcoreDraftPayload()
      payload.label = field.qualifiedLabel
      payload.definition = field.definition
      payload.specification.path = occurrence.path.join(".")
      payload.specification.guidance = field.valuesGuidance
      payload.specification.requirement =
        occurrence.required === null
          ? "unspecified"
          : occurrence.required
            ? occurrence.parentPath?.length
              ? "conditional"
              : "required"
            : "optional"
      if (occurrence.required && occurrence.parentPath?.length)
        payload.specification.condition = `Required when ${occurrence.parentPath.join(".")} is present.`
      payload.specification.repeatability =
        occurrence.repeatable === null
          ? "unspecified"
          : occurrence.repeatable
            ? "yes"
            : "no"
      const source: MatcoreSourceOccurrence = {
        sourceFieldId: field.id,
        sourceKey: field.sourceKey,
        profileKey: occurrence.profileId,
        path: occurrence.path,
        sourceUrl: field.source.url,
        sourceAnchor: field.source.anchor,
        rawText: field.source.rawText,
        warnings: [...field.interpretationWarnings, ...field.notes],
        sourceTableId: field.source.tableId,
        sourceRow: field.source.row
      }
      return {
        id: occurrence.id,
        releaseId: `matcore:${manifest.release.version}`,
        sourceFieldId: field.id,
        profileKey: occurrence.profileId,
        source,
        baseline: matcoreDraftPayloadSchema.parse(payload)
      }
    })
    .sort(
      (a, b) =>
        matcoreProfileSchema.options.indexOf(a.profileKey) -
        matcoreProfileSchema.options.indexOf(b.profileKey)
    )
}

export function getMatCoreStandardProfileClosure(
  manifest: MatCoreStandardManifest,
  profileId: MatCoreProfileId
) {
  const result: MatCoreProfileId[] = [],
    visiting = new Set<MatCoreProfileId>(),
    visited = new Set<MatCoreProfileId>()
  function visit(id: MatCoreProfileId) {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error("Cyclic MatCore profile inheritance")
    const profile = manifest.profiles.find((row) => row.id === id)
    if (!profile) throw new Error("Unknown MatCore profile")
    visiting.add(id)
    for (const parent of profile.inherits) visit(parent)
    visiting.delete(id)
    visited.add(id)
    result.push(id)
  }
  visit(profileId)
  return result
}
