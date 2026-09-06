// Run against a migrated test database. The fixture is removed unless the
// caller explicitly retains it in a disposable database for browser QA.
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { eq, inArray } from "drizzle-orm"
import {
  db,
  usersTable,
  vocabulariesTable,
  termsTable,
  definitionsTable
} from "../drizzle"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision
} from "../lib/definition-revisions"
import { castVote } from "../lib/participation"
import { deleteDefinitionRows } from "../lib/definition-purge"
import {
  findDefinitionAtRank,
  findDefinitionRevisionByPublicNumber
} from "../lib/public-definition-resolution"
import {
  buildTermSkos,
  loadKos,
  loadSchemeDocument,
  termJsonLd,
  termTurtle
} from "../lib/skos"
import { vocabularyGraphTurtle } from "../lib/graph/documents"
import { definitionsRouter } from "../trpc/routers/definitions"
import { Parser, Store } from "n3"
import { redirectDefinitionAtRank } from "../app/vocabulary/_route-handlers"
import { GET as getDocument } from "../app/api/vocabulary-document/route"
import {
  applicationMetadataNamespaceUri,
  definitionUri,
  termUri
} from "../lib/public-identifiers"

async function main() {
  const stamp = `${Date.now()}_${process.pid}`
  const scopes = [`canonical_a_${stamp}`, `canonical_b_${stamp}`]
  const userIds: number[] = [],
    termIds: number[] = [],
    definitionIds: number[] = []
  try {
    const fixture = await db.transaction(async (tx) => {
      const users = await tx
        .insert(usersTable)
        .values([
          { name: "Canonical author one" },
          { name: "Canonical author two" },
          { name: "Canonical reviewer" }
        ])
        .returning()
      userIds.push(...users.map((u) => u.id))
      await tx
        .insert(vocabulariesTable)
        .values(
          scopes.map((slug, i) => ({ slug, title: `Metal community ${i + 1}` }))
        )
      const terms = await tx
        .insert(termsTable)
        .values(
          scopes.map((vocabularySlug) => ({
            vocabularySlug,
            term: "metal",
            slug: "metal"
          }))
        )
        .returning()
      termIds.push(...terms.map((t) => t.id))
      const definitions = []
      for (let t = 0; t < terms.length; t++)
        for (let n = 0; n < 2; n++) {
          const d = await createDefinitionWithInitialRevision(tx, {
            termId: terms[t].id,
            authorId: users[n].id,
            definition: `Metal in community ${t + 1}, interpretation ${n + 1}.`,
            example: "",
            changeNote: "Initial definition",
            source: "initial"
          })
          await tx
            .update(definitionsTable)
            .set({ createdAt: `2026-08-0${n + 1}T00:00:00Z` })
            .where(eq(definitionsTable.id, d.definition.id))
          definitions.push(d)
          definitionIds.push(d.definition.id)
        }
      return { terms, definitions, reviewer: users[2].id, author: users[0].id }
    })
    const caller = definitionsRouter.createCaller({
      session: {
        save: async () => {},
        destroy: () => {},
        updateConfig: () => {}
      }
    })
    const winner = async (i: number, number: number) => {
      const ranked = await findDefinitionAtRank("metal", 1, scopes[i])
      assert.equal(ranked?.definitionNumber, number)
      const listed = await caller.list({ termId: fixture.terms[i].id })
      assert.equal(listed[0]?.definitionNumber, number)
      const kos = await loadKos(),
        skos = await buildTermSkos(fixture.terms[i].id, kos)
      assert.ok(skos)
      const expected = definitionUri("metal", number, scopes[i])
      assert.equal(skos.canonicalDefinition, expected)
      assert.deepEqual(termJsonLd(skos, kos)["matsci:canonicalDefinition"], {
        "@id": expected
      })
      assert.ok(
        termTurtle(skos, kos).includes(
          `matsci:canonicalDefinition <${expected}>`
        )
      )
      assert.equal(skos.uri, termUri("metal", scopes[i]))
      const projected = new Store(
        new Parser().parse(vocabularyGraphTurtle(await loadSchemeDocument()))
      )
      assert.deepEqual(
        projected
          .getObjects(
            skos.uri,
            `${applicationMetadataNamespaceUri}canonicalDefinition`,
            null
          )
          .map((object) => object.value),
        [expected]
      )
      const redirect = await redirectDefinitionAtRank(
        new Request("https://localhost:3000/ignored"),
        scopes[i],
        "metal",
        "1"
      )
      assert.equal(redirect.status, 307)
      assert.equal(
        redirect.headers.get("location"),
        `/vocabulary/${scopes[i]}/metal/definitions/${number}`
      )
      assert.equal(redirect.headers.get("cache-control"), "no-store")
      const response = await getDocument(
        new Request(
          `http://localhost/api/vocabulary-document?resource=/vocabulary/${scopes[i]}/metal&format=jsonld`
        )
      )
      assert.equal(response.status, 200)
      const graph = await response.json()
      const term = graph.find(
        (n: Record<string, unknown>) => n["@id"] === skos.uri
      )
      assert.deepEqual(
        term[`${applicationMetadataNamespaceUri}canonicalDefinition`],
        [{ "@id": expected }]
      )
    }
    await winner(0, 2)
    await winner(1, 2)
    const first = fixture.definitions[0]
    await db.transaction((tx) =>
      castVote(tx, {
        definitionId: first.definition.id,
        revisionId: first.revision.id,
        userId: fixture.reviewer,
        vote: "up",
        actorKind: "human",
        communityId: null
      })
    )
    await winner(0, 1)
    await winner(1, 2)
    assert.notEqual(termUri("metal", scopes[0]), termUri("metal", scopes[1]))
    await db.transaction((tx) =>
      publishDefinitionRevision(tx, {
        definitionId: first.definition.id,
        editorId: fixture.author,
        definition: "An updated interpretation of metal.",
        example: "",
        changeNote: "Clarify wording",
        source: "author_edit",
        expectedRevisionId: first.revision.id
      })
    )
    await winner(0, 2)
    await winner(1, 2)
    assert.ok(
      await findDefinitionRevisionByPublicNumber("metal", 1, 1, scopes[0])
    )
    for (const format of ["ttl", "jsonld"]) {
      const response = await getDocument(
        new Request(
          `http://localhost/api/vocabulary-document?resource=/vocabulary/${scopes[0]}/metal/definitions/1/revisions/1&format=${format}`
        )
      )
      assert.equal(response.status, 200)
      assert.ok((await response.text()).includes("interpretation 1."))
    }
    assert.equal(
      await findDefinitionAtRank("metal", 1, "nonexistent_community"),
      undefined
    )
    const missing = await getDocument(
      new Request(
        `http://localhost/api/vocabulary-document?resource=/vocabulary/${scopes[0]}/metal/definitions/999&format=ttl`
      )
    )
    assert.equal(missing.status, 404)
    const [empty] = await db
      .insert(termsTable)
      .values({
        vocabularySlug: scopes[0],
        term: "empty",
        slug: "empty"
      })
      .returning()
    termIds.push(empty.id)
    assert.equal(await findDefinitionAtRank("empty", 1, scopes[0]), undefined)
    assert.equal(
      (await buildTermSkos(empty.id, await loadKos()))?.canonicalDefinition,
      undefined
    )
    if (process.env.W3ID_KEEP_FIXTURE === "true")
      writeFileSync(
        "/tmp/w3id-fixture.json",
        JSON.stringify({ scopes, termIds, definitionIds }),
        { mode: 0o600 }
      )
    console.log(
      "Community isolation, votes, revision reset, RDF agreement, and public redirects passed"
    )
  } finally {
    if (process.env.W3ID_KEEP_FIXTURE !== "true")
      await db.transaction(async (tx) => {
        for (const id of definitionIds) await deleteDefinitionRows(tx, id)
        if (termIds.length)
          await tx.delete(termsTable).where(inArray(termsTable.id, termIds))
        await tx
          .delete(vocabulariesTable)
          .where(inArray(vocabulariesTable.slug, scopes))
        if (userIds.length)
          await tx.delete(usersTable).where(inArray(usersTable.id, userIds))
      })
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
