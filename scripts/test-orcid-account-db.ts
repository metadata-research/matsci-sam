/*
 * Database checks for registering, connecting and disconnecting an ORCID iD. The
 * helpers open their own transactions, so the script creates its fixture
 * accounts directly and deletes them when it ends, and the deletion removes
 * their external authentication rows by cascade.
 */

import assert from "node:assert/strict"
import { randomBytes, randomInt } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"

if (!process.env.AUTH_TOKEN_ENCRYPTION_KEY?.trim())
  process.env.AUTH_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64")

// A random iD with a valid ISO 7064 11,2 check character, so fixtures cannot
// collide with an iD already connected in a development database.
const randomOrcidId = () => {
  const digits = Array.from({ length: 15 }, () => randomInt(10)).join("")
  let total = 0
  for (const digit of digits) total = (total + Number(digit)) * 2
  const check = (12 - (total % 11)) % 11
  const characters = `${digits}${check === 10 ? "X" : check}`
  return characters.match(/.{4}/g)!.join("-")
}

const tokensFor = (orcidId: string, name = "Fixture Researcher") => ({
  orcidId,
  name,
  accessToken: `access-${orcidId}`,
  refreshToken: `refresh-${orcidId}`,
  scope: "openid",
  expiresIn: 631138518
})

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const { db, oauthAccountsTable, usersTable, communityMembersTable } =
    await import("../drizzle")
  const {
    connectOrcidAccount,
    disconnectOrcidAccount,
    findOrcidAccountUserId,
    registerOrcidAccount,
    OrcidAccountError
  } = await import("../lib/orcid-account")
  const { isValidOrcidId } = await import("../lib/orcid")
  const { decryptAuthToken } = await import("../lib/secret-crypto")

  const stamp = Date.now().toString(36)
  const now = new Date().toISOString()
  const created: number[] = []
  const signupSubjects: string[] = []
  const signupSubject = () => {
    const subject = randomOrcidId()
    signupSubjects.push(subject)
    return subject
  }
  const createUser = async (
    values: Partial<typeof usersTable.$inferInsert>
  ) => {
    const [user] = await db
      .insert(usersTable)
      .values({ name: `ORCID account test ${stamp}`, ...values })
      .returning({ id: usersTable.id })
    created.push(user.id)
    return user.id
  }
  const orcidRows = (userId: number) =>
    db
      .select()
      .from(oauthAccountsTable)
      .where(
        and(
          eq(oauthAccountsTable.userId, userId),
          eq(oauthAccountsTable.provider, "orcid")
        )
      )
  const orcidIdOf = async (userId: number) =>
    (
      await db
        .select({ orcidId: usersTable.orcidId })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
    )[0]?.orcidId
  const usersWithOrcid = (orcidId: string) =>
    db.select().from(usersTable).where(eq(usersTable.orcidId, orcidId))
  const connectionsWithOrcid = (orcidId: string) =>
    db
      .select()
      .from(oauthAccountsTable)
      .where(
        and(
          eq(oauthAccountsTable.provider, "orcid"),
          eq(oauthAccountsTable.subject, orcidId)
        )
      )

  try {
    const first = randomOrcidId()
    const second = randomOrcidId()
    const third = randomOrcidId()
    assert.ok([first, second, third].every(isValidOrcidId))

    const named = await createUser({
      name: "Chosen Display Name",
      firstName: "Ada",
      lastName: "Fixture",
      googleId: `orcid-test-google-${stamp}`
    })
    const unnamed = await createUser({
      name: null,
      email: `orcid-test-${stamp}@example.test`,
      emailVerifiedAt: now
    })
    const orcidOnly = await createUser({})
    const model = await createUser({ isAi: true })

    // Connecting records the iD and one encrypted token row, keeps a chosen
    // display name, and reports a complete profile.
    const connected = await connectOrcidAccount({
      userId: named,
      tokens: tokensFor(first, "Name From ORCID")
    })
    assert.deepEqual(connected, { userId: named, needsProfile: false })
    assert.equal(await orcidIdOf(named), first)
    const [row] = await orcidRows(named)
    assert.equal(row.subject, first)
    assert.ok(row.accessTokenEncrypted)
    assert.notEqual(row.accessTokenEncrypted, `access-${first}`)
    assert.equal(decryptAuthToken(row.accessTokenEncrypted), `access-${first}`)
    assert.ok(row.expiresAt)
    const [{ name }] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, named))
    assert.equal(name, "Chosen Display Name")
    assert.equal(await findOrcidAccountUserId(first), named)

    // Signing in again with the same iD refreshes the row without adding one.
    await connectOrcidAccount({ userId: named, tokens: tokensFor(first) })
    assert.equal((await orcidRows(named)).length, 1)

    // One iD belongs to one account, and one account holds one iD.
    await assert.rejects(
      connectOrcidAccount({ userId: unnamed, tokens: tokensFor(first) }),
      /already connected to another account/
    )
    await assert.rejects(
      connectOrcidAccount({ userId: named, tokens: tokensFor(second) }),
      /Disconnect the current ORCID iD/
    )
    assert.equal(await orcidIdOf(unnamed), null)

    // An account without a name takes the ORCID name and still needs its
    // profile completed.
    const unnamedResult = await connectOrcidAccount({
      userId: unnamed,
      tokens: tokensFor(second, "Name From ORCID")
    })
    assert.deepEqual(unnamedResult, { userId: unnamed, needsProfile: true })
    const [{ name: takenName }] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, unnamed))
    assert.equal(takenName, "Name From ORCID")

    // A model account never takes an iD.
    await assert.rejects(
      connectOrcidAccount({ userId: model, tokens: tokensFor(third) }),
      /Account not found/
    )
    assert.equal(await findOrcidAccountUserId(third), undefined)

    // ORCID cannot be removed while it is the only way to sign in.
    await connectOrcidAccount({ userId: orcidOnly, tokens: tokensFor(third) })
    await assert.rejects(
      disconnectOrcidAccount(orcidOnly),
      /ORCID is your only sign-in method and cannot be disconnected/
    )
    assert.equal(await orcidIdOf(orcidOnly), third)

    // Disconnecting clears the iD and the token row, for a Google account and
    // for one with a verified email.
    await disconnectOrcidAccount(named)
    assert.equal(await orcidIdOf(named), null)
    assert.equal((await orcidRows(named)).length, 0)
    assert.equal(await findOrcidAccountUserId(first), undefined)
    await disconnectOrcidAccount(unnamed)
    assert.equal(await orcidIdOf(unnamed), null)

    // A disconnected iD can then be connected to another account.
    await connectOrcidAccount({ userId: unnamed, tokens: tokensFor(first) })
    assert.equal(await findOrcidAccountUserId(first), unnamed)

    // Signup needs no email and preserves the privacy, permissions and
    // membership defaults of an ordinary account.
    const signupId = signupSubject()
    const signup = await registerOrcidAccount({
      tokens: tokensFor(signupId, "Signup Researcher")
    })
    created.push(signup.userId)
    assert.deepEqual(signup, {
      userId: signup.userId,
      isNewAccount: true,
      needsProfile: true
    })
    const [signupUser] = await usersWithOrcid(signupId)
    assert.equal(signupUser.id, signup.userId)
    assert.equal(signupUser.name, "Signup Researcher")
    assert.equal(signupUser.email, null)
    assert.equal(signupUser.emailVerifiedAt, null)
    assert.equal(signupUser.googleId, null)
    assert.equal(signupUser.firstName, null)
    assert.equal(signupUser.lastName, null)
    assert.equal(signupUser.affiliation, null)
    assert.equal(signupUser.isAi, false)
    assert.equal(signupUser.role, "user")
    assert.equal(signupUser.isProfilePublic, false)
    assert.equal(signupUser.activeCommunityId, null)
    assert.equal(signupUser.notifications, false)
    const membership = await db
      .select({ id: communityMembersTable.id })
      .from(communityMembersTable)
      .where(eq(communityMembersTable.userId, signup.userId))
    assert.equal(membership.length, 0)
    const [signupConnection] = await orcidRows(signup.userId)
    assert.equal(signupConnection.subject, signupId)
    assert.ok(signupConnection.accessTokenEncrypted)
    assert.ok(signupConnection.refreshTokenEncrypted)
    assert.notEqual(signupConnection.accessTokenEncrypted, `access-${signupId}`)
    assert.notEqual(
      signupConnection.refreshTokenEncrypted,
      `refresh-${signupId}`
    )
    assert.equal(
      decryptAuthToken(signupConnection.accessTokenEncrypted),
      `access-${signupId}`
    )
    assert.equal(
      decryptAuthToken(signupConnection.refreshTokenEncrypted),
      `refresh-${signupId}`
    )
    assert.equal(signupConnection.scope, "openid")
    assert.ok(signupConnection.expiresAt)
    assert.equal(await findOrcidAccountUserId(signupId), signup.userId)
    await assert.rejects(
      disconnectOrcidAccount(signup.userId),
      /ORCID is your only sign-in method and cannot be disconnected/
    )

    // Choosing signup again uses the existing account and refreshes its
    // encrypted tokens without overwriting the person's chosen profile.
    await db
      .update(usersTable)
      .set({
        name: "Chosen Signup Name",
        firstName: "Chosen",
        lastName: "Researcher"
      })
      .where(eq(usersTable.id, signup.userId))
    const repeated = await registerOrcidAccount({
      tokens: {
        ...tokensFor(signupId, "Replacement Provider Name"),
        accessToken: "replacement-access",
        refreshToken: "replacement-refresh"
      }
    })
    assert.deepEqual(repeated, {
      userId: signup.userId,
      isNewAccount: false,
      needsProfile: false
    })
    const repeatedUsers = await usersWithOrcid(signupId)
    assert.equal(repeatedUsers.length, 1)
    assert.equal(repeatedUsers[0].name, "Chosen Signup Name")
    const repeatedConnections = await orcidRows(signup.userId)
    assert.equal(repeatedConnections.length, 1)
    assert.equal(
      decryptAuthToken(repeatedConnections[0].accessTokenEncrypted!),
      "replacement-access"
    )

    // Existing linked accounts use that same account through signup too.
    const linkedSignup = await registerOrcidAccount({
      tokens: tokensFor(first)
    })
    assert.equal(linkedSignup.userId, unnamed)
    assert.equal(linkedSignup.isNewAccount, false)
    assert.equal((await usersWithOrcid(first)).length, 1)

    // Simultaneous signups for one authenticated subject produce one account
    // and one connection, with exactly one caller reporting account creation.
    const concurrentId = signupSubject()
    const concurrent = await Promise.allSettled([
      registerOrcidAccount({ tokens: tokensFor(concurrentId) }),
      registerOrcidAccount({ tokens: tokensFor(concurrentId) })
    ])
    const concurrentResults = concurrent.map((result) => {
      if (result.status === "rejected") throw result.reason
      created.push(result.value.userId)
      return result.value
    })
    assert.equal(concurrentResults[0].userId, concurrentResults[1].userId)
    assert.equal(
      concurrentResults.filter((result) => result.isNewAccount).length,
      1
    )
    assert.equal((await usersWithOrcid(concurrentId)).length, 1)
    assert.equal((await connectionsWithOrcid(concurrentId)).length, 1)

    // Connect and disconnect must use the same lock order. Either operation
    // can win, but the public iD and encrypted identity must stay consistent.
    const racingUser = await createUser({
      googleId: `orcid-race-google-${stamp}`
    })
    const racingId = randomOrcidId()
    for (const initiallyConnected of [false, true, false, true]) {
      await disconnectOrcidAccount(racingUser)
      if (initiallyConnected)
        await connectOrcidAccount({
          userId: racingUser,
          tokens: tokensFor(racingId)
        })
      const outcomes = await Promise.allSettled([
        connectOrcidAccount({
          userId: racingUser,
          tokens: tokensFor(racingId)
        }),
        disconnectOrcidAccount(racingUser)
      ])
      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") continue
        assert.ok(
          outcome.reason instanceof OrcidAccountError,
          "No database error or deadlock is allowed"
        )
        assert.match(outcome.reason.message, /connection changed/)
      }
      const finalId = await orcidIdOf(racingUser)
      const finalConnections = await orcidRows(racingUser)
      if (finalId === null) assert.equal(finalConnections.length, 0)
      else {
        assert.equal(finalId, racingId)
        assert.equal(finalConnections.length, 1)
        assert.equal(finalConnections[0].subject, racingId)
        assert.equal(finalConnections[0].userId, racingUser)
      }
    }

    // A failed encryption operation cannot leave a passwordless orphan user
    // or an unencrypted provider connection behind.
    const failedId = signupSubject()
    const encryptionKey = process.env.AUTH_TOKEN_ENCRYPTION_KEY
    try {
      process.env.AUTH_TOKEN_ENCRYPTION_KEY = "invalid-test-key"
      await assert.rejects(
        registerOrcidAccount({ tokens: tokensFor(failedId) }),
        /AUTH_TOKEN_ENCRYPTION_KEY/
      )
    } finally {
      if (encryptionKey === undefined)
        delete process.env.AUTH_TOKEN_ENCRYPTION_KEY
      else process.env.AUTH_TOKEN_ENCRYPTION_KEY = encryptionKey
    }
    assert.equal((await usersWithOrcid(failedId)).length, 0)
    assert.equal((await connectionsWithOrcid(failedId)).length, 0)

    // Signup never turns an AI identity into a human account or takes over a
    // provider connection whose ownership disagrees with the user record.
    const aiId = signupSubject()
    await db
      .update(usersTable)
      .set({ orcidId: aiId })
      .where(eq(usersTable.id, model))
    await assert.rejects(registerOrcidAccount({ tokens: tokensFor(aiId) }))
    assert.equal(await findOrcidAccountUserId(aiId), undefined)
    assert.equal((await connectionsWithOrcid(aiId)).length, 0)
    const conflictId = signupSubject()
    const conflictingUser = await createUser({ orcidId: conflictId })
    const connectionOwner = await createUser({})
    await db.insert(oauthAccountsTable).values({
      userId: connectionOwner,
      provider: "orcid",
      subject: conflictId
    })
    await assert.rejects(
      registerOrcidAccount({ tokens: tokensFor(conflictId) })
    )
    assert.equal(await orcidIdOf(conflictingUser), conflictId)
    assert.equal(await orcidIdOf(connectionOwner), null)
    const [conflictConnection] = await connectionsWithOrcid(conflictId)
    assert.equal(conflictConnection.userId, connectionOwner)
    assert.equal(conflictConnection.accessTokenEncrypted, null)
  } finally {
    // Also clean up a partially written signup if a regression causes an
    // assertion to fail before its returned account ID can be recorded.
    if (signupSubjects.length) {
      const signupUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.orcidId, signupSubjects))
      created.push(...signupUsers.map((user) => user.id))
    }
    if (created.length)
      await db.delete(usersTable).where(inArray(usersTable.id, created))
  }

  const leftover = await db
    .select({ id: oauthAccountsTable.id })
    .from(oauthAccountsTable)
    .where(inArray(oauthAccountsTable.userId, created))
  assert.equal(leftover.length, 0)

  console.log("ORCID account database checks passed.")
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
