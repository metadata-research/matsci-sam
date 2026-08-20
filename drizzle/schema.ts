import type { Diff } from "diff-match-patch-ts"
import { relations, sql } from "drizzle-orm"
import {
  integer,
  varchar,
  pgTable,
  boolean,
  text,
  timestamp,
  pgEnum,
  primaryKey,
  real,
  index,
  uniqueIndex,
  foreignKey,
  check,
  type AnyPgColumn,
  jsonb,
  numeric,
  unique,
  uuid
} from "drizzle-orm/pg-core"

export const userRoleEnum = pgEnum("user_role", ["user", "moderator", "admin"])
export const feedbackStatusEnum = pgEnum("feedback_status", [
  "open",
  "resolved"
])

// --- USERS ---
export type User = typeof usersTable.$inferSelect
export const usersTable = pgTable(
  "users",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    googleId: varchar().unique(undefined, { nulls: "distinct" }),
    // Populated only by the verified ORCID OAuth/linking flow. Never accept an
    // ORCID iD from a profile form.
    orcidId: varchar({ length: 19 }).unique(undefined, { nulls: "distinct" }),
    name: varchar({ length: 255 }),
    firstName: varchar({ length: 100 }),
    lastName: varchar({ length: 100 }),
    affiliation: varchar({ length: 255 }),
    email: varchar({ length: 254 }),
    // Google identities are verified by Google. Passwordless email identities
    // set this timestamp only after a one-time link has been claimed.
    emailVerifiedAt: timestamp({ mode: "string" }),
    isAi: boolean().notNull().default(false),
    // Explicit consent for the public contributor page. Attribution remains
    // visible when this is false, but names render as plain text.
    isProfilePublic: boolean().notNull().default(false),
    role: userRoleEnum().notNull().default("user"),
    // Reputation multiplier, stored per user; not yet applied to vote tallies
    weight: real().notNull().default(1),
    createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
    notifications: boolean().default(false)
  },
  (table) => [
    // Authentication treats email case-insensitively. AI identities do not
    // authenticate and are excluded from this human-account constraint.
    uniqueIndex("users_human_email_normalized_unique")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} IS NOT NULL AND NOT ${table.isAi}`)
  ]
)

// --- AI MODELS ---
// A model that contributes is a user, so every author, co-author, vote and
// provenance path already works for it. What a model additionally has —
// vendor, family, the exact tag it runs under — has no place on a person, so
// it extends the user row rather than widening it. One row per model version:
// two versions of one family produce different text and are different agents.
export type AiModel = typeof aiModelsTable.$inferSelect
export const aiModelsTable = pgTable(
  "aiModels",
  {
    // The user this describes. Also the primary key: a user is at most one
    // model, and a model is exactly one user.
    userId: integer()
      .references(() => usersTable.id)
      .primaryKey(),
    // Public identifier: /models/<slug>. Immutable once published.
    slug: text().notNull().unique(),
    // The exact string the runtime was asked for, e.g. "gemma4:26b" or
    // "claude-opus-5". This is what makes a generation reproducible and what
    // the revision rows record, so it is the identity, not the display name.
    tag: text().notNull().unique(),
    vendor: text().notNull(),
    family: text(),
    parameterSize: text(),
    // Null while the model is in use; set when it is retired from service, so
    // its past contributions keep resolving.
    retiredAt: timestamp({ mode: "string", withTimezone: true }),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull()
  },
  (t) => [
    check("ai_models_slug_shape", sql`${t.slug} ~ '^[a-z0-9][a-z0-9_-]*$'`),
    check(
      "ai_models_nonblank",
      sql`btrim(${t.tag}) <> '' AND btrim(${t.vendor}) <> ''
          AND (${t.family} IS NULL OR btrim(${t.family}) <> '')
          AND (${t.parameterSize} IS NULL OR btrim(${t.parameterSize}) <> '')`
    )
  ]
)

export const aiModelsTableRelations = relations(aiModelsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [aiModelsTable.userId],
    references: [usersTable.id]
  })
}))

// --- EXTERNAL AUTHENTICATION ---
export const oauthAccountsTable = pgTable(
  "oauthAccounts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .references(() => usersTable.id, { onDelete: "cascade" })
      .notNull(),
    provider: varchar({ length: 32 }).notNull(),
    subject: varchar({ length: 255 }).notNull(),
    // Provider tokens are encrypted before storage. They are never selected by
    // profile/public queries or returned to a browser.
    accessTokenEncrypted: text(),
    refreshTokenEncrypted: text(),
    scope: text(),
    expiresAt: timestamp({ mode: "string" }),
    createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp({ mode: "string" }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("oauth_accounts_provider_subject_unique").on(
      table.provider,
      table.subject
    ),
    uniqueIndex("oauth_accounts_user_provider_unique").on(
      table.userId,
      table.provider
    ),
    index("oauth_accounts_user_idx").on(table.userId)
  ]
)

export const emailAuthTokensTable = pgTable(
  "emailAuthTokens",
  {
    // Only the SHA-256 digest is stored. The raw token exists only in the
    // message delivered to the requested mailbox.
    tokenHash: varchar({ length: 64 }).primaryKey(),
    email: varchar({ length: 254 }).notNull(),
    // A token requested through the explicit registration page may create a
    // human account. Ordinary sign-in tokens may only claim an existing one.
    allowAccountCreation: boolean().notNull().default(false),
    expiresAt: timestamp({ mode: "string" }).notNull(),
    usedAt: timestamp({ mode: "string" }),
    createdAt: timestamp({ mode: "string" }).defaultNow().notNull()
  },
  (table) => [
    index("email_auth_tokens_email_created_idx").on(
      table.email,
      table.createdAt
    ),
    index("email_auth_tokens_expires_idx").on(table.expiresAt)
  ]
)

export const usersTableRelations = relations(usersTable, ({ many }) => ({
  definitions: many(definitionsTable),
  comments: many(commentsTable),
  votes: many(votesTable),
  oauthAccounts: many(oauthAccountsTable),
  siteFeedback: many(siteFeedbackTable, {
    relationName: "siteFeedbackAuthor"
  }),
  resolvedSiteFeedback: many(siteFeedbackTable, {
    relationName: "siteFeedbackResolver"
  })
}))

export const oauthAccountsTableRelations = relations(
  oauthAccountsTable,
  ({ one }) => ({
    user: one(usersTable, {
      fields: [oauthAccountsTable.userId],
      references: [usersTable.id]
    })
  })
)

// --- SITE FEEDBACK ---
// Lightweight, private feedback about the interface. Identity is taken from
// the server session; a null userId means the submission was anonymous.
export type SiteFeedback = typeof siteFeedbackTable.$inferSelect
export const siteFeedbackTable = pgTable(
  "siteFeedback",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer().references(() => usersTable.id, {
      onDelete: "set null"
    }),
    // Store only the root-relative pathname. Query strings and fragments can
    // contain credentials or other sensitive values and are deliberately
    // excluded by both application validation and the database check below.
    pagePath: varchar({ length: 512 }).notNull(),
    message: text().notNull(),
    status: feedbackStatusEnum().notNull().default("open"),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    resolvedAt: timestamp({ mode: "string", withTimezone: true }),
    resolvedByUserId: integer().references(() => usersTable.id, {
      onDelete: "set null"
    })
  },
  (table) => [
    // Equality on status followed by the identity cursor supports the
    // newest-first administrative inbox without an unbounded OFFSET.
    index("site_feedback_status_id_idx").on(table.status, table.id),
    index("site_feedback_user_idx").on(table.userId),
    index("site_feedback_resolved_by_user_idx").on(table.resolvedByUserId),
    check(
      "site_feedback_page_path_shape",
      sql`char_length(${table.pagePath}) > 0
          AND left(${table.pagePath}, 1) = '/'
          AND left(${table.pagePath}, 2) <> '//'
          AND position(chr(92) in ${table.pagePath}) = 0
          AND position('?' in ${table.pagePath}) = 0
          AND position('#' in ${table.pagePath}) = 0
          AND ${table.pagePath} !~ '[[:cntrl:]]'`
    ),
    check(
      "site_feedback_message_content",
      sql`btrim(${table.message}) <> ''
          AND char_length(${table.message}) <= 2000`
    ),
    // Reopening clears resolution metadata. resolvedByUserId may later become
    // null if an administrator account is deleted, while resolvedAt preserves
    // the durable lifecycle event.
    check(
      "site_feedback_resolution_shape",
      sql`(${table.status} = 'open'
            AND ${table.resolvedAt} IS NULL
            AND ${table.resolvedByUserId} IS NULL)
          OR (${table.status} = 'resolved'
            AND ${table.resolvedAt} IS NOT NULL)`
    )
  ]
)

export const siteFeedbackTableRelations = relations(
  siteFeedbackTable,
  ({ one }) => ({
    author: one(usersTable, {
      fields: [siteFeedbackTable.userId],
      references: [usersTable.id],
      relationName: "siteFeedbackAuthor"
    }),
    resolver: one(usersTable, {
      fields: [siteFeedbackTable.resolvedByUserId],
      references: [usersTable.id],
      relationName: "siteFeedbackResolver"
    })
  })
)

// --- TERMS ---
export type Term = typeof termsTable.$inferSelect
export const termsTable = pgTable(
  "terms",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // authorId: integer().references(() => usersTable.id),
    createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
    term: text().notNull().unique(),
    // Human-readable public identifier: /vocabulary/<slug> is the resolvable
    // concept IRI. Generated by lib/slug.ts at insert; treat as immutable once
    // set, since published IRIs depend on it.
    slug: text().notNull().unique(),
    // The next permanent definition number to allocate for this term. Keeping
    // the counter on the term lets one atomic UPDATE serialize concurrent
    // contributions without deriving identity from mutable ranking or row ids.
    nextDefinitionNumber: integer().notNull().default(1)
  },
  (table) => [
    check(
      "terms_next_definition_number_positive",
      sql`${table.nextDefinitionNumber} > 0`
    )
  ]
)

export const termsTableRelations = relations(termsTable, ({ many }) => ({
  definitions: many(definitionsTable),
  chats: many(chatsTable)
}))

// --- DEFINITIONS ---
export const definitionSourceEnum = pgEnum("definition_source", [
  "classic",
  "interactive"
])

export type Definition = typeof definitionsTable.$inferSelect
export type DefinitionWithAuthor = Definition & { author: User }
export const definitionsTable = pgTable(
  "definitions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    termId: integer()
      .references(() => termsTable.id)
      .notNull(),
    // Permanent, one-based identity within the term. Public definition IRIs
    // use the term slug plus this number. Never derive or renumber it from
    // score/rank.
    definitionNumber: integer().notNull(),
    authorId: integer().references(() => usersTable.id),
    definition: text().notNull(),
    example: text().notNull(),
    // LLM that generated this definition; null for human-authored definitions
    model: text(),
    // System prompt the LLM ran with; null for human-authored definitions
    // (or AI definitions that predate prompt tracking)
    prompt: text(),
    // The original definition this one was refined from (accepted AI
    // suggestion); null for originals
    refinedFromId: integer().references((): AnyPgColumn => definitionsTable.id),
    // Which add flow created this definition; interactive definitions get the
    // refine panel and skip the automatic term-level AI definition
    createdVia: definitionSourceEnum().notNull().default("classic"),
    // Stable definitions keep their public id/URL while this pointer selects
    // the immutable revision currently shown, searched, ranked, and voted on.
    // It stays nullable at the database level because creating a definition and
    // its first revision is a two-insert transaction; committed application
    // rows must always have it set.
    currentRevisionId: integer().references(
      (): AnyPgColumn => definitionRevisionsTable.id
    ),
    score: integer().notNull().default(0),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp({ mode: "string" }).$onUpdateFn(() => sql`now()`)
  },
  (table) => [
    // Profile and administrative views filter all definitions by author,
    // including refined versions outside the partial uniqueness index below.
    index("definitions_author_idx").on(table.authorId),
    // One *original* definition per author per term; refined versions
    // (refinedFromId set) are exempt so an accepted suggestion can coexist
    // with the author's original
    uniqueIndex("definitions_author_term_original_unique")
      .on(table.authorId, table.termId)
      .where(sql`${table.refinedFromId} IS NULL`),
    index("definitions_current_revision_idx").on(table.currentRevisionId),
    uniqueIndex("definitions_term_number_unique").on(
      table.termId,
      table.definitionNumber
    ),
    check(
      "definitions_definition_number_positive",
      sql`${table.definitionNumber} > 0`
    )
  ]
)

export const definitionsTableRelations = relations(
  definitionsTable,
  ({ one, many }) => ({
    term: one(termsTable, {
      fields: [definitionsTable.termId],
      references: [termsTable.id]
    }),
    author: one(usersTable, {
      fields: [definitionsTable.authorId],
      references: [usersTable.id]
    }),
    refinedFrom: one(definitionsTable, {
      fields: [definitionsTable.refinedFromId],
      references: [definitionsTable.id],
      relationName: "refinedVersions"
    }),
    refinedVersions: many(definitionsTable, {
      relationName: "refinedVersions"
    }),
    coauthors: many(coauthorsTable),
    refinements: many(refinementsTable),
    revisions: many(definitionRevisionsTable, {
      relationName: "definitionRevisionHistory"
    }),
    currentRevision: one(definitionRevisionsTable, {
      fields: [definitionsTable.currentRevisionId],
      references: [definitionRevisionsTable.id],
      relationName: "currentDefinitionRevision"
    }),
    edits: many(editsTable),
    comments: many(commentsTable),
    votes: many(votesTable),
    tags: many(tagsToDefinitions)
  })
)

// --- DEFINITION COAUTHORS ---
// Additional authors beyond definitions.authorId (the primary author) —
// GitHub-style co-attribution. Used when a user accepts an AI suggestion:
// the model's AI user is added here so both appear as authors, and the
// provenance graph derives wasAttributedTo edges for each.
export const coauthorsTable = pgTable(
  "definitionCoauthors",
  {
    definitionId: integer()
      .references(() => definitionsTable.id)
      .notNull(),
    userId: integer()
      .references(() => usersTable.id)
      .notNull()
  },
  (table) => [primaryKey({ columns: [table.definitionId, table.userId] })]
)

export const coauthorsTableRelations = relations(coauthorsTable, ({ one }) => ({
  definition: one(definitionsTable, {
    fields: [coauthorsTable.definitionId],
    references: [definitionsTable.id]
  }),
  user: one(usersTable, {
    fields: [coauthorsTable.userId],
    references: [usersTable.id]
  })
}))

// --- DEFINITION REFINEMENTS ---
// One row per interactive refinement round (= one card in the UI). Kept out
// of chatsTable deliberately: reviseDefinition() replays that whole thread as
// LLM context for the term-level AI definition, so refine turns must not mix
// into it. Provenance is derived from these rows, so they carry the same
// generation stamp as AI chat rows plus decision timestamps.
export const refinementStatusEnum = pgEnum("refinement_status", [
  "pending", // requested, generation not finished
  "suggested", // suggestion ready, awaiting the author's decision
  "accepted", // author accepted; refined definition created/updated
  "kept", // author kept their original
  "superseded", // replaced by a later round (re-evaluation)
  "failed" // generation errored; errorMessage set
])

export type Refinement = typeof refinementsTable.$inferSelect
export const refinementsTable = pgTable(
  "definitionRefinements",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    definitionId: integer()
      .references(() => definitionsTable.id)
      .notNull(),
    // Exact immutable definition content shown to the model when this round
    // began. This prevents later author edits from changing the recorded input.
    sourceRevisionId: integer().notNull(),
    round: integer().notNull(),
    // The author feedback that prompted this round; null on round 1
    userComment: text(),
    suggestedDefinition: text(),
    suggestedExample: text(),
    // Generation provenance, same shape as chats: set once the LLM has run
    promptKey: text(),
    promptHash: text(),
    promptText: text(),
    model: text(),
    status: refinementStatusEnum().notNull().default("pending"),
    errorMessage: text(),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    // When the suggestion (or failure) landed — the generation activity's end
    // time in the provenance timeline
    suggestedAt: timestamp({ mode: "string", withTimezone: true }),
    // When the author accepted/kept, or the round was superseded
    decidedAt: timestamp({ mode: "string", withTimezone: true })
  },
  (table) => [
    uniqueIndex("definition_refinements_definition_round_unique").on(
      table.definitionId,
      table.round
    ),
    index("definition_refinements_source_revision_idx").on(
      table.sourceRevisionId
    ),
    foreignKey({
      columns: [table.sourceRevisionId, table.definitionId],
      foreignColumns: [
        definitionRevisionsTable.id,
        definitionRevisionsTable.definitionId
      ],
      name: "definition_refinements_source_same_definition_fk"
    })
  ]
)

export const refinementsTableRelations = relations(
  refinementsTable,
  ({ one }) => ({
    definition: one(definitionsTable, {
      fields: [refinementsTable.definitionId],
      references: [definitionsTable.id]
    }),
    sourceRevision: one(definitionRevisionsTable, {
      fields: [refinementsTable.sourceRevisionId],
      references: [definitionRevisionsTable.id]
    })
  })
)

// --- IMMUTABLE DEFINITION REVISIONS ---
export const definitionRevisionSourceEnum = pgEnum(
  "definition_revision_source",
  [
    "initial",
    "author_edit",
    "ai_refinement",
    "ai_generation",
    "rollback",
    "legacy"
  ]
)

export type DefinitionRevision = typeof definitionRevisionsTable.$inferSelect
export const definitionRevisionsTable = pgTable(
  "definitionRevisions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    definitionId: integer()
      .references(() => definitionsTable.id)
      .notNull(),
    version: integer().notNull(),
    previousRevisionId: integer(),
    definitionDiff: jsonb().notNull().$type<Diff[]>(),
    // Historical definitionEdits never stored the prior example, editor, or
    // change note. Those fields may be null only on rows explicitly marked as
    // incomplete legacy imports; every newly published revision supplies them.
    exampleDiff: jsonb().$type<Diff[]>(),
    editorId: integer().references(() => usersTable.id),
    changeNote: text(),
    legacyIncomplete: boolean().notNull().default(false),
    source: definitionRevisionSourceEnum().notNull(),
    model: text(),
    prompt: text(),
    // Exact non-chronological source when this content restores or derives
    // from another revision. previousRevisionId remains the linear history
    // predecessor; this link records semantic derivation across that history
    // or across stable definitions.
    derivedFromRevisionId: integer(),
    sourceRefinementId: integer().references(
      (): AnyPgColumn => refinementsTable.id
    ),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    // Metadata related to revision diffs
    charsAdded: integer().notNull().default(0),
    charsRemoved: integer().notNull().default(0),
    changeDelta: numeric({ precision: 4, scale: 3 }).notNull()
  },
  (table) => [
    uniqueIndex("definition_revisions_definition_version_unique").on(
      table.definitionId,
      table.version
    ),
    // Composite FKs use this pair to prove that a revision-scoped activity or
    // predecessor and its stable definition id name the same contribution.
    uniqueIndex("definition_revisions_id_definition_unique").on(
      table.id,
      table.definitionId
    ),
    uniqueIndex("definition_revisions_previous_unique")
      .on(table.previousRevisionId)
      .where(sql`${table.previousRevisionId} IS NOT NULL`),
    uniqueIndex("definition_revisions_source_refinement_unique")
      .on(table.sourceRefinementId)
      .where(sql`${table.sourceRefinementId} IS NOT NULL`),
    index("definition_revisions_editor_idx").on(table.editorId),
    index("definition_revisions_derived_from_idx").on(
      table.derivedFromRevisionId
    ),
    check("definition_revisions_version_positive", sql`${table.version} > 0`),
    check(
      "definition_revisions_predecessor_shape",
      sql`(${table.version} = 1 AND ${table.previousRevisionId} IS NULL)
          OR (${table.version} > 1 AND ${table.previousRevisionId} IS NOT NULL)`
    ),
    check(
      "definition_revisions_nonblank_definition",
      sql`jsonb_typeof(${table.definitionDiff}) = 'array'
          AND jsonb_array_length(${table.definitionDiff}) > 0`
    ),
    check(
      "definition_revisions_complete_or_legacy",
      sql`${table.legacyIncomplete}
          OR (${table.exampleDiff} IS NOT NULL
              AND ${table.editorId} IS NOT NULL
              AND ${table.changeNote} IS NOT NULL)`
    ),
    check(
      "definition_revisions_nonblank_optional_text",
      sql`(${table.exampleDiff} IS NULL
          OR (jsonb_typeof(${table.exampleDiff}) = 'array'
              AND jsonb_array_length(${table.exampleDiff}) > 0))
          AND (${table.changeNote} IS NULL OR btrim(${table.changeNote}) <> '')`
    ),
    foreignKey({
      columns: [table.previousRevisionId, table.definitionId],
      foreignColumns: [table.id, table.definitionId],
      name: "definition_revisions_previous_same_definition_fk"
    }),
    foreignKey({
      columns: [table.derivedFromRevisionId],
      foreignColumns: [table.id],
      name: "definition_revisions_derived_from_fk"
    })
  ]
)

export const definitionRevisionsTableRelations = relations(
  definitionRevisionsTable,
  ({ one, many }) => ({
    definitionRecord: one(definitionsTable, {
      fields: [definitionRevisionsTable.definitionId],
      references: [definitionsTable.id],
      relationName: "definitionRevisionHistory"
    }),
    currentForDefinition: one(definitionsTable, {
      fields: [definitionRevisionsTable.id],
      references: [definitionsTable.currentRevisionId],
      relationName: "currentDefinitionRevision"
    }),
    previousRevision: one(definitionRevisionsTable, {
      fields: [definitionRevisionsTable.previousRevisionId],
      references: [definitionRevisionsTable.id],
      relationName: "definitionRevisionChain"
    }),
    nextRevision: one(definitionRevisionsTable, {
      fields: [definitionRevisionsTable.id],
      references: [definitionRevisionsTable.previousRevisionId],
      relationName: "definitionRevisionChain"
    }),
    derivedFromRevision: one(definitionRevisionsTable, {
      fields: [definitionRevisionsTable.derivedFromRevisionId],
      references: [definitionRevisionsTable.id],
      relationName: "definitionRevisionDerivation"
    }),
    derivedRevisions: many(definitionRevisionsTable, {
      relationName: "definitionRevisionDerivation"
    }),
    editor: one(usersTable, {
      fields: [definitionRevisionsTable.editorId],
      references: [usersTable.id]
    }),
    sourceRefinement: one(refinementsTable, {
      fields: [definitionRevisionsTable.sourceRefinementId],
      references: [refinementsTable.id]
    }),
    comments: many(commentsTable),
    votes: many(votesTable)
  })
)

// --- DISCUSSION SUGGESTIONS ---
// A Discussion suggestion is generated before the user decides whether to
// publish it. Persisting the exact source revision and model output prevents a
// client from altering text while retaining false AI attribution.
export const discussionSuggestionsTable = pgTable(
  "discussionSuggestions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    definitionId: integer()
      .references(() => definitionsTable.id)
      .notNull(),
    revisionId: integer().notNull(),
    userId: integer()
      .references(() => usersTable.id)
      .notNull(),
    comment: text().notNull(),
    suggestedDefinition: text().notNull(),
    suggestedExample: text().notNull(),
    model: text().notNull(),
    prompt: text().notNull(),
    outputDefinitionId: integer().references(() => definitionsTable.id),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    acceptedAt: timestamp({ mode: "string", withTimezone: true })
  },
  (table) => [
    index("discussion_suggestions_source_idx").on(
      table.definitionId,
      table.createdAt
    ),
    index("discussion_suggestions_user_idx").on(table.userId, table.createdAt),
    uniqueIndex("discussion_suggestions_output_unique")
      .on(table.outputDefinitionId)
      .where(sql`${table.outputDefinitionId} IS NOT NULL`),
    foreignKey({
      columns: [table.revisionId, table.definitionId],
      foreignColumns: [
        definitionRevisionsTable.id,
        definitionRevisionsTable.definitionId
      ],
      name: "discussion_suggestions_revision_same_definition_fk"
    }),
    check(
      "discussion_suggestions_acceptance_pair",
      sql`(${table.acceptedAt} IS NULL AND ${table.outputDefinitionId} IS NULL)
          OR (${table.acceptedAt} IS NOT NULL AND ${table.outputDefinitionId} IS NOT NULL)`
    ),
    check(
      "discussion_suggestions_nonblank_content",
      sql`btrim(${table.comment}) <> ''
          AND btrim(${table.suggestedDefinition}) <> ''
          AND btrim(${table.suggestedExample}) <> ''
          AND btrim(${table.model}) <> ''
          AND btrim(${table.prompt}) <> ''`
    )
  ]
)

// --- DEFINITION EDITS ---
// Legacy expand/rollback compatibility only. New edits append a complete row to
// definitionRevisions and advance definitions.currentRevisionId.
export const editsTable = pgTable("definitionEdits", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  definitionId: integer()
    .references(() => definitionsTable.id)
    .notNull(),
  newDefinition: text(),
  definition: text().notNull(), // what the definition used to be
  editedAt: timestamp().defaultNow().notNull()
})

export const editsTableRelations = relations(editsTable, ({ one }) => ({
  definition: one(definitionsTable, {
    fields: [editsTable.definitionId],
    references: [definitionsTable.id]
  })
}))

// --- VOTES ---
export const voteTypeEnum = pgEnum("vote_type", ["up", "down"])

export type Vote = typeof votesTable.$inferSelect
export const votesTable = pgTable(
  "votes",
  {
    revisionId: integer().notNull(),
    definitionId: integer()
      .references(() => definitionsTable.id)
      .notNull(),
    userId: integer()
      .references(() => usersTable.id)
      .notNull(),
    kind: voteTypeEnum().notNull(),
    // Votes cast before 2026-07-19 carry a placeholder equal to their
    // definition's createdAt (the real time was never recorded)
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    // Existing votes are attached to the revision current at migration time
    // because their historical timestamps may be placeholders.
    migratedLegacy: boolean().notNull().default(false)
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.userId] }),
    index("votes_definition_revision_idx").on(
      table.definitionId,
      table.revisionId
    ),
    index("votes_user_idx").on(table.userId),
    foreignKey({
      columns: [table.revisionId, table.definitionId],
      foreignColumns: [
        definitionRevisionsTable.id,
        definitionRevisionsTable.definitionId
      ],
      name: "votes_revision_same_definition_fk"
    })
  ]
)

export const votesTableRelations = relations(votesTable, ({ one }) => ({
  author: one(usersTable, {
    fields: [votesTable.userId],
    references: [usersTable.id]
  }),
  term: one(definitionsTable, {
    fields: [votesTable.definitionId],
    references: [definitionsTable.id]
  }),
  revision: one(definitionRevisionsTable, {
    fields: [votesTable.revisionId],
    references: [definitionRevisionsTable.id]
  })
}))

// --- COMMENTS ---
export type Comment = typeof commentsTable.$inferSelect
export const commentsTable = pgTable(
  "comments",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    definitionId: integer()
      .references(() => definitionsTable.id)
      .notNull(),
    revisionId: integer().notNull(),
    userId: integer()
      .references(() => usersTable.id)
      .notNull(),
    message: text().notNull(),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    // Backfilled comments use the revision visible at their recorded time. This
    // flag lets provenance disclose that the association was inferred.
    migratedLegacy: boolean().notNull().default(false)
  },
  (table) => [
    index("comments_definition_created_idx").on(
      table.definitionId,
      table.createdAt,
      table.id
    ),
    index("comments_revision_idx").on(table.revisionId),
    index("comments_user_idx").on(table.userId),
    foreignKey({
      columns: [table.revisionId, table.definitionId],
      foreignColumns: [
        definitionRevisionsTable.id,
        definitionRevisionsTable.definitionId
      ],
      name: "comments_revision_same_definition_fk"
    })
  ]
)

export const commentsTableRelations = relations(commentsTable, ({ one }) => ({
  author: one(usersTable, {
    fields: [commentsTable.userId],
    references: [usersTable.id]
  }),
  term: one(definitionsTable, {
    fields: [commentsTable.definitionId],
    references: [definitionsTable.id]
  }),
  revision: one(definitionRevisionsTable, {
    fields: [commentsTable.revisionId],
    references: [definitionRevisionsTable.id]
  })
}))

// --- KNOWLEDGE ORGANIZATION ---
// Tags, facets, named sets, term relations and external mappings are all rows
// in one typed statement ledger. A row is one asserted (subject, predicate,
// object) with who/when/retracted; while active it is one RDF triple, and the
// row is the reifier that carries the assertion's provenance. Predicates are a
// closed set of SKOS and Dublin Core terms; lib/kos.ts is the registry that
// gives each its IRI, allowed subject/object kinds and inverse or symmetry.

export const statementPredicateEnum = pgEnum("statement_predicate", [
  "dcterms:subject", // term | definition -> concept
  "skos:broader", // term -> term | concept -> concept (same scheme)
  "skos:related", // term -> term | concept -> concept; symmetric, stored once
  "skos:member", // collection -> term
  "skos:exactMatch", // term | concept -> external IRI
  "skos:closeMatch",
  "skos:broadMatch",
  "skos:narrowMatch",
  "skos:relatedMatch"
])

/*
 * Scheme and collection policy. Each grouping states its own rules instead of
 * deriving five behaviours from one boolean, so a new scheme is a row rather
 * than a code change.
 */
export const attachesAtEnum = pgEnum("scheme_attaches_at", [
  "term",
  "definition"
])

export const assertableByEnum = pgEnum("assertable_by", [
  "curator",
  "contributor"
])

export const conceptOrderEnum = pgEnum("concept_order", ["seeded", "label"])

export const conceptStatusEnum = pgEnum("concept_status", [
  "approved",
  "retired",
  "proposed" // reserved for community proposals; unused in this work
])

export type ConceptScheme = typeof conceptSchemesTable.$inferSelect
export const conceptSchemesTable = pgTable(
  "conceptSchemes",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // Public identifier: /tags/<slug>. Immutable once published.
    slug: text().notNull().unique(),
    title: text().notNull(), // dcterms:title
    description: text(), // dcterms:description
    // What a concept in this scheme classifies. A facet scheme attaches to the
    // term concept; an open scheme attaches to one definition of it.
    attachesAt: attachesAtEnum().notNull().default("definition"),
    // Who may assert a concept from this scheme. Checked in tRPC.
    assertableBy: assertableByEnum().notNull().default("contributor"),
    // Whether a concept here may be declared the same concept as a term.
    // A classifier is not the thing it classifies, so facet schemes say false.
    bridgeable: boolean().notNull().default(true),
    // How concepts are listed: the order a curator seeded, or alphabetical.
    conceptOrder: conceptOrderEnum().notNull().default("label"),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull()
  },
  (t) => [
    // Not all digits, so /tags/<digits> stays the legacy numeric redirect.
    check(
      "concept_schemes_slug_shape",
      sql`${t.slug} ~ '^[a-z0-9][a-z0-9_-]*$' AND ${t.slug} !~ '^[0-9]+$'`
    ),
    check("concept_schemes_title_nonblank", sql`btrim(${t.title}) <> ''`)
  ]
)

export type Concept = typeof conceptsTable.$inferSelect
export const conceptsTable = pgTable(
  "concepts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    schemeId: integer()
      .references(() => conceptSchemesTable.id)
      .notNull(),
    // Public identifier: /tags/<scheme>/<slug>. lib/slug.ts uniqueSlug of the
    // label at creation; unique per scheme; immutable. A merged concept keeps
    // its row, is retired, and points at its replacement so the IRI resolves.
    slug: text().notNull(),
    prefLabel: text().notNull(), // skos:prefLabel
    altLabels: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`), // skos:altLabel
    definition: text(), // skos:definition
    // skos:scopeNote: what gets filed under this concept, which is not the
    // same question as what the concept means. A concept bridged to a term
    // takes its meaning from that term's definitions and still says here how
    // it is meant to be used in classification.
    scopeNote: text(),
    status: conceptStatusEnum().notNull().default("approved"),
    replacedById: integer().references((): AnyPgColumn => conceptsTable.id),
    // tags.id at migration time so /tags/<id> keeps redirecting. No FK: the
    // tags table is dropped in 0030.
    legacyTagId: integer(),
    // null only for seeded (PSPP) and migrated rows
    createdById: integer().references(() => usersTable.id),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull()
  },
  (t) => [
    unique("concepts_scheme_slug_unique").on(t.schemeId, t.slug),
    // Normalized label uniqueness per scheme among live concepts: "Steel" and
    // "steel " are one tag. Partial, so a merged (retired) duplicate can keep
    // its row and its /tags/<id> redirect.
    uniqueIndex("concepts_scheme_label_unique")
      .on(t.schemeId, sql`lower(btrim(${t.prefLabel}))`)
      .where(sql`${t.status} <> 'retired'`),
    uniqueIndex("concepts_legacy_tag_unique")
      .on(t.legacyTagId)
      .where(sql`${t.legacyTagId} IS NOT NULL`),
    check("concepts_slug_shape", sql`${t.slug} ~ '^[a-z0-9][a-z0-9_-]*$'`),
    check("concepts_label_nonblank", sql`btrim(${t.prefLabel}) <> ''`),
    check(
      "concepts_replaced_only_when_retired",
      sql`${t.replacedById} IS NULL OR ${t.status} = 'retired'`
    ),
    check(
      "concepts_not_self_replaced",
      sql`${t.replacedById} IS NULL OR ${t.replacedById} <> ${t.id}`
    )
  ]
)

export type Collection = typeof collectionsTable.$inferSelect
export const collectionsTable = pgTable(
  "collections",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // Public identifier: /collections/<slug>. Immutable.
    slug: text().notNull().unique(),
    title: text().notNull(), // skos:prefLabel / dcterms:title
    description: text(),
    // Who may change membership. Declared here so the rule is settled before a
    // write path exists; no procedure reads it yet, because collections have
    // no mutations. The invariant keeps the column consistent meanwhile.
    assertableBy: assertableByEnum().notNull().default("curator"),
    createdById: integer()
      .references(() => usersTable.id)
      .notNull(),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull()
  },
  (t) => [
    check("collections_slug_shape", sql`${t.slug} ~ '^[a-z0-9][a-z0-9_-]*$'`),
    check("collections_title_nonblank", sql`btrim(${t.title}) <> ''`)
  ]
)

export type Statement = typeof statementsTable.$inferSelect
export const statementsTable = pgTable(
  "statements",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // Opaque public token for the reifier IRI (<subjectIri>#statement-<key>).
    // Never expose id.
    key: uuid().notNull().defaultRandom().unique(),
    predicate: statementPredicateEnum().notNull(),
    // subject: exactly one
    subjectTermId: integer().references(() => termsTable.id),
    subjectDefinitionId: integer().references(() => definitionsTable.id),
    subjectConceptId: integer().references(() => conceptsTable.id),
    subjectCollectionId: integer().references(() => collectionsTable.id),
    // object: exactly one
    objectTermId: integer().references(() => termsTable.id),
    objectConceptId: integer().references(() => conceptsTable.id),
    objectIri: text(),
    // provenance of the assertion
    assertedById: integer().references(() => usersTable.id), // null only when migratedLegacy
    migratedLegacy: boolean().notNull().default(false), // carried over from tagsToTerms/tags
    note: text(), // curator note, e.g. mapping justification
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    retractedAt: timestamp({ mode: "string", withTimezone: true }),
    retractedById: integer().references(() => usersTable.id)
  },
  (t) => [
    check(
      "statements_one_subject",
      sql`num_nonnulls(${t.subjectTermId}, ${t.subjectDefinitionId}, ${t.subjectConceptId}, ${t.subjectCollectionId}) = 1`
    ),
    check(
      "statements_one_object",
      sql`num_nonnulls(${t.objectTermId}, ${t.objectConceptId}, ${t.objectIri}) = 1`
    ),
    // Domain and range per predicate. Mirrored in lib/kos.ts; test-kos-db.ts
    // proves the two agree.
    check(
      "statements_predicate_shape",
      sql`CASE ${t.predicate}
      WHEN 'dcterms:subject' THEN (${t.subjectTermId} IS NOT NULL OR ${t.subjectDefinitionId} IS NOT NULL) AND ${t.objectConceptId} IS NOT NULL
      WHEN 'skos:member'     THEN ${t.subjectCollectionId} IS NOT NULL AND ${t.objectTermId} IS NOT NULL
      WHEN 'skos:broader'    THEN (${t.subjectTermId} IS NOT NULL AND ${t.objectTermId} IS NOT NULL) OR (${t.subjectConceptId} IS NOT NULL AND ${t.objectConceptId} IS NOT NULL)
      WHEN 'skos:related'    THEN (${t.subjectTermId} IS NOT NULL AND ${t.objectTermId} IS NOT NULL) OR (${t.subjectConceptId} IS NOT NULL AND ${t.objectConceptId} IS NOT NULL)
      WHEN 'skos:exactMatch' THEN ((${t.subjectTermId} IS NOT NULL OR ${t.subjectConceptId} IS NOT NULL) AND ${t.objectIri} IS NOT NULL) OR (${t.subjectConceptId} IS NOT NULL AND ${t.objectTermId} IS NOT NULL)
      ELSE (${t.subjectTermId} IS NOT NULL OR ${t.subjectConceptId} IS NOT NULL) AND ${t.objectIri} IS NOT NULL
    END`
    ),
    // Turtle interpolates IRIs raw: only absolute http(s) IRIs with no
    // whitespace, no C0/DEL control character, and none of the IRIREF
    // delimiters < > " { } | ^ ` \ get in. Verified 2026-08-18 on PG 17.11:
    // this template reaches SQL as '^https?://[^[:space:][:cntrl:]<>"{}|^`\\]+$'
    // and rejects backslash, chr(1), chr(127), ^, `, space; accepts EMMO,
    // PMDco, QUDT and non-ASCII IRIs. (An earlier draft's `\\^` was an
    // escaped caret in ARE syntax and let a backslash through.)
    check(
      "statements_object_iri_absolute",
      sql`${t.objectIri} IS NULL OR ${t.objectIri} ~ '^https?://[^[:space:][:cntrl:]<>"{}|^\`\\\\]+$'`
    ),
    check(
      "statements_no_self_relation",
      sql`(${t.subjectTermId} IS NULL OR ${t.objectTermId} IS NULL OR ${t.subjectTermId} <> ${t.objectTermId})
       AND (${t.subjectConceptId} IS NULL OR ${t.objectConceptId} IS NULL OR ${t.subjectConceptId} <> ${t.objectConceptId})`
    ),
    // Symmetric predicate stored once, smaller id first, so the active-unique
    // index also catches the mirror image.
    check(
      "statements_symmetric_canonical",
      sql`${t.predicate} <> 'skos:related' OR coalesce(${t.subjectTermId}, ${t.subjectConceptId}) < coalesce(${t.objectTermId}, ${t.objectConceptId})`
    ),
    check(
      "statements_asserter_or_legacy",
      sql`${t.assertedById} IS NOT NULL OR ${t.migratedLegacy}`
    ),
    check(
      "statements_retraction_pair",
      sql`(${t.retractedAt} IS NULL) = (${t.retractedById} IS NULL)`
    ),
    // One active row per triple. Active-only uniqueness must be a partial
    // index (WHERE retractedAt IS NULL) and partial indexes cannot use NULLS
    // NOT DISTINCT, hence coalesce().
    uniqueIndex("statements_active_unique")
      .on(
        t.predicate,
        sql`coalesce(${t.subjectTermId}, 0)`,
        sql`coalesce(${t.subjectDefinitionId}, 0)`,
        sql`coalesce(${t.subjectConceptId}, 0)`,
        sql`coalesce(${t.subjectCollectionId}, 0)`,
        sql`coalesce(${t.objectTermId}, 0)`,
        sql`coalesce(${t.objectConceptId}, 0)`,
        sql`coalesce(${t.objectIri}, '')`
      )
      .where(sql`${t.retractedAt} IS NULL`),
    // skos:exactMatch is symmetric and transitive, so two concepts naming one
    // term would name each other and belong merged. One link each way.
    uniqueIndex("statements_concept_link_unique")
      .on(t.subjectConceptId)
      .where(
        sql`${t.retractedAt} IS NULL AND ${t.predicate} = 'skos:exactMatch' AND ${t.objectTermId} IS NOT NULL`
      ),
    uniqueIndex("statements_term_link_unique")
      .on(t.objectTermId)
      .where(
        sql`${t.retractedAt} IS NULL AND ${t.predicate} = 'skos:exactMatch' AND ${t.objectTermId} IS NOT NULL`
      ),
    index("statements_subject_term_idx").on(t.subjectTermId),
    index("statements_subject_definition_idx").on(t.subjectDefinitionId),
    index("statements_subject_concept_idx").on(t.subjectConceptId),
    index("statements_subject_collection_idx").on(t.subjectCollectionId),
    index("statements_object_term_idx").on(t.objectTermId),
    index("statements_object_concept_idx").on(t.objectConceptId)
  ]
)

export const conceptSchemesTableRelations = relations(
  conceptSchemesTable,
  ({ many }) => ({
    concepts: many(conceptsTable)
  })
)

export const conceptsTableRelations = relations(conceptsTable, ({ one }) => ({
  scheme: one(conceptSchemesTable, {
    fields: [conceptsTable.schemeId],
    references: [conceptSchemesTable.id]
  }),
  replacedBy: one(conceptsTable, {
    fields: [conceptsTable.replacedById],
    references: [conceptsTable.id]
  })
}))

export const collectionsTableRelations = relations(
  collectionsTable,
  ({ one }) => ({
    createdBy: one(usersTable, {
      fields: [collectionsTable.createdById],
      references: [usersTable.id]
    })
  })
)

// --- TAG PROPOSALS ---
// A proposed tag, stored before anyone acts on it. A person writes the
// proposal; the model reviews it and records a verdict with its reasons and
// the exact prompt that produced them; a curator decides. The three are
// separate columns rather than one status, because a curator may decide
// without a review and a review may sit undecided, and because the agreement
// between the model verdict and the curator decision is the measurement the
// delegation setting is turned on by.
//
// Same shape as discussionSuggestions: the model's output is persisted before
// the decision, so a browser cannot fabricate an attribution.

export const tagReviewVerdictEnum = pgEnum("tag_review_verdict", [
  "approve",
  "merge",
  "decline"
])

export const tagDecisionEnum = pgEnum("tag_decision", [
  "approved",
  "merged",
  "declined"
])

export type TagSuggestion = typeof tagSuggestionsTable.$inferSelect
export const tagSuggestionsTable = pgTable(
  "tagSuggestions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // The proposal, complete at insert.
    proposedById: integer()
      .references(() => usersTable.id)
      .notNull(),
    schemeId: integer()
      .references(() => conceptSchemesTable.id)
      .notNull(),
    label: text().notNull(),
    scopeNote: text(),
    // What the proposer wants filed under it. Mirrors the statements subject
    // columns, so an approved proposal becomes a dcterms:subject row without
    // reinterpretation.
    targetTermId: integer().references(() => termsTable.id),
    targetDefinitionId: integer().references(() => definitionsTable.id),
    // The model's review. All null until it runs; a failure records
    // reviewError and no verdict.
    reviewVerdict: tagReviewVerdictEnum(),
    reviewReasons: text(),
    reviewMergeConceptId: integer().references(() => conceptsTable.id),
    promptKey: text(),
    promptHash: text(),
    promptText: text(),
    model: text(),
    reviewedAt: timestamp({ mode: "string", withTimezone: true }),
    reviewError: text(),
    // The decision. decidedById is the curator, or the AI identity when the
    // approval was delegated.
    decision: tagDecisionEnum(),
    decisionNote: text(),
    decidedById: integer().references(() => usersTable.id),
    decidedAt: timestamp({ mode: "string", withTimezone: true }),
    outcomeConceptId: integer().references(() => conceptsTable.id),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull()
  },
  (t) => [
    index("tag_suggestions_proposer_idx").on(t.proposedById, t.createdAt),
    // The curator queue.
    index("tag_suggestions_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.decidedAt} IS NULL`),
    index("tag_suggestions_target_term_idx").on(t.targetTermId),
    index("tag_suggestions_target_definition_idx").on(t.targetDefinitionId),
    // A newly minted concept is the outcome of one proposal. A merge outcome
    // is shared, so the uniqueness is partial.
    uniqueIndex("tag_suggestions_outcome_unique")
      .on(t.outcomeConceptId)
      .where(sql`${t.decision} = 'approved'`),
    check(
      "tag_suggestions_one_target",
      sql`num_nonnulls(${t.targetTermId}, ${t.targetDefinitionId}) = 1`
    ),
    check(
      "tag_suggestions_nonblank_content",
      sql`btrim(${t.label}) <> ''
          AND (${t.scopeNote} IS NULL OR btrim(${t.scopeNote}) <> '')`
    ),
    check(
      "tag_suggestions_nonblank_optional_text",
      sql`(${t.reviewReasons} IS NULL OR btrim(${t.reviewReasons}) <> '')
          AND (${t.decisionNote} IS NULL OR btrim(${t.decisionNote}) <> '')
          AND (${t.reviewError} IS NULL OR btrim(${t.reviewError}) <> '')`
    ),
    // A verdict and the stamp that produced it arrive together, or not at all.
    check(
      "tag_suggestions_review_pair",
      sql`(${t.reviewedAt} IS NULL
           AND ${t.reviewVerdict} IS NULL
           AND ${t.model} IS NULL
           AND ${t.promptHash} IS NULL
           AND ${t.promptText} IS NULL)
          OR (${t.reviewedAt} IS NOT NULL
              AND ${t.model} IS NOT NULL AND btrim(${t.model}) <> ''
              AND ${t.promptHash} IS NOT NULL
              AND ${t.promptText} IS NOT NULL
              AND (${t.reviewVerdict} IS NOT NULL) <> (${t.reviewError} IS NOT NULL))`
    ),
    check(
      "tag_suggestions_merge_target",
      sql`${t.reviewMergeConceptId} IS NULL OR ${t.reviewVerdict} = 'merge'`
    ),
    check(
      "tag_suggestions_decision_pair",
      sql`num_nonnulls(${t.decision}, ${t.decidedById}, ${t.decidedAt}) IN (0, 3)`
    ),
    check(
      "tag_suggestions_outcome_pair",
      sql`(${t.decision} IS NULL AND ${t.outcomeConceptId} IS NULL)
          OR (${t.decision} = 'declined' AND ${t.outcomeConceptId} IS NULL)
          OR (${t.decision} IN ('approved', 'merged')
              AND ${t.outcomeConceptId} IS NOT NULL)`
    )
  ]
)

export const tagSuggestionsTableRelations = relations(
  tagSuggestionsTable,
  ({ one }) => ({
    proposer: one(usersTable, {
      fields: [tagSuggestionsTable.proposedById],
      references: [usersTable.id],
      relationName: "tagSuggestionProposer"
    }),
    scheme: one(conceptSchemesTable, {
      fields: [tagSuggestionsTable.schemeId],
      references: [conceptSchemesTable.id]
    }),
    targetTerm: one(termsTable, {
      fields: [tagSuggestionsTable.targetTermId],
      references: [termsTable.id]
    }),
    targetDefinition: one(definitionsTable, {
      fields: [tagSuggestionsTable.targetDefinitionId],
      references: [definitionsTable.id]
    }),
    reviewMergeConcept: one(conceptsTable, {
      fields: [tagSuggestionsTable.reviewMergeConceptId],
      references: [conceptsTable.id],
      relationName: "tagSuggestionMergeTarget"
    }),
    decidedBy: one(usersTable, {
      fields: [tagSuggestionsTable.decidedById],
      references: [usersTable.id],
      relationName: "tagSuggestionDecider"
    }),
    outcomeConcept: one(conceptsTable, {
      fields: [tagSuggestionsTable.outcomeConceptId],
      references: [conceptsTable.id],
      relationName: "tagSuggestionOutcome"
    })
  })
)

// --- TAGS ---
// legacy: dropped in 0030. Declared so drizzle-kit does not emit the drops
// early; app code reads and writes the knowledge-organization tables above.
// SKOS mapping relations a tag may assert toward an external ontology class
export const skosMatchEnum = pgEnum("skos_match", [
  "exactMatch",
  "closeMatch",
  "broadMatch",
  "narrowMatch",
  "relatedMatch"
])

export type Tag = typeof tagsTable.$inferSelect
export const tagsTable = pgTable("tags", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  // Optional knowledge-organization layer, curated after the fact; plain
  // tags keep working untouched. `scheme` groups curated facet tags (e.g.
  // "facet"); a mapping asserts a SKOS match to a class in an external
  // ontology such as EMMO or PMDco, and flows into the SKOS export.
  scheme: text(),
  mappingIri: text(),
  mappingRelation: skosMatchEnum()
})

export const tagsTableRelations = relations(tagsTable, ({ many }) => ({
  definitions: many(tagsToDefinitions)
}))

export const tagsToDefinitions = pgTable(
  "tagsToTerms",
  {
    definitionId: integer()
      .references(() => definitionsTable.id)
      .notNull(),
    tagId: integer()
      .references(() => tagsTable.id)
      .notNull()
  },
  (table) => [primaryKey({ columns: [table.tagId, table.definitionId] })]
)

export const tagsToTermsRelations = relations(tagsToDefinitions, ({ one }) => ({
  definition: one(definitionsTable, {
    fields: [tagsToDefinitions.definitionId],
    references: [definitionsTable.id]
  }),
  tag: one(tagsTable, {
    fields: [tagsToDefinitions.tagId],
    references: [tagsTable.id]
  })
}))

export const chatTypeEnum = pgEnum("chat_type", ["system", "user"])

export const chatsTable = pgTable("chats", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  termId: integer()
    .references(() => termsTable.id)
    .notNull(),
  role: chatTypeEnum().notNull(),
  // Author of "user" rows; null on "system" rows and on user rows that
  // predate tracking (except where backfilled from a mirrored comment)
  userId: integer().references(() => usersTable.id),
  message: text().notNull(),
  // Generation provenance, set only on AI ("system") rows: which prompt and
  // model produced this output. promptKey is null when SYSTEM_PROMPT raw text
  // was used; promptHash/promptText always identify the exact prompt sent.
  promptKey: text(),
  promptHash: text(),
  promptText: text(),
  model: text(),
  createdAt: timestamp({ mode: "string", withTimezone: true })
    .default(sql`now()`)
    .notNull()
})

export const chatsTableRelations = relations(chatsTable, ({ one }) => ({
  term: one(termsTable, {
    fields: [chatsTable.termId],
    references: [termsTable.id]
  }),
  author: one(usersTable, {
    fields: [chatsTable.userId],
    references: [usersTable.id]
  })
}))
