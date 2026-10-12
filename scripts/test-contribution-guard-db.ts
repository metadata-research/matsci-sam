// Real publication races on a disposable local database. Committed fixtures
// permit independent connections to contend, and finally removes every fixture.
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"
import { and, eq, inArray, sql } from "drizzle-orm"
import {
  aiContributionSuggestionsTable,
  aiModelsTable,
  commentsTable,
  contributionFilesTable,
  contributionSubmissionsTable,
  db,
  definitionExamplesTable,
  definitionsTable,
  termReferenceEntriesTable,
  termReferenceLookupsTable,
  termsTable,
  usersTable
} from "../drizzle"
import {
  contributionFingerprint,
  definitionSubmissionFingerprint,
  lockContributionSubmissions,
  reserveContributionSubmission
} from "../lib/contribution-guard"
import { GetModelUser } from "../lib/crud"
import { deleteDefinitionRows } from "../lib/definition-purge"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision
} from "../lib/definition-revisions"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"
import { commentsRouter } from "../trpc/routers/comments"
import { definitionsRouter } from "../trpc/routers/definitions"
import { examplesRouter } from "../trpc/routers/examples"

const main = async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL!)
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname),
    "Contribution fixture tests only run on localhost"
  )
  assert.match(
    databaseUrl.pathname,
    /_(?:test|scratch|ci)(?:_|$)/,
    "Contribution fixture tests require an explicitly disposable database name"
  )
  process.env.GRAPH_PROJECTION_ENABLED = "false"

  const stamp = randomUUID().replaceAll("-", "")
  const userIds: number[] = []
  const termIds = new Set<number>()
  const receiptCount = async (userId: number, kind?: string) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributionSubmissionsTable)
      .where(
        and(
          eq(contributionSubmissionsTable.userId, userId),
          kind
            ? eq(
                contributionSubmissionsTable.kind,
                kind as "definition" | "comment" | "example"
              )
            : undefined
        )
      )
    return row.count
  }
  const race = async (
    publications: Promise<unknown>[],
    successful: number,
    failureCode: string
  ) => {
    const results = await Promise.allSettled(publications)
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      successful
    )
    for (const result of results)
      if (result.status === "rejected")
        assert.equal(result.reason.code, failureCode)
  }

  try {
    const users = await db
      .insert(usersTable)
      .values(
        [
          "source author",
          "contributor",
          "other contributor",
          "definition quota",
          "comment quota",
          "example quota",
          "AI contributor",
          "clock waiter"
        ].map((name) => ({
          name: `Contribution guard ${name} ${stamp}`,
          role:
            name === "definition quota" ? ("admin" as const) : ("user" as const)
        }))
      )
      .returning()
    userIds.push(...users.map((user) => user.id))
    const [
      author,
      contributor,
      other,
      definitionQuota,
      commentQuota,
      exampleQuota,
      aiContributor,
      waiter
    ] = users
    const context = (id: number) => ({ session: { id } }) as never
    const comments = commentsRouter.createCaller(context(contributor.id))
    const otherComments = commentsRouter.createCaller(context(other.id))
    const examples = examplesRouter.createCaller(context(contributor.id))
    const definitions = definitionsRouter.createCaller(context(contributor.id))

    const [term] = await db
      .insert(termsTable)
      .values({
        vocabularySlug: DEFAULT_VOCABULARY_SLUG,
        term: `contribution guard ${stamp}`,
        slug: `contribution_guard_${stamp}`
      })
      .returning()
    termIds.add(term.id)
    const source = await db.transaction((tx) =>
      createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: author.id,
        definition: "An immutable publication guard fixture.",
        example: "",
        changeNote: "Guard fixture",
        source: "initial"
      })
    )

    assert.equal(
      contributionFingerprint({ revisionId: 1, text: "Pa" }),
      contributionFingerprint({ text: "Pa", revisionId: 1 }),
      "Object key order is not content"
    )
    assert.notEqual(
      contributionFingerprint({ revisionId: 1, text: "Pa" }),
      contributionFingerprint({ revisionId: 1, text: "pa" }),
      "Scientific case remains distinct"
    )
    const fingerprintInput = {
      vocabularySlug: term.vocabularySlug,
      term: term.term,
      definition: "A proposed meaning.",
      derivedFromRevisionId: source.revision.id
    }
    await db.transaction(async (tx) => {
      const fingerprint = await definitionSubmissionFingerprint(
        tx,
        fingerprintInput
      )
      assert.equal(
        fingerprint,
        await definitionSubmissionFingerprint(tx, {
          ...fingerprintInput,
          term: ` ${term.term.toUpperCase()} `,
          definition: " A proposed meaning. ",
          initialExample: ""
        })
      )
      assert.notEqual(
        fingerprint,
        await definitionSubmissionFingerprint(tx, {
          ...fingerprintInput,
          surveyStepId: 1
        }),
        "An independent study response retains its own context"
      )

      const lookups = await tx
        .insert(termReferenceLookupsTable)
        .values(
          [1, 2].map(() => ({
            requestedById: contributor.id,
            termText: term.term,
            termId: term.id
          }))
        )
        .returning()
      const references = await tx
        .insert(termReferenceEntriesTable)
        .values(
          lookups.map((lookup) => ({
            lookupId: lookup.id,
            term: term.term,
            definition: "Stored reference evidence.",
            source: "Fixture reference",
            sourceIri: "https://example.test/reference",
            sourceKey: "fixture:reference",
            version: "1",
            contentHash: "a".repeat(64)
          }))
        )
        .returning()
      const citedFingerprint = await definitionSubmissionFingerprint(tx, {
        ...fingerprintInput,
        references: [
          { lookupId: lookups[0].id, citedReferenceIds: [references[0].id] }
        ]
      })
      assert.equal(
        citedFingerprint,
        await definitionSubmissionFingerprint(tx, {
          ...fingerprintInput,
          references: [
            { lookupId: lookups[1].id, citedReferenceIds: [references[1].id] }
          ]
        }),
        "A new retrieval identifier alone does not change submitted evidence"
      )
      assert.notEqual(
        citedFingerprint,
        fingerprint,
        "Cited evidence distinguishes otherwise identical wording"
      )
      await tx
        .update(termReferenceEntriesTable)
        .set({ contentHash: "b".repeat(64) })
        .where(eq(termReferenceEntriesTable.id, references[1].id))
      assert.notEqual(
        citedFingerprint,
        await definitionSubmissionFingerprint(tx, {
          ...fingerprintInput,
          references: [
            { lookupId: lookups[1].id, citedReferenceIds: [references[1].id] }
          ]
        }),
        "Changed reference evidence remains a distinct submission"
      )

      const bytes = Buffer.from("%PDF-fixture")
      const files = await tx
        .insert(contributionFilesTable)
        .values(
          [1, 2].map((index) => ({
            uploadedById: contributor.id,
            termText: term.term,
            vocabularySlug: term.vocabularySlug,
            filename: `fixture-${index}.pdf`,
            mediaType: "application/pdf",
            byteSize: bytes.byteLength,
            contentHash: createHash("sha256").update(bytes).digest("hex"),
            bytes,
            role: "source" as const,
            title: "Fixture source",
            caption: "Evidence supplied with the definition."
          }))
        )
        .returning()
      assert.equal(
        await definitionSubmissionFingerprint(tx, {
          ...fingerprintInput,
          attachments: [{ fileId: files[0].id, publish: true }]
        }),
        await definitionSubmissionFingerprint(tx, {
          ...fingerprintInput,
          attachments: [{ fileId: files[1].id, publish: true }]
        }),
        "Reuploading identical evidence does not change a submission fingerprint"
      )
      await tx.delete(contributionFilesTable).where(
        inArray(
          contributionFilesTable.id,
          files.map((file) => file.id)
        )
      )
      await tx.delete(termReferenceLookupsTable).where(
        inArray(
          termReferenceLookupsTable.id,
          lookups.map((lookup) => lookup.id)
        )
      )
    })

    const commentInput = {
      id: source.definition.id,
      revisionId: source.revision.id,
      comment: "One comment despite a concurrent double submission."
    }
    await race(
      [comments.create(commentInput), comments.create(commentInput)],
      1,
      "CONFLICT"
    )
    assert.equal(await receiptCount(contributor.id, "comment"), 1)
    const sameTextComments = await db
      .select({ id: commentsTable.id })
      .from(commentsTable)
      .where(eq(commentsTable.userId, contributor.id))
    assert.equal(sameTextComments.length, 1)
    await otherComments.create(commentInput)

    const beforeInvalidComment = await receiptCount(contributor.id)
    await assert.rejects(
      comments.create({
        ...commentInput,
        revisionId: -1,
        comment: "Invalid source."
      }),
      { code: "NOT_FOUND" }
    )
    assert.equal(await receiptCount(contributor.id), beforeInvalidComment)

    const revised = await db.transaction((tx) =>
      publishDefinitionRevision(tx, {
        definitionId: source.definition.id,
        editorId: author.id,
        definition: "The fixture after a legitimate author edit.",
        example: "",
        changeNote: "Update the source fixture",
        source: "author_edit",
        expectedRevisionId: source.revision.id
      })
    )
    await comments.create({ ...commentInput, revisionId: revised.revision.id })

    const exampleInput = {
      definitionId: source.definition.id,
      sourceRevisionId: revised.revision.id,
      text: "One independent example despite two simultaneous submissions."
    }
    await race(
      [examples.create(exampleInput), examples.create(exampleInput)],
      1,
      "CONFLICT"
    )
    const beforeInvalidExample = await receiptCount(contributor.id)
    const [counterBefore] = await db
      .select({ next: definitionsTable.nextExampleNumber })
      .from(definitionsTable)
      .where(eq(definitionsTable.id, source.definition.id))
    await assert.rejects(
      examples.create({
        ...exampleInput,
        sourceRevisionId: source.revision.id,
        text: "A stale example."
      }),
      { code: "CONFLICT" }
    )
    assert.equal(await receiptCount(contributor.id), beforeInvalidExample)
    const [counterAfter] = await db
      .select({ next: definitionsTable.nextExampleNumber })
      .from(definitionsTable)
      .where(eq(definitionsTable.id, source.definition.id))
    assert.equal(counterAfter.next, counterBefore.next)
    await examplesRouter.createCaller(context(other.id)).create(exampleInput)

    const alternativeInput = {
      term: term.term,
      definition: "A distinct candidate meaning.",
      derivedFromRevisionId: revised.revision.id
    }
    await race(
      [
        definitions.create(alternativeInput),
        definitions.create(alternativeInput)
      ],
      1,
      "CONFLICT"
    )
    assert.equal(await receiptCount(contributor.id, "definition"), 1)
    await definitionsRouter
      .createCaller(context(other.id))
      .create(alternativeInput)
    const beforeFailedDefinition = await receiptCount(contributor.id)
    const failedTerm = `failed guard ${stamp}`
    await assert.rejects(
      definitions.create({
        term: failedTerm,
        definition: "This publication fails its evidence validation.",
        references: { lookupId: randomUUID(), citedReferenceIds: [] }
      }),
      { code: "BAD_REQUEST" }
    )
    assert.equal(await receiptCount(contributor.id), beforeFailedDefinition)
    assert.equal(
      await db.query.termsTable.findFirst({
        where: eq(termsTable.term, failedTerm)
      }),
      undefined,
      "The quota receipt and newly created term both roll back"
    )

    const model = await GetModelUser(`guard-${stamp}`)
    userIds.push(model.id)
    const previews = await db
      .insert(aiContributionSuggestionsTable)
      .values(
        [1, 2].map(() => ({
          intent: "revise_definition" as const,
          requestedById: aiContributor.id,
          vocabularySlug: term.vocabularySlug,
          termText: term.term,
          definitionId: source.definition.id,
          sourceRevisionId: revised.revision.id,
          feedback: "Propose the fixture alternative.",
          suggestedDefinition: "One AI-assisted published candidate.",
          promptKey: "guard-fixture",
          promptHash: "guard-fixture-hash",
          promptText: "An explicitly stored fixture generation prompt.",
          model: `guard-${stamp}`
        }))
      )
      .returning()
    const aiDefinitions = definitionsRouter.createCaller(
      context(aiContributor.id)
    )
    const aiInput = {
      term: term.term,
      definition: previews[0].suggestedDefinition
    }
    await aiDefinitions.create({ ...aiInput, aiSuggestionId: previews[0].id })
    await assert.rejects(
      aiDefinitions.create({ ...aiInput, aiSuggestionId: previews[1].id }),
      { code: "CONFLICT" }
    )
    const retainedPreview =
      await db.query.aiContributionSuggestionsTable.findFirst({
        where: eq(aiContributionSuggestionsTable.id, previews[1].id)
      })
    assert.equal(retainedPreview?.status, "generated")
    assert.equal(await receiptCount(aiContributor.id, "definition"), 1)

    const definitionQuotaCaller = definitionsRouter.createCaller(
      context(definitionQuota.id)
    )
    await race(
      Array.from({ length: 7 }, (_, index) =>
        definitionQuotaCaller.create({
          term: `quota guard ${stamp} ${index}`,
          definition: `Quota candidate ${index}.`
        })
      ),
      5,
      "TOO_MANY_REQUESTS"
    )
    assert.equal(await receiptCount(definitionQuota.id, "definition"), 5)

    const commentQuotaCaller = commentsRouter.createCaller(
      context(commentQuota.id)
    )
    await race(
      Array.from({ length: 12 }, (_, index) =>
        commentQuotaCaller.create({
          id: source.definition.id,
          revisionId: revised.revision.id,
          comment: `Quota comment ${index}.`
        })
      ),
      10,
      "TOO_MANY_REQUESTS"
    )
    const exampleQuotaCaller = examplesRouter.createCaller(
      context(exampleQuota.id)
    )
    const [beforeQuotaExamples] = await db
      .select({ next: definitionsTable.nextExampleNumber })
      .from(definitionsTable)
      .where(eq(definitionsTable.id, source.definition.id))
    await race(
      Array.from({ length: 12 }, (_, index) =>
        exampleQuotaCaller.create({
          ...exampleInput,
          text: `Quota example ${index}.`
        })
      ),
      10,
      "TOO_MANY_REQUESTS"
    )
    const [afterQuotaExamples] = await db
      .select({ next: definitionsTable.nextExampleNumber })
      .from(definitionsTable)
      .where(eq(definitionsTable.id, source.definition.id))
    assert.equal(afterQuotaExamples.next, beforeQuotaExamples.next + 10)
    const examplesWritten = await db
      .select({ id: definitionExamplesTable.id })
      .from(definitionExamplesTable)
      .where(eq(definitionExamplesTable.authorId, exampleQuota.id))
    assert.equal(examplesWritten.length, 10)

    await db
      .update(contributionSubmissionsTable)
      .set({ createdAt: sql`clock_timestamp() - interval '61 seconds'` })
      .where(eq(contributionSubmissionsTable.userId, commentQuota.id))
    await commentQuotaCaller.create({
      id: source.definition.id,
      revisionId: revised.revision.id,
      comment: "Quota comment 0."
    })
    assert.equal(
      await receiptCount(commentQuota.id, "comment"),
      11,
      "Both duplicate and minute quota windows expire"
    )
    await db
      .update(contributionSubmissionsTable)
      .set({ createdAt: sql`clock_timestamp() - interval '601 seconds'` })
      .where(eq(contributionSubmissionsTable.userId, definitionQuota.id))
    await definitionQuotaCaller.create({
      term: `quota guard expired ${stamp}`,
      definition: "A publication after the definition quota expires."
    })
    assert.equal(
      await receiptCount(definitionQuota.id, "definition"),
      1,
      "Expired operational receipts are pruned inside the publication transaction"
    )

    const latest = await db.transaction((tx) =>
      publishDefinitionRevision(tx, {
        definitionId: source.definition.id,
        editorId: author.id,
        definition: "The fixture after its second legitimate author edit.",
        example: "",
        changeNote: "Update the exact source context again",
        source: "author_edit",
        expectedRevisionId: revised.revision.id
      })
    )
    await definitions.create({
      ...alternativeInput,
      derivedFromRevisionId: latest.revision.id
    })
    await examples.create({
      ...exampleInput,
      sourceRevisionId: latest.revision.id
    })
    assert.equal(
      await receiptCount(contributor.id, "definition"),
      2,
      "Identical alternatives on different source revisions remain distinct"
    )

    let release!: () => void
    let locked!: () => void
    let started!: () => void
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve
    })
    const lockedPromise = new Promise<void>((resolve) => {
      locked = resolve
    })
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const holder = db.transaction(async (tx) => {
      await lockContributionSubmissions(tx, waiter.id)
      locked()
      await releasePromise
    })
    try {
      await lockedPromise
      const waiting = db.transaction(async (tx) => {
        await tx.execute(sql`SELECT transaction_timestamp()`)
        started()
        await reserveContributionSubmission(tx, {
          userId: waiter.id,
          kind: "comment",
          fingerprint: contributionFingerprint("Clock contention fixture")
        })
        const [timing] = await tx
          .select({
            afterStart: sql<boolean>`${contributionSubmissionsTable.createdAt} > transaction_timestamp()`
          })
          .from(contributionSubmissionsTable)
          .where(eq(contributionSubmissionsTable.userId, waiter.id))
        assert.equal(
          timing.afterStart,
          true,
          "A receipt uses the clock after waiting, not transaction now()"
        )
      })
      await startedPromise
      await new Promise((resolve) => setTimeout(resolve, 30))
      release()
      await waiting
    } finally {
      release()
      await holder
    }

    console.log(
      "Contribution guards passed: real publication duplicate/quota races, rollback, source/author context, AI preview provenance, expiry and contended database clock."
    )
  } finally {
    if (userIds.length)
      await db.transaction(async (tx) => {
        const ownedDefinitions = await tx
          .select({ id: definitionsTable.id, termId: definitionsTable.termId })
          .from(definitionsTable)
          .where(inArray(definitionsTable.authorId, userIds))
          .orderBy(sql`${definitionsTable.id} DESC`)
        for (const definition of ownedDefinitions) {
          termIds.add(definition.termId)
          await deleteDefinitionRows(tx, definition.id)
        }
        await tx
          .delete(aiContributionSuggestionsTable)
          .where(inArray(aiContributionSuggestionsTable.requestedById, userIds))
        await tx
          .delete(contributionSubmissionsTable)
          .where(inArray(contributionSubmissionsTable.userId, userIds))
        await tx
          .delete(aiModelsTable)
          .where(inArray(aiModelsTable.userId, userIds))
        if (termIds.size)
          await tx
            .delete(termsTable)
            .where(inArray(termsTable.id, [...termIds]))
        await tx.delete(usersTable).where(inArray(usersTable.id, userIds))
      })
  }
}

// Match the Next request work context so route revalidation runs unmodified.
workAsyncStorage
  .run(
    { route: "/api/trpc", incrementalCache: {} } as unknown as Parameters<
      typeof workAsyncStorage.run
    >[0],
    main
  )
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
