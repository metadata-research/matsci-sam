import { z } from "zod"
import {
  metadataFieldKeys,
  metadataFieldByKey,
  knownMetadataCatalogField
} from "./dictionary-metadata"
import { isAbsoluteHttpIri } from "./kos"
import { identifierBaseUrl } from "./public-identifiers"

const optionalText = (limit: number) =>
  z
    .string()
    .trim()
    .max(limit)
    .nullish()
    .transform((value) => value || null)

export const termMetadataInputSchema = z
  .object({
    termId: z.number().int().positive(),
    definitionRevisionId: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((value) => value ?? null),
    fieldKey: z.enum(metadataFieldKeys),
    value: z.string().trim().min(1, "Enter a value.").max(4000),
    language: optionalText(64).transform(
      (value) => value?.toLowerCase() ?? null
    ),
    sourceIri: optionalText(2048),
    sourceLabel: optionalText(200),
    sourceVersion: optionalText(200)
  })
  .superRefine((input, ctx) => {
    const field = metadataFieldByKey(input.fieldKey)!
    if (field.valueType === "iri") {
      if (input.value.length > 2048 || !isAbsoluteHttpIri(input.value))
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Enter a complete http or https identifier."
        })
      if (input.language)
        ctx.addIssue({
          code: "custom",
          path: ["language"],
          message: "A language applies only to text values."
        })
      if (
        (input.fieldKey === "usedAsValueFor" ||
          input.fieldKey === "describesMetadataField") &&
        !knownMetadataCatalogField(input.value, identifierBaseUrl)
      )
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Choose a metadata field from the catalog."
        })
    }
    if (input.language && !/^[a-z]{2,8}(-[a-z0-9]{1,8})*$/.test(input.language))
      ctx.addIssue({
        code: "custom",
        path: ["language"],
        message: "Enter a language tag such as en or en-gb."
      })
    if (input.sourceIri && !isAbsoluteHttpIri(input.sourceIri))
      ctx.addIssue({
        code: "custom",
        path: ["sourceIri"],
        message: "Enter a complete http or https source identifier."
      })
    if (input.sourceVersion && !input.sourceIri && !input.sourceLabel)
      ctx.addIssue({
        code: "custom",
        path: ["sourceVersion"],
        message: "Name or link the source for this version."
      })
  })
  .transform((input) => ({
    ...input,
    valueType: metadataFieldByKey(input.fieldKey)!.valueType
  }))

export type TermMetadataInput = z.input<typeof termMetadataInputSchema>
export type ValidatedTermMetadataInput = z.output<
  typeof termMetadataInputSchema
>
