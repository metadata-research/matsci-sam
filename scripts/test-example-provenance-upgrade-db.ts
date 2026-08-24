/*
 * Exercises the populated 0044 -> 0045 example-provenance upgrade without
 * touching the migrated application schema. The fixture lives in a uniquely
 * named schema inside one transaction, the real 0045 SQL is applied to it,
 * and the transaction is always rolled back.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { Client } from "pg"

type PgError = Error & { code?: string; constraint?: string }

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}"`

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at the throwaway CI database")
    process.exit(2)
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  const schema = `example_upgrade_${process.pid}_${Date.now()}`
  assert.match(schema, /^[a-z0-9_]+$/)
  const quotedSchema = quoteIdentifier(schema)

  const migration = readFileSync(
    path.join(
      process.cwd(),
      "drizzle",
      "migrations",
      "0045_unique_natasha_romanoff.sql"
    ),
    "utf8"
  )
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)

  const expectRejected = async (
    sql: string,
    expected: { code: string; constraint?: string; message?: string },
    label: string
  ) => {
    await client.query("SAVEPOINT expected_rejection")
    let rejection: PgError | undefined
    try {
      await client.query(sql)
    } catch (error) {
      rejection = error as PgError
    }
    await client.query("ROLLBACK TO SAVEPOINT expected_rejection")
    await client.query("RELEASE SAVEPOINT expected_rejection")

    assert.ok(rejection, `${label}: expected the database to reject the write`)
    assert.equal(rejection.code, expected.code, `${label}: SQLSTATE`)
    if (expected.constraint) {
      assert.equal(
        rejection.constraint,
        expected.constraint,
        `${label}: constraint`
      )
    }
    if (expected.message) {
      assert.ok(
        rejection.message.includes(expected.message),
        `${label}: expected error to include ${JSON.stringify(expected.message)}`
      )
    }
  }

  await client.connect()
  await client.query("BEGIN")
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`)
    await client.query(`SET LOCAL search_path TO ${quotedSchema}, pg_catalog`)

    // Minimal pre-0045 shape from migration 0044. The permissive constraints
    // accept attributed legacy rows, exactly as the original backfill wrote
    // them, and the guards make their provenance immutable.
    await client.query(`
      CREATE TABLE "definitionExamples" (
        "id" integer PRIMARY KEY,
        "definitionId" integer NOT NULL,
        "exampleNumber" integer NOT NULL,
        "sourceRevisionId" integer NOT NULL,
        "text" text NOT NULL,
        "authorId" integer,
        "actorKind" text,
        "promptKey" text,
        "promptHash" text,
        "promptText" text,
        "model" text,
        "createdAt" timestamp with time zone NOT NULL,
        "withdrawnAt" timestamp with time zone,
        "legacyBackfill" boolean DEFAULT false NOT NULL,
        CONSTRAINT "definition_examples_attribution_complete_or_legacy"
          CHECK ("legacyBackfill"
            OR ("authorId" IS NOT NULL AND "actorKind" IS NOT NULL))
      )
    `)
    await client.query(`
      CREATE TABLE "definitionExampleSelections" (
        "id" integer PRIMARY KEY,
        "definitionId" integer NOT NULL,
        "exampleId" integer NOT NULL,
        "selectedById" integer,
        "selectedAt" timestamp with time zone NOT NULL,
        "endedAt" timestamp with time zone,
        "endedById" integer,
        "legacyBackfill" boolean DEFAULT false NOT NULL,
        CONSTRAINT "definition_example_selections_actor_or_legacy"
          CHECK ("legacyBackfill" OR "selectedById" IS NOT NULL)
      )
    `)
    await client.query(`
      CREATE FUNCTION "guard_definition_example_immutable"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
          OR NEW."definitionId" IS DISTINCT FROM OLD."definitionId"
          OR NEW."exampleNumber" IS DISTINCT FROM OLD."exampleNumber"
          OR NEW."sourceRevisionId" IS DISTINCT FROM OLD."sourceRevisionId"
          OR NEW.text IS DISTINCT FROM OLD.text
          OR NEW."authorId" IS DISTINCT FROM OLD."authorId"
          OR NEW."actorKind" IS DISTINCT FROM OLD."actorKind"
          OR NEW."promptKey" IS DISTINCT FROM OLD."promptKey"
          OR NEW."promptHash" IS DISTINCT FROM OLD."promptHash"
          OR NEW."promptText" IS DISTINCT FROM OLD."promptText"
          OR NEW.model IS DISTINCT FROM OLD.model
          OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
          OR NEW."legacyBackfill" IS DISTINCT FROM OLD."legacyBackfill"
          OR (OLD."withdrawnAt" IS NOT NULL
            AND NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt")
        THEN
          RAISE EXCEPTION 'definition example content and provenance are immutable';
        END IF;
        RETURN NEW;
      END
      $function$
    `)
    await client.query(`
      CREATE TRIGGER "definition_examples_immutable"
      BEFORE UPDATE ON "definitionExamples"
      FOR EACH ROW
      EXECUTE FUNCTION "guard_definition_example_immutable"()
    `)
    await client.query(`
      CREATE FUNCTION "guard_definition_example_selection_immutable"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
          OR NEW."definitionId" IS DISTINCT FROM OLD."definitionId"
          OR NEW."exampleId" IS DISTINCT FROM OLD."exampleId"
          OR NEW."selectedById" IS DISTINCT FROM OLD."selectedById"
          OR NEW."selectedAt" IS DISTINCT FROM OLD."selectedAt"
          OR NEW."legacyBackfill" IS DISTINCT FROM OLD."legacyBackfill"
          OR (OLD."endedAt" IS NOT NULL AND (
            NEW."endedAt" IS DISTINCT FROM OLD."endedAt"
            OR NEW."endedById" IS DISTINCT FROM OLD."endedById"
          ))
        THEN
          RAISE EXCEPTION 'definition example selection history is immutable';
        END IF;
        RETURN NEW;
      END
      $function$
    `)
    await client.query(`
      CREATE TRIGGER "definition_example_selections_immutable"
      BEFORE UPDATE ON "definitionExampleSelections"
      FOR EACH ROW
      EXECUTE FUNCTION "guard_definition_example_selection_immutable"()
    `)

    await client.query(`
      INSERT INTO "definitionExamples" (
        "id", "definitionId", "exampleNumber", "sourceRevisionId", "text",
        "authorId", "actorKind", "promptKey", "promptHash", "promptText",
        "model", "createdAt", "legacyBackfill"
      ) VALUES
        (1, 11, 1, 101, 'Historical compatibility example.', 1001, 'human',
          NULL, NULL, NULL, NULL, '2025-01-02T03:04:05Z', true),
        (2, 22, 4, 202, 'Observed model example.', 2002, 'model',
          'example', 'sha256:observed', 'Observed prompt', 'test-model',
          '2026-02-03T04:05:06Z', false)
    `)
    await client.query(`
      INSERT INTO "definitionExampleSelections" (
        "id", "definitionId", "exampleId", "selectedById", "selectedAt",
        "endedAt", "endedById", "legacyBackfill"
      ) VALUES
        (1, 11, 1, 1001, '2025-01-02T03:04:05Z', NULL, NULL, true),
        (2, 22, 2, 2002, '2026-02-03T05:06:07Z', NULL, NULL, false)
    `)

    for (const statement of statements) await client.query(statement)

    const examples = await client.query<{
      id: number
      definitionId: number
      exampleNumber: number
      sourceRevisionId: number
      text: string
      authorId: number | null
      actorKind: string | null
      promptKey: string | null
      promptHash: string | null
      promptText: string | null
      model: string | null
      createdAt: Date
      legacyBackfill: boolean
    }>(`SELECT * FROM "definitionExamples" ORDER BY id`)
    assert.equal(examples.rows.length, 2)
    assert.deepEqual(examples.rows[0], {
      id: 1,
      definitionId: 11,
      exampleNumber: 1,
      sourceRevisionId: 101,
      text: "Historical compatibility example.",
      authorId: null,
      actorKind: null,
      promptKey: null,
      promptHash: null,
      promptText: null,
      model: null,
      createdAt: new Date("2025-01-02T03:04:05Z"),
      withdrawnAt: null,
      legacyBackfill: true
    })
    assert.deepEqual(examples.rows[1], {
      id: 2,
      definitionId: 22,
      exampleNumber: 4,
      sourceRevisionId: 202,
      text: "Observed model example.",
      authorId: 2002,
      actorKind: "model",
      promptKey: "example",
      promptHash: "sha256:observed",
      promptText: "Observed prompt",
      model: "test-model",
      createdAt: new Date("2026-02-03T04:05:06Z"),
      withdrawnAt: null,
      legacyBackfill: false
    })

    const selections = await client.query<{
      id: number
      definitionId: number
      exampleId: number
      selectedById: number | null
      selectedAt: Date
      endedAt: Date | null
      endedById: number | null
      legacyBackfill: boolean
    }>(`SELECT * FROM "definitionExampleSelections" ORDER BY id`)
    assert.deepEqual(selections.rows, [
      {
        id: 1,
        definitionId: 11,
        exampleId: 1,
        selectedById: null,
        selectedAt: new Date("2025-01-02T03:04:05Z"),
        endedAt: null,
        endedById: null,
        legacyBackfill: true
      },
      {
        id: 2,
        definitionId: 22,
        exampleId: 2,
        selectedById: 2002,
        selectedAt: new Date("2026-02-03T05:06:07Z"),
        endedAt: null,
        endedById: null,
        legacyBackfill: false
      }
    ])

    const catalog = await client.query<{
      kind: "constraint" | "index" | "trigger"
      name: string
      definition: string
    }>(`
      SELECT 'constraint' AS kind, conname AS name,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = current_schema()::regnamespace
        AND conname IN (
          'definition_examples_attribution_complete_or_legacy',
          'definition_example_selections_actor_or_legacy'
        )
      UNION ALL
      SELECT 'index' AS kind, indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'definition_example_selections_definition_history_idx'
      UNION ALL
      SELECT 'trigger' AS kind, tgname AS name, tgenabled::text AS definition
      FROM pg_trigger
      WHERE tgrelid IN (
          '"definitionExamples"'::regclass,
          '"definitionExampleSelections"'::regclass
        )
        AND tgname IN (
          'definition_examples_immutable',
          'definition_example_selections_immutable'
        )
      ORDER BY kind, name
    `)
    assert.equal(catalog.rows.length, 5)
    const historyIndex = catalog.rows.find((row) => row.kind === "index")
    assert.ok(historyIndex)
    assert.match(
      historyIndex.definition,
      /\("definitionId", "selectedAt", id\)/,
      "history index orders each definition's decisions deterministically"
    )
    const triggers = catalog.rows.filter((row) => row.kind === "trigger")
    assert.equal(triggers.length, 2)
    assert.ok(
      triggers.every((row) => row.definition === "O"),
      "0045 reenables both immutability triggers"
    )

    await expectRejected(
      `INSERT INTO "definitionExamples" (
        "id", "definitionId", "exampleNumber", "sourceRevisionId", "text",
        "authorId", "actorKind", "createdAt", "legacyBackfill"
      ) VALUES (3, 33, 1, 303, 'Fabricated legacy actor.', 3003, 'human', now(), true)`,
      {
        code: "23514",
        constraint: "definition_examples_attribution_complete_or_legacy"
      },
      "strict legacy example attribution"
    )
    await expectRejected(
      `INSERT INTO "definitionExamples" (
        "id", "definitionId", "exampleNumber", "sourceRevisionId", "text",
        "createdAt", "legacyBackfill"
      ) VALUES (3, 33, 1, 303, 'Missing observed actor.', now(), false)`,
      {
        code: "23514",
        constraint: "definition_examples_attribution_complete_or_legacy"
      },
      "strict observed example attribution"
    )
    await expectRejected(
      `INSERT INTO "definitionExampleSelections" (
        "id", "definitionId", "exampleId", "selectedById", "selectedAt",
        "legacyBackfill"
      ) VALUES (3, 33, 3, 3003, now(), true)`,
      {
        code: "23514",
        constraint: "definition_example_selections_actor_or_legacy"
      },
      "strict legacy selector attribution"
    )
    await expectRejected(
      `INSERT INTO "definitionExampleSelections" (
        "id", "definitionId", "exampleId", "selectedAt", "legacyBackfill"
      ) VALUES (3, 33, 3, now(), false)`,
      {
        code: "23514",
        constraint: "definition_example_selections_actor_or_legacy"
      },
      "strict observed selector attribution"
    )
    await expectRejected(
      `UPDATE "definitionExamples" SET "authorId" = 9999 WHERE id = 1`,
      {
        code: "P0001",
        message: "definition example content and provenance are immutable"
      },
      "example guard after provenance repair"
    )
    await expectRejected(
      `UPDATE "definitionExampleSelections"
        SET "selectedById" = 9999 WHERE id = 1`,
      {
        code: "P0001",
        message: "definition example selection history is immutable"
      },
      "selection guard after provenance repair"
    )
  } finally {
    await client.query("ROLLBACK")
    await client.end()
  }

  console.log("Populated example-provenance upgrade database test passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
