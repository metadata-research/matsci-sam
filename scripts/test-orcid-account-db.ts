/*
 * Database checks for connecting, reusing and disconnecting an ORCID iD. The
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

  const { db, oauthAccountsTable, usersTable } = await import("../drizzle")
  const {
    connectOrcidAccount,
    disconnectOrcidAccount,
    findOrcidAccountUserId
  } = await import("../lib/orcid-account")
  const { isValidOrcidId } = await import("../lib/orcid")
  const { decryptAuthToken } = await import("../lib/secret-crypto")

  const stamp = Date.now().toString(36)
  const now = new Date().toISOString()
  const created: number[] = []
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
      /Add another sign-in method/
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
  } finally {
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
