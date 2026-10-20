import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import {
  imageDocx,
  jpegFixture,
  noisyPdf,
  noisyPng
} from "./import-migration-binary-fixtures"
import {
  databaseSize,
  drizzleTransactionContract,
  interruptAssetCopy,
  measureMigration,
  schemaManifest
} from "./import-migration-interruption"

const sha = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex")
const without = (row: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))
const fileManifest = async (client: Client) =>
  (
    await client.query(`
    select to_jsonb(f)-'bytes' as metadata,encode(sha256(bytes),'hex') as "actualHash"
    from "contributionFiles" f order by id
  `)
  ).rows as { metadata: Record<string, unknown>; actualHash: string | null }[]
async function main() {
  const connectionString = process.env.MIGRATION_TEST_DATABASE_URL
  assert.ok(
    connectionString,
    "Set MIGRATION_TEST_DATABASE_URL to a new disposable database"
  )
  const url = new URL(connectionString)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  const database = url.pathname.slice(1)
  assert.match(database, /^[a-z0-9_]+_migration_test(?:_[a-z0-9_]+)?$/)
  const adminUrl = new URL(url)
  adminUrl.pathname = "/postgres"
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  const exists = await admin.query(
    "select 1 from pg_database where datname=$1",
    [database]
  )
  if (!exists.rowCount) await admin.query(`create database "${database}"`)
  await admin.end()
  const client = new Client({ connectionString })
  const observer = new Client({ connectionString })
  await client.connect()
  await observer.connect()
  const directory = await mkdtemp(path.join(tmpdir(), "matsci-import-upgrade-"))
  try {
    const transactionContract = await drizzleTransactionContract()
    assert.equal(
      (
        await client.query(
          "select count(*)::int as count from information_schema.tables where table_schema='public'"
        )
      ).rows[0].count,
      0,
      "Migration fixture requires an empty database"
    )
    const source = path.resolve("drizzle/migrations")
    const journal = JSON.parse(
      await readFile(path.join(source, "meta/_journal.json"), "utf8")
    ) as { entries: { idx: number; tag: string }[] }
    const upgrade = journal.entries.find(
      (entry) => entry.tag === "0069_import_term_drafts"
    )
    assert.ok(upgrade)
    const earlier = journal.entries.filter((entry) => entry.idx < upgrade.idx)
    assert.equal(earlier.length, 69)
    await mkdir(path.join(directory, "meta"))
    await writeFile(
      path.join(directory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: earlier })
    )
    for (const entry of earlier)
      await copyFile(
        path.join(source, `${entry.tag}.sql`),
        path.join(directory, `${entry.tag}.sql`)
      )
    await migrate(drizzle(client), { migrationsFolder: directory })
    await client.query("begin")
    const user = (
      await client.query(
        "insert into users(name,role) values ('Migration fixture','admin') returning id"
      )
    ).rows[0].id as number
    const vocabulary = "import_upgrade_fixture"
    await client.query(
      'insert into vocabularies(slug,title,"createdById") values ($1,$2,$3)',
      [vocabulary, "Upgrade fixture", user]
    )
    const term = (
      await client.query(
        'insert into terms(term,slug,"vocabularySlug") values ($1,$2,$3) returning id',
        ["legacy term", "legacy-term", vocabulary]
      )
    ).rows[0].id as number
    const definition = (
      await client.query(
        'insert into definitions("termId","definitionNumber","authorId",definition,example) values ($1,1,$2,$3,\'\') returning id',
        [term, user, "Legacy definition"]
      )
    ).rows[0].id as number
    const revision = (
      await client.query(
        'insert into "definitionRevisions"("definitionId",version,"definitionDiff","exampleDiff","editorId","changeNote",source,"changeDelta") values ($1,1,$2,$3,$4,$5,\'initial\',1) returning id',
        [
          definition,
          JSON.stringify([[1, "Legacy definition"]]),
          JSON.stringify([[1, ""]]),
          user,
          "Migration fixture"
        ]
      )
    ).rows[0].id as number
    await client.query(
      'update definitions set "currentRevisionId"=$1 where id=$2',
      [revision, definition]
    )
    await client.query(
      'update terms set "nextDefinitionNumber"=2 where id=$1',
      [term]
    )
    const publishedFile = randomUUID(),
      pendingFile = randomUUID()
    const bytes = Buffer.from(
      "Legacy term occurs in this immutable source document."
    )
    for (const id of [publishedFile, pendingFile])
      await client.query(
        'insert into "contributionFiles"(id,"uploadedById","termText","vocabularySlug",filename,"mediaType","byteSize","contentHash",bytes,role,title,caption,citation,origin) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          id,
          user,
          "legacy term",
          vocabulary,
          "legacy-source.txt",
          "text/plain",
          bytes.length,
          sha(bytes),
          bytes,
          "source",
          "Legacy source",
          "Original source caption",
          "Original citation",
          "paste"
        ]
      )
    const publishedExtraction = randomUUID(),
      correctedExtraction = randomUUID(),
      pendingExtraction = randomUUID()
    for (const [id, fileId] of [
      [publishedExtraction, publishedFile],
      [pendingExtraction, pendingFile]
    ])
      await client.query(
        'insert into "sourceExtractions"(id,"fileId",status,text,"textHash",pages,"hasOcr",method,"parserVersion","completedAt") values ($1,$2,\'ready\',$3,$4,\'[]\',false,\'text\',\'legacy-parser-v1\',now())',
        [id, fileId, bytes.toString(), sha(bytes)]
      )
    const corrected =
      "Legacy term occurs in this corrected immutable transcript."
    await client.query(
      'insert into "sourceExtractions"(id,"fileId",status,text,"textHash",pages,"hasOcr",method,"parserVersion","completedAt","parentExtractionId","correctedById") values ($1,$2,\'ready\',$3,$4,\'[]\',false,\'contributor-correction\',\'legacy-correction-v1\',now(),$5,$6)',
      [
        correctedExtraction,
        publishedFile,
        corrected,
        sha(corrected),
        publishedExtraction,
        user
      ]
    )
    const check = randomUUID()
    await client.query(
      "insert into \"sourceChecks\"(id,\"extractionId\",\"requestedById\",term,aliases,matches,passages,\"matcherVersion\") values ($1,$2,$3,$4,'[]','[]','[]','legacy-match-v1')",
      [check, correctedExtraction, user, "legacy term"]
    )
    await client.query(
      'update "contributionFiles" set "publishedRevisionId"=$1,"publishedExtractionId"=$2,"publishedAt"=now(),"contributorCited"=true where id=$3',
      [revision, correctedExtraction, publishedFile]
    )
    const snapshot = [
      {
        fileId: publishedFile,
        extractionId: correctedExtraction,
        checkId: check,
        title: "Legacy source",
        origin: "paste",
        fileHash: sha(bytes),
        extractionTextHash: sha(corrected),
        text: corrected,
        textHash: sha(corrected),
        mode: "full",
        term: "legacy term",
        aliases: [],
        matches: [],
        locations: [],
        parserVersion: "legacy-correction-v1",
        hasOcr: false,
        ocrReviewed: false,
        extractedAt: "2026-10-01T00:00:00.000Z",
        checkedAt: "2026-10-01T00:00:00.000Z",
        matcherVersion: "legacy-match-v1",
        ocrReviewRecordedAt: null,
        reviewerId: null,
        contextSelectedAt: "2026-10-01T00:00:00.000Z"
      }
    ]
    const suggestion = (
      await client.query(
        'insert into "aiContributionSuggestions"(intent,"requestedById","vocabularySlug","termText","suggestedDefinition","promptKey","promptHash","promptText",model,"sourceInputs",status,"outputDefinitionId","decidedAt") values (\'new_term\',$1,$2,$3,$4,$5,$6,$7,$8,$9,\'accepted\',$10,now()) returning id',
        [
          user,
          vocabulary,
          "legacy term",
          "Legacy definition",
          "migration-fixture",
          sha("fixture prompt"),
          "fixture prompt",
          "fixture-only-model",
          JSON.stringify(snapshot),
          definition
        ]
      )
    ).rows[0].id as number
    // These fixtures deliberately exercise bytea/TOAST storage, not compressible
    // repetitions. Real parsers have separate tests; this harness proves exact
    // storage migration across accepted formats and publication roles.
    const png = noisyPng()
    const docx = imageDocx(png)
    const extraFiles: { id: string; extraction: string | null }[] = []
    let totalBytes = bytes.length * 2
    const addFile = async (
      data: Buffer,
      mediaType: string,
      filename: string,
      role: "source" | "example",
      status?: "ready" | "queued" | "processing" | "failed",
      published = false
    ) => {
      const id = randomUUID()
      await client.query(
        'insert into "contributionFiles"(id,"uploadedById","termText","vocabularySlug",filename,"mediaType","byteSize","contentHash",bytes,role,title,caption,citation,origin) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,\'upload\')',
        [
          id,
          user,
          "legacy term",
          vocabulary,
          filename,
          mediaType,
          data.length,
          sha(data),
          data,
          role,
          `Fixture ${filename}`,
          "Original binary evidence",
          "Synthetic migration fixture"
        ]
      )
      totalBytes += data.length
      let extraction: string | null = null
      if (status) {
        extraction = randomUUID()
        if (status === "ready") {
          const text = `Legacy term extracted from ${filename}.`
          await client.query(
            'insert into "sourceExtractions"(id,"fileId",status,text,"textHash",pages,"hasOcr",method,"parserVersion","completedAt") values ($1,$2,\'ready\',$3,$4,\'[]\',false,\'fixture\',\'legacy-parser-v1\',now())',
            [extraction, id, text, sha(text)]
          )
        } else {
          await client.query(
            'insert into "sourceExtractions"(id,"fileId",status,"startedAt","completedAt",error,"forceOcr") values ($1,$2,$3,$4,$5,$6,$7)',
            [
              extraction,
              id,
              status,
              status === "queued" ? null : "2026-10-01T00:00:00Z",
              status === "failed" ? "2026-10-01T00:01:00Z" : null,
              status === "failed" ? "Legacy bounded failure" : null,
              mediaType === "application/pdf"
            ]
          )
        }
      }
      let example: number | null = null
      if (published && role === "example") {
        example = (
          await client.query(
            'insert into "definitionExamples"("definitionId","exampleNumber","sourceRevisionId",text,"authorId","actorKind") values ($1,$2,$3,$4,$5,\'human\') returning id',
            [
              definition,
              extraFiles.length + 1,
              revision,
              `Legacy example ${filename}`,
              user
            ]
          )
        ).rows[0].id
      }
      if (published)
        await client.query(
          'update "contributionFiles" set "publishedRevisionId"=$1,"publishedExtractionId"=$2,"publishedAt"=now(),"exampleId"=$3 where id=$4',
          [revision, status === "ready" ? extraction : null, example, id]
        )
      extraFiles.push({ id, extraction })
    }
    await addFile(
      png,
      "image/png",
      "legacy-example.png",
      "example",
      undefined,
      true
    )
    await addFile(
      jpegFixture,
      "image/jpeg",
      "legacy-example.jpg",
      "example",
      undefined,
      true
    )
    await addFile(
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "legacy-ready.docx",
      "source",
      "ready",
      true
    )
    await addFile(
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "legacy-queued.docx",
      "source",
      "queued"
    )
    // 96 MiB of independent, incompressible image content inside valid PDFs.
    for (let index = 0; index < 32; index++)
      await addFile(
        noisyPdf(),
        "application/pdf",
        `legacy-${index}.pdf`,
        index === 0 ? "example" : "source",
        index === 0
          ? undefined
          : (["ready", "queued", "processing", "failed"] as const)[index % 4],
        index === 0 || index % 4 === 0
      )
    await client.query("commit")
    assert(totalBytes > 100 * 1024 * 1024)
    assert(totalBytes < 110 * 1024 * 1024)
    const filesBefore = await fileManifest(client)
    const extractionsBefore = (
      await client.query('select * from "sourceExtractions" order by id')
    ).rows
    const checksBefore = (
      await client.query('select * from "sourceChecks" order by id')
    ).rows
    const suggestionBefore = (
      await client.query(
        'select * from "aiContributionSuggestions" where id=$1',
        [suggestion]
      )
    ).rows[0]
    const examplesBefore = (
      await client.query('select * from "definitionExamples" order by id')
    ).rows
    const schemaBefore = await schemaManifest(client)
    const ledgerBefore = (
      await client.query(
        "select * from drizzle.__drizzle_migrations order by id"
      )
    ).rows
    assert.equal(ledgerBefore.length, 69)
    const databaseBytesBefore = await databaseSize(observer)
    assert(
      databaseBytesBefore > totalBytes * 0.9,
      "Fixture must occupy real disk, not collapse under TOAST compression"
    )
    await copyFile(
      path.join(source, `${upgrade.tag}.sql`),
      path.join(directory, `${upgrade.tag}.sql`)
    )
    await writeFile(
      path.join(directory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: [...earlier, upgrade] })
    )
    const interruption = await interruptAssetCopy(
      connectionString,
      directory,
      observer
    )
    assert.deepEqual(
      await fileManifest(client),
      filesBefore,
      "Interrupted asset copy must preserve every original byte hash and field"
    )
    assert.deepEqual(
      await schemaManifest(client),
      schemaBefore,
      "Interrupted migration must restore columns, constraints, guards and functions"
    )
    assert.deepEqual(
      (
        await client.query(
          "select * from drizzle.__drizzle_migrations order by id"
        )
      ).rows,
      ledgerBefore,
      "Interrupted migration must not advance the ledger"
    )
    assert.deepEqual(
      (await client.query('select * from "sourceExtractions" order by id'))
        .rows,
      extractionsBefore
    )
    assert.deepEqual(
      (await client.query('select * from "sourceChecks" order by id')).rows,
      checksBefore
    )
    assert.deepEqual(
      (await client.query('select * from "definitionExamples" order by id'))
        .rows,
      examplesBefore
    )
    assert.deepEqual(
      (
        await client.query(
          'select * from "aiContributionSuggestions" where id=$1',
          [suggestion]
        )
      ).rows[0],
      suggestionBefore
    )
    const databaseBytesAfterRollback = await databaseSize(observer)
    const measured = await measureMigration(client, observer, directory)
    const filesAfter = (
      await client.query(
        'select to_jsonb(f)-\'bytes\' as metadata,bytes is null as "bytesAbsent" from "contributionFiles" f order by id'
      )
    ).rows
    const expectedExtractions = new Map([
      [publishedFile, correctedExtraction],
      [pendingFile, pendingExtraction],
      ...extraFiles.map(({ id, extraction }) => [id, extraction] as const)
    ])
    for (let i = 0; i < filesBefore.length; i++) {
      const before = filesBefore[i].metadata,
        after = filesAfter[i].metadata
      assert.equal(after.id, before.id)
      assert.equal(after.assetId, before.id)
      assert.equal(filesAfter[i].bytesAbsent, true)
      const asset = (
        await client.query(
          "select to_jsonb(a)-'bytes' as metadata,encode(sha256(bytes),'hex') as \"actualHash\" from \"contributionSourceAssets\" a where id=$1",
          [after.assetId]
        )
      ).rows[0]
      assert.equal(asset.actualHash, filesBefore[i].actualHash)
      assert.equal(asset.actualHash, before.contentHash)
      assert.equal(asset.metadata.contentHash, before.contentHash)
      assert.equal(asset.metadata.ownerId, before.uploadedById)
      assert.equal(asset.metadata.mediaType, before.mediaType)
      assert.equal(asset.metadata.byteSize, before.byteSize)
      assert.equal(asset.metadata.createdAt, before.createdAt)
      assert.equal(after.sourceExtractionId, expectedExtractions.get(after.id))
      const rest = without(after, ["assetId", "sourceExtractionId"])
      assert.deepEqual(
        rest,
        before,
        "Public file identity, metadata, citations and publication anchors survive"
      )
    }
    const extractionsAfter = (
      await client.query('select * from "sourceExtractions" order by id')
    ).rows
    assert.deepEqual(
      extractionsAfter.map((row) => without(row, ["assetId"])),
      extractionsBefore
    )
    for (const extraction of extractionsAfter)
      assert.equal(extraction.assetId, extraction.fileId)
    assert.deepEqual(
      (await client.query('select * from "definitionExamples" order by id'))
        .rows,
      examplesBefore
    )
    assert.deepEqual(
      (await client.query('select * from "sourceChecks" order by id')).rows,
      checksBefore
    )
    assert.deepEqual(
      (
        await client.query(
          'select * from "aiContributionSuggestions" where id=$1',
          [suggestion]
        )
      ).rows[0],
      suggestionBefore,
      "Accepted generation snapshot remains byte-for-byte JSON equivalent"
    )
    await assert.rejects(
      client.query(
        'update "contributionSourceAssets" set bytes=$1 where id=$2',
        [Buffer.from("changed"), publishedFile]
      ),
      /immutable/
    )
    await assert.rejects(
      client.query(
        "update \"contributionFiles\" set title='changed' where id=$1",
        [publishedFile]
      ),
      /immutable/
    )
    await assert.rejects(
      client.query(
        "update \"sourceExtractions\" set text='changed' where id=$1",
        [correctedExtraction]
      ),
      /immutable/
    )
    await assert.rejects(
      client.query("update \"sourceChecks\" set term='changed' where id=$1", [
        check
      ]),
      /immutable/
    )
    await assert.rejects(
      client.query(
        'update "aiContributionSuggestions" set "sourceInputs"=\'[]\' where id=$1',
        [suggestion]
      ),
      /immutable/
    )
    await migrate(drizzle(client), { migrationsFolder: directory })
    assert.equal(
      (
        await client.query(
          'select count(*)::int as count from "contributionSourceAssets"'
        )
      ).rows[0].count,
      filesBefore.length,
      "Migration rerun is idempotent"
    )
    assert.equal(
      (
        await client.query(
          "select count(*)::int as count from drizzle.__drizzle_migrations"
        )
      ).rows[0].count,
      70
    )
    const databaseBytesAfter = await databaseSize(observer)
    assert(
      Math.max(measured.peakDatabaseBytes, interruption.pausedDatabaseBytes) <
        totalBytes * 4 + 128 * 1024 * 1024,
      "Synthetic rehearsal must stay within a bounded physical database budget"
    )
    console.log(
      JSON.stringify(
        {
          event: "import_migration_rehearsal",
          transactionContract,
          files: filesBefore.length,
          payloadBytes: totalBytes,
          formats: [
            "text/plain",
            "application/pdf",
            "image/png",
            "image/jpeg",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ],
          roles: ["source", "example"],
          extractionStates: ["ready", "queued", "processing", "failed"],
          interruption,
          measured,
          databaseBytesBefore,
          databaseBytesAfterRollback,
          databaseBytesAfter,
          databaseGrowthBytes: databaseBytesAfter - databaseBytesBefore,
          vacuumRun: false,
          note: "Synthetic localhost rehearsal; observed database size excludes cluster-wide WAL and is not production sizing."
        },
        null,
        2
      )
    )
    console.log(
      "Populated import/source migration preserves bytes, identities, citations, corrections and accepted snapshots"
    )
  } finally {
    await client.end()
    await observer.end()
    await rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
