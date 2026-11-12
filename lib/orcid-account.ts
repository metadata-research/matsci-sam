import "server-only"

import { db, oauthAccountsTable, usersTable } from "@yamz/db"
import { and, eq, sql } from "drizzle-orm"
import { isValidOrcidId } from "@/lib/orcid"
import { encryptAuthToken } from "@/lib/secret-crypto"

// A refusal the person can act on. The routes show its message. Any other
// error, such as a database error, gets a general message instead, because its
// text can include the query and its parameters.
export class OrcidAccountError extends Error {}

type OrcidAccountTokens = {
  orcidId: string
  name: string
  accessToken: string
  refreshToken?: string
  scope?: string
  expiresIn?: number
}

const tokenExpiry = (expiresIn?: number) => {
  if (!expiresIn || !Number.isFinite(expiresIn) || expiresIn <= 0) return null
  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

type AccountTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function lockOrcidSubject(tx: AccountTransaction, orcidId: string) {
  if (!isValidOrcidId(orcidId))
    throw new OrcidAccountError("ORCID did not return a valid authenticated iD")
  // Signup and account connection serialize the same subject. Unique indexes
  // remain the final ownership boundary for legacy or independent writers.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"orcid:" + orcidId}, 0))`
  )
}

async function connectOrcidInTransaction(
  tx: AccountTransaction,
  userId: number,
  tokens: OrcidAccountTokens
) {
  const [user] = await tx
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1)
    .for("update")
  if (!user || user.isAi) throw new OrcidAccountError("Account not found")
  if (user.orcidId && user.orcidId !== tokens.orcidId)
    throw new OrcidAccountError(
      "Disconnect the current ORCID iD before connecting another"
    )

  const [subjectOwner] = await tx
    .select({ userId: oauthAccountsTable.userId })
    .from(oauthAccountsTable)
    .where(
      and(
        eq(oauthAccountsTable.provider, "orcid"),
        eq(oauthAccountsTable.subject, tokens.orcidId)
      )
    )
    .limit(1)
  if (subjectOwner && subjectOwner.userId !== userId)
    throw new OrcidAccountError(
      "That ORCID iD is already connected to another account"
    )

  const [existingConnection] = await tx
    .select()
    .from(oauthAccountsTable)
    .where(
      and(
        eq(oauthAccountsTable.userId, userId),
        eq(oauthAccountsTable.provider, "orcid")
      )
    )
    .limit(1)
  if (existingConnection && existingConnection.subject !== tokens.orcidId)
    throw new OrcidAccountError(
      "Disconnect the current ORCID iD before connecting another"
    )

  const now = new Date().toISOString()
  const values = {
    userId,
    provider: "orcid",
    subject: tokens.orcidId,
    accessTokenEncrypted: encryptAuthToken(tokens.accessToken),
    refreshTokenEncrypted: tokens.refreshToken
      ? encryptAuthToken(tokens.refreshToken)
      : null,
    scope: tokens.scope || null,
    expiresAt: tokenExpiry(tokens.expiresIn),
    updatedAt: now
  }

  if (existingConnection)
    await tx
      .update(oauthAccountsTable)
      .set(values)
      .where(eq(oauthAccountsTable.id, existingConnection.id))
  else await tx.insert(oauthAccountsTable).values(values)

  await tx
    .update(usersTable)
    .set({
      orcidId: tokens.orcidId,
      name: user.name || tokens.name || null
    })
    .where(eq(usersTable.id, userId))

  return { userId, needsProfile: !user.firstName || !user.lastName }
}

export const connectOrcidAccount = async ({
  userId,
  tokens
}: {
  userId: number
  tokens: OrcidAccountTokens
}) =>
  db.transaction(async (tx) => {
    await lockOrcidSubject(tx, tokens.orcidId)
    return connectOrcidInTransaction(tx, userId, tokens)
  })

// Call only after a verified OAuth exchange with explicit signup intent.
// ORCID authenticates the iD, not an email address. Never infer or merge an
// email identity, membership, role, or profile visibility from these claims.
export const registerOrcidAccount = async ({
  tokens
}: {
  tokens: OrcidAccountTokens
}) =>
  db.transaction(async (tx) => {
    await lockOrcidSubject(tx, tokens.orcidId)
    const [existing] = await tx
      .select({ id: usersTable.id, isAi: usersTable.isAi })
      .from(usersTable)
      .where(eq(usersTable.orcidId, tokens.orcidId))
      .limit(1)
    if (existing?.isAi) throw new OrcidAccountError("Account not found")
    let userId = existing?.id
    if (!userId) {
      const [created] = await tx
        .insert(usersTable)
        .values({ name: tokens.name || "", orcidId: tokens.orcidId })
        .returning({ id: usersTable.id })
      userId = created.id
    }
    const connected = await connectOrcidInTransaction(tx, userId, tokens)
    return { ...connected, isNewAccount: !existing }
  })

export const findOrcidAccountUserId = async (orcidId: string) => {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.orcidId, orcidId), eq(usersTable.isAi, false)))
    .limit(1)
  return user?.id
}

export const disconnectOrcidAccount = async (userId: number) =>
  db.transaction(async (tx) => {
    const [connection] = await tx
      .select({ orcidId: usersTable.orcidId })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.isAi, false)))
      .limit(1)
    if (!connection) throw new OrcidAccountError("Account not found")
    // Use the same subject-then-user lock order as signup and connection.
    // Taking the user lock first could deadlock with either operation.
    if (connection.orcidId) await lockOrcidSubject(tx, connection.orcidId)

    const [user] = await tx
      .select({
        orcidId: usersTable.orcidId,
        googleId: usersTable.googleId,
        emailVerifiedAt: usersTable.emailVerifiedAt
      })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.isAi, false)))
      .limit(1)
      .for("update")
    if (!user) throw new OrcidAccountError("Account not found")
    // The initial read does not hold a row lock. Refuse a stale disconnect
    // rather than clearing a different connection established while waiting.
    if (user.orcidId !== connection.orcidId)
      throw new OrcidAccountError(
        "Your ORCID connection changed. Check your profile and try again."
      )
    if (!user.googleId && !user.emailVerifiedAt)
      throw new OrcidAccountError(
        "ORCID is your only sign-in method and cannot be disconnected."
      )

    await tx
      .delete(oauthAccountsTable)
      .where(
        and(
          eq(oauthAccountsTable.userId, userId),
          eq(oauthAccountsTable.provider, "orcid")
        )
      )
    await tx
      .update(usersTable)
      .set({ orcidId: null })
      .where(eq(usersTable.id, userId))
  })
