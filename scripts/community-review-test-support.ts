import assert from "node:assert/strict"
import { sql } from "drizzle-orm"
import { db } from "../drizzle"
export function requireLocalReviewDatabase() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname),
    "Review tests require a local database"
  )
}
export async function reviewFingerprints() {
  requireLocalReviewDatabase()
  const tables = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`
  )
  const result: Record<string, unknown> = {}
  for (const { table_name } of tables.rows)
    result[table_name] = (
      await db.execute(
        sql`select count(*)::int as count, md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) as hash from ${sql.identifier(table_name)} t`
      )
    ).rows[0]
  return result
}
