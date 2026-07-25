import { sql } from "drizzle-orm"

import { db } from "@/drizzle/connection"

export const dynamic = "force-dynamic"

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json"
}

export async function GET() {
  try {
    await db.execute(sql`
      select
        (select count(*) from "users"),
        (select count(*) from "terms"),
        (select count(*) from "definitions"),
        (select count(*) from drizzle."__drizzle_migrations")
    `)
    return Response.json({ status: "ok" }, { headers })
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers }
    )
  }
}
