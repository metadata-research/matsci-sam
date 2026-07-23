import "server-only"

import { db, oauthAccountsTable, usersTable } from "@yamz/db"
import { and, eq } from "drizzle-orm"
import { encryptAuthToken } from "@/lib/secret-crypto"

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

export const connectOrcidAccount = async ({
  userId,
  tokens
}: {
  userId: number
  tokens: OrcidAccountTokens
}) =>
  db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1)
    if (!user || user.isAi) throw new Error("Account not found")

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
      throw new Error("That ORCID iD is already connected to another account")

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
      throw new Error(
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

    return userId
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
    const [user] = await tx
      .select({
        googleId: usersTable.googleId,
        emailVerifiedAt: usersTable.emailVerifiedAt
      })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.isAi, false)))
      .limit(1)
    if (!user) throw new Error("Account not found")
    if (!user.googleId && !user.emailVerifiedAt)
      throw new Error(
        "Add another sign-in method before disconnecting your ORCID iD"
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
