import { Diff } from "diff-match-patch-ts"
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
  numeric
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
    exampleDiff: jsonb().notNull().$type<Diff[]>(),
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
    changeDelta: numeric({ precision: 4, scale: 3 }).notNull(),
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
      sql`btrim(${table.definitionDiff}) <> ''`
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
      sql`(${table.exampleDiff} IS NULL OR btrim(${table.exampleDiff}) <> '')
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

// --- TAGS ---
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
