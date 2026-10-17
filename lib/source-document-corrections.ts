import "server-only"
import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { db, sourceExtractionsTable, usersTable } from "@yamz/db"
import { readContributionFile } from "./contribution-files"
import { SOURCE_MAX_CHARACTERS } from "./source-document-types"

const invalid = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message })
const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "This source is unavailable." })

/** Corrections are new immutable transcripts; uploaded bytes and prior checks
 * remain unchanged so a saved AI receipt still identifies its exact input. */
export async function correctOwnedSource(input: {
  fileId: string
  userId: number
  extractionId: string
  text: string
}) {
  const text = input.text.replace(/\r\n?/g, "\n")
  if (!text.trim() || text.length > SOURCE_MAX_CHARACTERS)
    throw invalid("Enter a transcript between 1 and 200,000 characters.")
  if (
    Buffer.from(text, "utf8").toString("utf8") !== text ||
    /[\u0000-\u0008\u000b\u000e-\u001f]/u.test(text)
  )
    throw invalid(
      "Enter readable Unicode text without binary control characters."
    )
  const textHash = createHash("sha256").update(text).digest("hex")
  return db.transaction(async (tx) => {
    // The account lock serializes correction/retry quotas and publication.
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, input.userId))
      .for("update")
    const file = await readContributionFile(input.fileId, input.userId, tx)
    if (
      !file ||
      file.role !== "source" ||
      file.uploadedById !== input.userId ||
      file.publishedRevisionId !== null
    )
      throw missing()
    const [parent] = await tx
      .select()
      .from(sourceExtractionsTable)
      .where(
        and(
          eq(sourceExtractionsTable.id, input.extractionId),
          eq(sourceExtractionsTable.fileId, input.fileId)
        )
      )
    if (!parent || parent.status !== "ready" || !parent.text)
      throw invalid(
        "Wait until this source has been read before correcting its transcript."
      )
    if (parent.text === text) return { extraction: parent }
    const [existing] = await tx
      .select()
      .from(sourceExtractionsTable)
      .where(
        and(
          eq(sourceExtractionsTable.fileId, input.fileId),
          eq(sourceExtractionsTable.parentExtractionId, parent.id),
          eq(sourceExtractionsTable.correctedById, input.userId),
          eq(sourceExtractionsTable.status, "ready"),
          eq(sourceExtractionsTable.textHash, textHash)
        )
      )
      .limit(1)
    if (existing?.text === text) return { extraction: existing }
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(sourceExtractionsTable)
      .where(eq(sourceExtractionsTable.fileId, input.fileId))
    if (count >= 5)
      throw invalid(
        "This source has reached its transcript version limit. Add a fresh source to continue."
      )
    const now = new Date().toISOString()
    const [extraction] = await tx
      .insert(sourceExtractionsTable)
      .values({
        fileId: file.id,
        status: "ready",
        forceOcr: false,
        text,
        textHash,
        pages: [
          {
            page: null,
            start: 0,
            end: text.length,
            method: "text",
            label: "Contributor-corrected transcript",
            confidence: null
          }
        ],
        hasOcr: parent.hasOcr,
        method: "contributor-correction",
        parserVersion: "contributor-transcript-v1",
        parentExtractionId: parent.id,
        correctedById: input.userId,
        createdAt: now,
        startedAt: now,
        completedAt: now
      })
      .returning()
    return { extraction }
  })
}
