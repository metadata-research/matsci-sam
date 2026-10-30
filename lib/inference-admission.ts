import "server-only"
import { randomUUID } from "node:crypto"
import { TRPCError } from "@trpc/server"
import { and, eq, lte, sql } from "drizzle-orm"
import { db, inferenceRequestsTable as requests } from "@yamz/db"

export function inferenceRequestLimits(
  env: Record<string, string | undefined> = process.env
) {
  const read = (key: string, fallback: number, maximum: number) => {
    const value = Number(env[key]?.trim() || fallback)
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "AI request limits are not configured correctly."
      })
    return value
  }
  return {
    userConcurrent: read("INFERENCE_USER_CONCURRENT_LIMIT", 1, 32),
    globalConcurrent: read("INFERENCE_GLOBAL_CONCURRENT_LIMIT", 4, 64),
    userHourly: read("INFERENCE_USER_HOURLY_LIMIT", 20, 1000),
    globalHourly: read("INFERENCE_GLOBAL_HOURLY_LIMIT", 200, 10000)
  }
}

export async function reserveInferenceRequest(
  userId: number,
  timeoutMs: number
) {
  if (!Number.isSafeInteger(userId) || userId < 1)
    throw new TRPCError({ code: "UNAUTHORIZED" })
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Invalid inference timeout."
    })
  const limits = inferenceRequestLimits()
  return db.transaction(async (tx) => {
    // One short transaction across all accounts/providers/processes. Provider
    // work starts only after this commits; it never holds the admission lock.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('matsci-sam:inference-admission'), 0)`
    )
    const clock = await tx.execute<{ now: string }>(
      sql`select clock_timestamp()::text as now`
    )
    const now = new Date(clock.rows[0].now)
    const cutoff = new Date(now.getTime() - 3600000).toISOString()
    await tx
      .delete(requests)
      .where(
        and(
          lte(requests.startedAt, cutoff),
          lte(requests.expiresAt, now.toISOString())
        )
      )
    const [usage] = await tx
      .select({
        hourly:
          sql<number>`count(*) filter (where ${requests.startedAt} > ${cutoff})`.mapWith(
            Number
          ),
        userHourly:
          sql<number>`count(*) filter (where ${requests.startedAt} > ${cutoff} and ${requests.userId} = ${userId})`.mapWith(
            Number
          ),
        active:
          sql<number>`count(*) filter (where ${requests.releasedAt} is null and ${requests.expiresAt} > ${now.toISOString()})`.mapWith(
            Number
          ),
        userActive:
          sql<number>`count(*) filter (where ${requests.releasedAt} is null and ${requests.expiresAt} > ${now.toISOString()} and ${requests.userId} = ${userId})`.mapWith(
            Number
          )
      })
      .from(requests)
    const message =
      usage.userActive >= limits.userConcurrent
        ? "An AI request is already running for your account. Wait for it to finish before trying again."
        : usage.active >= limits.globalConcurrent
          ? "AI requests are busy. Try again shortly."
          : usage.userHourly >= limits.userHourly
            ? "You have reached the hourly AI request limit. Try again later."
            : usage.hourly >= limits.globalHourly
              ? "The hourly AI request limit for the site has been reached. Try again later."
              : null
    if (message) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message })
    const id = randomUUID()
    // The provider deadline is at most five minutes. An extra minute covers
    // token exchange and cancellation; a crashed process cannot hold a slot forever.
    await tx.insert(requests).values({
      id,
      userId,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeoutMs + 60000).toISOString()
    })
    return id
  })
}

export async function releaseInferenceRequest(id: string) {
  // Keep the receipt for the rolling hourly budget, even when generation failed.
  await db
    .update(requests)
    .set({ releasedAt: sql`clock_timestamp()` })
    .where(eq(requests.id, id))
}

export async function withInferenceBudget<T>(
  userId: number,
  timeoutMs: number,
  work: () => Promise<T>
): Promise<T> {
  const id = await reserveInferenceRequest(userId, timeoutMs)
  try {
    return await work()
  } finally {
    try {
      await releaseInferenceRequest(id)
    } catch {
      // A failed release stays reserved until expiry. Do not replace a completed
      // result or expose database errors; subsequent admissions still fail closed.
      console.error("AI request slot release failed; awaiting expiry")
    }
  }
}
