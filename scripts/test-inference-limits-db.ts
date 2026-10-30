import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { eq, inArray, sql } from "drizzle-orm"
import {
  db,
  usersTable as users,
  inferenceRequestsTable as requests
} from "../drizzle"
import {
  inferenceRequestLimits,
  reserveInferenceRequest,
  releaseInferenceRequest,
  withInferenceBudget
} from "../lib/inference-admission"

const database = new URL(process.env.DATABASE_URL!)
assert.ok(
  ["localhost", "127.0.0.1"].includes(database.hostname) &&
    /security|_ci|scratch/.test(database.pathname),
  "Use an isolated local test database"
)

if (process.argv[2] === "--attempt") {
  reserveInferenceRequest(Number(process.argv[3]), 1000)
    .then((id) => {
      console.log(JSON.stringify({ id }))
      process.exit(0)
    })
    .catch((error) => {
      console.log(JSON.stringify({ code: error.code }))
      process.exit(error.code === "TOO_MANY_REQUESTS" ? 0 : 1)
    })
} else {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

function worker(userId: number): Promise<{ id?: string; code?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--conditions=react-server",
        "scripts/test-inference-limits-db.ts",
        "--attempt",
        String(userId)
      ],
      {
        env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=256" },
        stdio: ["ignore", "pipe", "pipe"]
      }
    )
    let output = "",
      errors = ""
    child.stdout.on("data", (data) => {
      output += data
    })
    child.stderr.on("data", (data) => {
      errors += data
    })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code !== 0)
        return reject(new Error(`Admission worker failed: ${errors}`))
      try {
        resolve(JSON.parse(output))
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function main() {
  const [existing] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(requests)
  assert.equal(
    existing.total,
    0,
    "Admission table must be empty in this isolated database"
  )
  const accounts = await db
    .insert(users)
    .values(
      Array.from({ length: 6 }, () => ({
        name: "Inference limit fixture",
        email: `${randomUUID()}@example.test`
      }))
    )
    .returning()
  const ids = accounts.map((a) => a.id)
  const clear = () => db.delete(requests).where(inArray(requests.userId, ids))
  Object.assign(process.env, {
    INFERENCE_USER_CONCURRENT_LIMIT: "1",
    INFERENCE_GLOBAL_CONCURRENT_LIMIT: "2",
    INFERENCE_USER_HOURLY_LIMIT: "3",
    INFERENCE_GLOBAL_HOURLY_LIMIT: "5"
  })
  const limited = (p: Promise<unknown>) =>
    assert.rejects(
      p,
      (error: { code?: string }) => error.code === "TOO_MANY_REQUESTS"
    )
  try {
    const results = await Promise.all(ids.map(worker))
    assert.equal(results.filter((r) => r.id).length, 2)
    assert.equal(
      results.filter((r) => r.code === "TOO_MANY_REQUESTS").length,
      4
    )
    console.log(
      "PASS: global admission serializes across six independent processes"
    )
    await clear()
    process.env.INFERENCE_GLOBAL_CONCURRENT_LIMIT = "4"
    const sameAccount = await Promise.all([
      worker(ids[0]),
      worker(ids[0]),
      worker(ids[0])
    ])
    assert.equal(sameAccount.filter((r) => r.id).length, 1)
    console.log("PASS: per-account concurrency survives independent processes")
    await clear()

    let calls = 0
    const provider = async () => {
      calls++
      return "synthetic response"
    }
    for (let i = 0; i < 3; i++)
      assert.equal(
        await withInferenceBudget(ids[0], 1000, provider),
        "synthetic response"
      )
    await limited(withInferenceBudget(ids[0], 1000, provider))
    assert.equal(calls, 3, "rejected admission must not call a provider")
    await withInferenceBudget(ids[1], 1000, provider)
    await withInferenceBudget(ids[2], 1000, provider)
    await limited(withInferenceBudget(ids[3], 1000, provider))
    assert.equal(calls, 5)
    console.log(
      "PASS: released requests retain per-user and shared hourly charges"
    )
    await clear()

    await assert.rejects(
      withInferenceBudget(ids[0], 1000, async () => {
        throw new Error("synthetic provider failure")
      }),
      /synthetic provider failure/
    )
    assert.equal(
      await withInferenceBudget(ids[0], 1000, async () => undefined),
      undefined
    )
    assert.equal(
      await withInferenceBudget(ids[0], 1000, provider),
      "synthetic response"
    )
    await limited(withInferenceBudget(ids[0], 1000, provider))
    const receipts = await db
      .select()
      .from(requests)
      .where(eq(requests.userId, ids[0]))
    assert.equal(receipts.length, 3)
    assert.ok(receipts.every((r) => r.releasedAt))
    console.log(
      "PASS: failure and invalid output release concurrency but retain rate charges"
    )
    await clear()

    const abandoned = await reserveInferenceRequest(ids[0], 300000)
    const [lease] = await db
      .select()
      .from(requests)
      .where(eq(requests.id, abandoned))
    assert.equal(
      Date.parse(lease.expiresAt) - Date.parse(lease.startedAt),
      360000
    )
    await limited(reserveInferenceRequest(ids[0], 1000))
    await db
      .update(requests)
      .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(requests.id, abandoned))
    const recovered = await reserveInferenceRequest(ids[0], 1000)
    await releaseInferenceRequest(recovered)
    await db
      .update(requests)
      .set({
        startedAt: sql`clock_timestamp() - interval '2 hours'`,
        expiresAt: sql`clock_timestamp() - interval '1 hour'`
      })
      .where(inArray(requests.userId, ids))
    await withInferenceBudget(ids[0], 1000, provider)
    assert.equal(
      (await db.select().from(requests).where(inArray(requests.userId, ids)))
        .length,
      1
    )
    console.log(
      "PASS: abandoned slots expire; rolling budgets recover; old receipts are pruned"
    )

    for (const bad of ["0", "-1", "NaN", "1.5", "10001"]) {
      assert.throws(
        () => inferenceRequestLimits({ INFERENCE_GLOBAL_HOURLY_LIMIT: bad }),
        /not configured correctly/
      )
    }
    await assert.rejects(reserveInferenceRequest(0, 1000), {
      code: "UNAUTHORIZED"
    })
    await assert.rejects(reserveInferenceRequest(ids[0], 300001), {
      code: "PRECONDITION_FAILED"
    })
    console.log("PASS: invalid limits, identity and timeout fail closed")
  } finally {
    await clear()
    await db.delete(users).where(inArray(users.id, ids))
  }
}
