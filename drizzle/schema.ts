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
  unique
} from "drizzle-orm/pg-core"

export const userRoleEnum = pgEnum("user_role", ["user", "moderator", "admin"])

// --- USERS ---
export type User = typeof usersTable.$inferSelect
export const usersTable = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  googleId: varchar().unique(undefined, { nulls: "distinct" }),
  name: varchar({ length: 255 }),
  email: varchar({ length: 254 }),
  isAi: boolean().notNull().default(false),
  role: userRoleEnum().notNull().default("user"),
  // Reputation multiplier, stored per user; not yet applied to vote tallies
  weight: real().notNull().default(1),
  createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
  notifications: boolean().default(false)
})

export const usersTableRelations = relations(usersTable, ({ one, many }) => ({
  definitions: many(definitionsTable),
  comments: many(commentsTable),
  votes: many(votesTable)
}))

// --- TERMS ---
export type Term = typeof termsTable.$inferSelect
export const termsTable = pgTable("terms", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  // authorId: integer().references(() => usersTable.id),
  createdAt: timestamp({ mode: "string" }).defaultNow().notNull(),
  term: text().notNull().unique()
})

export const termsTableRelations = relations(termsTable, ({ one, many }) => ({
  definitions: many(definitionsTable),
  chats: many(chatsTable)
}))

// --- DEFINITIONS ---
export type Definition = typeof definitionsTable.$inferSelect
export type DefinitionWithAuthor = Definition & { author: User }
export const definitionsTable = pgTable(
  "definitions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    termId: integer()
      .references(() => termsTable.id)
      .notNull(),
    authorId: integer().references(() => usersTable.id),
    definition: text().notNull(),
    example: text().notNull(),
    // LLM that generated this definition; null for human-authored definitions
    model: text(),
    // System prompt the LLM ran with; null for human-authored definitions
    // (or AI definitions that predate prompt tracking)
    prompt: text(),
    score: integer().notNull().default(0),
    createdAt: timestamp({ mode: "string", withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp({ mode: "string" }).$onUpdateFn(() => sql`now()`)
  },
  (table) => [unique().on(table.authorId, table.termId)]
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
    edits: many(editsTable),
    comments: many(commentsTable),
    votes: many(votesTable),
    tags: many(tagsToDefinitions)
  })
)

// --- DEFINITION EDITS ---
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
    definitionId: integer()
      .references(() => definitionsTable.id)
      .notNull(),
    userId: integer()
      .references(() => usersTable.id)
      .notNull(),
    kind: voteTypeEnum().notNull()
  },
  (table) => [primaryKey({ columns: [table.definitionId, table.userId] })]
)

export const votesTableRelations = relations(votesTable, ({ one, many }) => ({
  author: one(usersTable, {
    fields: [votesTable.userId],
    references: [usersTable.id]
  }),
  term: one(definitionsTable, {
    fields: [votesTable.definitionId],
    references: [definitionsTable.id]
  })
}))

// --- COMMENTS ---
export type Comment = typeof commentsTable.$inferSelect
export const commentsTable = pgTable("comments", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  definitionId: integer()
    .references(() => definitionsTable.id)
    .notNull(),
  userId: integer()
    .references(() => usersTable.id)
    .notNull(),
  message: text().notNull(),
  createdAt: timestamp({ mode: "string", withTimezone: true })
    .default(sql`now()`)
    .notNull()
})

export const commentsTableRelations = relations(commentsTable, ({ one }) => ({
  author: one(usersTable, {
    fields: [commentsTable.userId],
    references: [usersTable.id]
  }),
  term: one(definitionsTable, {
    fields: [commentsTable.definitionId],
    references: [definitionsTable.id]
  })
}))

// --- TAGS ---
export type Tag = typeof tagsTable.$inferSelect
export const tagsTable = pgTable("tags", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull()
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
  message: text().notNull(),
  createdAt: timestamp({ mode: "string", withTimezone: true })
    .default(sql`now()`)
    .notNull()
})

export const chatsTableRelations = relations(chatsTable, ({ one }) => ({
  term: one(termsTable, {
    fields: [chatsTable.termId],
    references: [termsTable.id]
  })
}))
