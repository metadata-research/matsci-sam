// Executes the real completion handler with PostgreSQL and isolated sessions.
// No mail, external identity provider or model request is made.
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { randomUUID } from "node:crypto"
import ts from "typescript"
import * as orm from "drizzle-orm"
import * as database from "../drizzle"
import * as emailAuth from "../lib/email-auth"
import * as confirmation from "../lib/email-auth-confirmation"
import * as authReturn from "../lib/auth-return"
import type { YAMZSession } from "../lib/types"

const { db, usersTable: users, emailAuthTokensTable: tokens } = database
const { eq, inArray } = orm
const origin = "http://localhost:3110"
const code = ts.transpileModule(
  readFileSync("app/api/auth/email/verify/route.ts", "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS
    }
  }
).outputText
function browser(id?: number) {
  const session: YAMZSession & { save: () => Promise<void> } = {
    id,
    save: async () => {}
  }
  const exports = {} as { POST: (request: Request) => Promise<Response> }
  const dependencies: Record<string, unknown> = {
    "@yamz/db": database,
    "drizzle-orm": orm,
    "@/lib/email-auth": {
      ...emailAuth,
      isEmailAuthEnabled: () => true,
      getAuthSiteUrl: () => new URL(origin)
    },
    "@/lib/session": { getSession: async () => session },
    "@/lib/auth-return": authReturn,
    "@/lib/email-auth-confirmation": confirmation
  }
  runInNewContext(code, {
    exports,
    Response,
    Date,
    require(name: string) {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected dependency ${name}`
      )
      return dependencies[name]
    }
  })
  return {
    session,
    post: async (
      input: unknown,
      headers: Record<string, string> = {
        origin,
        "content-type": "application/json"
      }
    ) => {
      const response = await exports.POST(
        new Request(origin + "/api/auth/email/verify", {
          method: "POST",
          headers,
          body: JSON.stringify(input)
        })
      )
      return {
        status: response.status,
        body: await response.json().catch(() => null)
      }
    }
  }
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      /security|_ci|scratch/.test(url.pathname),
    "Use an isolated local test database"
  )
  const stamp = randomUUID()
  const addresses = [
    `owner-${stamp}@example.test`,
    `visitor-${stamp}@example.test`,
    `new-${stamp}@example.test`
  ]
  const [owner, visitor] = await db
    .insert(users)
    .values(
      addresses
        .slice(0, 2)
        .map((email) => ({ name: "Confirmation test", email }))
    )
    .returning()
  const pending = new Map<string, string>()
  async function link(
    email = addresses[0],
    returnTo: string | null = null,
    signup = false,
    expired = false
  ) {
    const token = emailAuth.createEmailAuthToken()
    const digest = emailAuth.hashEmailAuthToken(token, returnTo)
    pending.set(token, digest)
    await db.insert(tokens).values({
      tokenHash: digest,
      email,
      allowAccountCreation: signup,
      expiresAt: new Date(
        Date.now() + (expired ? -60000 : 600000)
      ).toISOString()
    })
    return { token, returnTo }
  }
  const unused = async (token: string) =>
    (
      await db.query.emailAuthTokensTable.findFirst({
        where: eq(tokens.tokenHash, pending.get(token)!)
      })
    )?.usedAt === null
  try {
    const input = await link(),
      victim = browser(visitor.id)
    assert.equal(
      (await victim.post({ ...input, action: "confirm", challenge: "forged" }))
        .status,
      409
    )
    assert.equal((await victim.post(input)).status, 400)
    assert.equal(victim.session.id, visitor.id)
    assert.ok(await unused(input.token))
    const prepared = await victim.post({ ...input, action: "prepare" })
    assert.equal(prepared.status, 200)
    assert.equal(prepared.body.email, addresses[0])
    assert.equal(prepared.body.switchesAccount, true)
    assert.equal(
      victim.session.id,
      visitor.id,
      "opening the link must not switch accounts"
    )
    assert.ok(await unused(input.token), "preview must not consume the link")
    const confirm = {
      ...input,
      action: "confirm",
      challenge: prepared.body.challenge
    }
    assert.equal(
      (await browser(visitor.id).post(confirm)).status,
      409,
      "challenge cannot move to another browser"
    )
    victim.session.id = owner.id
    assert.equal(
      (await victim.post(confirm)).status,
      409,
      "identity changed since preview"
    )
    victim.session.id = visitor.id
    assert.equal(
      (await victim.post({ ...confirm, challenge: "wrong" })).status,
      409
    )
    assert.ok(await unused(input.token))
    assert.equal((await victim.post(confirm)).status, 200)
    assert.equal(victim.session.id, owner.id)
    assert.equal(victim.session.emailAuthConfirmation, undefined)
    assert.equal((await victim.post(confirm)).status, 409)
    assert.equal(
      (await browser().post({ ...input, action: "prepare" })).status,
      400
    )
    console.log(
      "PASS: no automatic account switch; browser, identity and challenge binding; single use"
    )

    const rejectedHeaders: Record<string, string>[] = [
      { "content-type": "application/json" },
      {
        origin: "https://attacker.example",
        "content-type": "application/json"
      },
      { origin: "null", "content-type": "application/json" },
      { origin, "content-type": "text/plain" }
    ]
    for (const headers of rejectedHeaders) {
      const fresh = await link()
      const result = await browser().post(
        { ...fresh, action: "prepare" },
        headers
      )
      assert.ok([403, 415].includes(result.status))
      assert.ok(await unused(fresh.token))
    }
    assert.equal((await browser().post(null)).status, 400)
    const expired = await link(addresses[0], null, false, true)
    assert.equal(
      (await browser().post({ ...expired, action: "prepare" })).status,
      400
    )
    console.log(
      "PASS: malformed bodies, cross-origin/plain-text requests and expired links rejected"
    )

    const destination = `/invite/${"z".repeat(43)}`
    const signup = await link(addresses[2], destination, true)
    const device = browser()
    assert.equal(
      (await device.post({ ...signup, returnTo: "/setup", action: "prepare" }))
        .status,
      400
    )
    const preview = await device.post({ ...signup, action: "prepare" })
    assert.equal(preview.body.createsAccount, true)
    assert.equal(
      await db.query.usersTable.findFirst({
        where: eq(users.email, addresses[2])
      }),
      undefined
    )
    device.session.emailAuthConfirmation!.expiresAt = Date.now() - 1
    assert.equal(
      (
        await device.post({
          ...signup,
          action: "confirm",
          challenge: preview.body.challenge
        })
      ).status,
      409
    )
    assert.ok(await unused(signup.token))
    const renewed = await device.post({ ...signup, action: "prepare" })
    const result = await device.post({
      ...signup,
      action: "confirm",
      challenge: renewed.body.challenge
    })
    assert.equal(
      result.body.redirectTo,
      authReturn.profileCompletionPath(destination)
    )
    assert.ok(device.session.id)
    console.log(
      "PASS: cross-device signup retains invitation; preview creates no account; expired confirmation can be renewed"
    )

    const simultaneous = await link()
    const first = browser(),
      second = browser()
    const previews = await Promise.all(
      [first, second].map((b) => b.post({ ...simultaneous, action: "prepare" }))
    )
    const results = await Promise.all(
      [first, second].map((b, i) =>
        b.post({
          ...simultaneous,
          action: "confirm",
          challenge: previews[i].body.challenge
        })
      )
    )
    assert.deepEqual(
      results.map((r) => r.status).sort(),
      [200, 400],
      "only one concurrent token claim wins"
    )
    console.log("PASS: concurrent confirmations claim the token once")
  } finally {
    await db.delete(tokens).where(inArray(tokens.email, addresses))
    await db.delete(users).where(inArray(users.email, addresses))
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
