import { TRPCError } from "@trpc/server"
import { db } from "@yamz/db"
import { sql } from "drizzle-orm"
import { getCurrentUser } from "@/lib/current-user"
import { createCommunityReviewPacket } from "@/lib/community-review-packet"
import { parseReviewPacketQuery } from "@/lib/community-review-packet-types"
import { renderCommunityReviewPacket } from "@/lib/community-review-packet-render"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user)
      return Response.json(
        { error: "Sign in to export a review packet." },
        { status: 401, headers }
      )
    const { slug } = await context.params
    if (!/^[a-z0-9][a-z0-9_-]{0,199}$/.test(slug))
      return Response.json(
        { error: "Community unavailable." },
        { status: 404, headers }
      )
    const url = new URL(request.url)
    let input
    try {
      input = parseReviewPacketQuery(url.searchParams)
    } catch {
      return Response.json(
        {
          error:
            "Select contributions and preview the packet before downloading."
        },
        { status: 400, headers }
      )
    }
    const packet = await db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '15s'`)
        return createCommunityReviewPacket(tx, slug, input, user.id)
      },
      { isolationLevel: "repeatable read", accessMode: "read only" }
    )
    if (input.format === "html")
      return new Response(renderCommunityReviewPacket(packet, url.origin), {
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition":
            'inline; filename="community-review-packet.html"',
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        }
      })
    return Response.json(packet, {
      headers: {
        ...headers,
        ...(input.format === "json"
          ? {
              "Content-Disposition":
                'attachment; filename="community-review-packet.json"'
            }
          : {})
      }
    })
  } catch (error) {
    if (error instanceof TRPCError) {
      const status = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        CONFLICT: 409,
        BAD_REQUEST: 400
      }[error.code as "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST"]
      if (status)
        return Response.json({ error: error.message }, { status, headers })
    }
    return Response.json(
      {
        error:
          "The review packet could not be generated. Try a smaller selection."
      },
      { status: 500, headers }
    )
  }
}
