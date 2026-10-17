import "server-only"
import { TRPCError } from "@trpc/server"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import {
  aiContributionSuggestionsTable,
  coauthorsTable,
  db,
  termsTable
} from "@yamz/db"
import { activeCommunityFor } from "./community-queries"
import { DEFAULT_VOCABULARY_SLUG } from "./public-identifiers"
import {
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "./input-limits"
import { contributionFilePublicationsSchema } from "./contribution-file-types"
import { publishContributionFiles } from "./contribution-files"
import {
  referenceSelectionsSchema,
  attachRevisionReferences,
  bindModelReferenceLookups
} from "./term-references"
import {
  definitionSubmissionFingerprint,
  lockContributionSubmissions,
  reserveContributionSubmission
} from "./contribution-guard"
import { createDefinitionWithInitialRevision } from "./definition-revisions"
import { GetModelUser } from "./crud"
import {
  addImportedCollectionMember,
  requireImportCollection,
  requireSetupVocabularyForContribution,
  reservedTermSlugs
} from "./setup-service"
import { uniqueSlug } from "./slug"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const newTermInput = z.object({
  term: z.string().trim().min(1).max(TERM_MAX_LENGTH),
  definition: z.string().trim().min(1).max(DEFINITION_MAX_LENGTH),
  initialExample: z.string().trim().max(EXAMPLE_MAX_LENGTH).optional(),
  vocabularySlug: z.string().trim().min(1).max(200).optional(),
  expectedVocabularySlug: z.string().trim().min(1).max(200).optional(),
  collectionId: z.number().int().positive().optional(),
  aiSuggestionId: z.number().int().positive().optional(),
  references: referenceSelectionsSchema.optional(),
  attachments: contributionFilePublicationsSchema.optional()
})
export type NewTermPublicationInput = z.input<typeof newTermInput>

/** Canonical new-term write shared by the full editor, setup, and saved drafts. */
export async function publishNewTerm(
  tx: Transaction,
  raw: NewTermPublicationInput,
  authorId: number
) {
  const parsed = newTermInput.safeParse(raw)
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Complete the term and definition, and review its evidence before publishing.",
      cause: parsed.error
    })
  const input = parsed.data
  await lockContributionSubmissions(tx, authorId)
  const active = input.vocabularySlug
    ? null
    : await activeCommunityFor(tx, authorId)
  const vocabularySlug =
    input.vocabularySlug ?? active?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG
  if (
    input.expectedVocabularySlug &&
    input.expectedVocabularySlug !== vocabularySlug
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The contribution vocabulary changed. Confirm the term in the current vocabulary before publishing."
    })
  await requireSetupVocabularyForContribution(
    tx,
    vocabularySlug,
    authorId,
    true
  )
  const collection = await requireImportCollection(
    tx,
    input.collectionId,
    authorId,
    true
  )
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('matsci-sam:setup-import'), hashtext(${vocabularySlug}))`
  )
  const term = input.term.toLowerCase()
  const [existing] = await tx
    .select({ id: termsTable.id })
    .from(termsTable)
    .where(
      and(
        eq(termsTable.vocabularySlug, vocabularySlug),
        sql`lower(btrim(${termsTable.term})) = ${term}`
      )
    )
  if (existing)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "That term is already in this vocabulary. Open it to suggest an alternative or propose a replacement."
    })
  const suggestion = input.aiSuggestionId
    ? (
        await tx
          .select()
          .from(aiContributionSuggestionsTable)
          .where(
            and(
              eq(aiContributionSuggestionsTable.id, input.aiSuggestionId),
              eq(aiContributionSuggestionsTable.requestedById, authorId)
            )
          )
          .for("update")
      )[0]
    : null
  if (
    input.aiSuggestionId &&
    (!suggestion ||
      suggestion.status !== "generated" ||
      suggestion.intent !== "new_term")
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "This AI suggestion is no longer available for a new term."
    })
  if (
    suggestion &&
    (suggestion.termText.trim().toLowerCase() !== term ||
      suggestion.vocabularySlug !== vocabularySlug)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "That AI suggestion belongs to a different term or vocabulary."
    })
  // Model identity and attribution participate in this same transaction.
  const modelUser = suggestion ? await GetModelUser(suggestion.model, tx) : null
  await reserveContributionSubmission(tx, {
    userId: authorId,
    kind: "definition",
    fingerprint: await definitionSubmissionFingerprint(tx, {
      vocabularySlug,
      term,
      definition: input.definition,
      initialExample: input.initialExample,
      references: input.references,
      attachments: input.attachments,
      modelReferences: suggestion?.referenceInputs ?? []
    })
  })
  const reserved = await reservedTermSlugs(tx, vocabularySlug)
  const [created] = await tx
    .insert(termsTable)
    .values({ term, vocabularySlug, slug: uniqueSlug(term, reserved) })
    .returning()
  const { definition, revision } = await createDefinitionWithInitialRevision(
    tx,
    {
      termId: created.id,
      authorId,
      definition: input.definition,
      example: "",
      initialExample: input.initialExample,
      changeNote: suggestion
        ? "AI-assisted new-term contribution"
        : "Initial contribution",
      source: suggestion ? "ai_assisted" : "initial",
      model: suggestion?.model ?? null,
      inference: suggestion?.inference ?? null,
      prompt: suggestion?.promptText ?? null
    }
  )
  await attachRevisionReferences(tx, {
    selection: input.references,
    authorId,
    termId: created.id,
    revisionId: revision.id
  })
  await publishContributionFiles(tx, {
    attachments: input.attachments,
    modelSources: suggestion?.sourceInputs ?? [],
    authorId,
    termId: created.id,
    revisionId: revision.id
  })
  if (suggestion && modelUser) {
    await bindModelReferenceLookups(tx, {
      references: suggestion.referenceInputs ?? [],
      authorId,
      termId: created.id,
      revisionId: revision.id
    })
    await tx
      .insert(coauthorsTable)
      .values({ definitionId: definition.id, userId: modelUser.id })
    await tx
      .update(aiContributionSuggestionsTable)
      .set({
        status: "accepted",
        outputDefinitionId: definition.id,
        decidedAt: sql`now()`
      })
      .where(eq(aiContributionSuggestionsTable.id, suggestion.id))
  }
  if (collection)
    await addImportedCollectionMember(tx, collection.id, created.id, authorId)
  return { term: created, definition, walkthrough: null }
}
export type NewTermPublication = Awaited<ReturnType<typeof publishNewTerm>>
