import {
  chatsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable
} from "@/drizzle"
import { diffToStringSimple } from "@/lib/utils"
import { asc, desc } from "drizzle-orm"

const main = async () => {
  const terms = await db.query.termsTable.findMany({
    orderBy: desc(termsTable.createdAt)
  })

  const aiUser = await db.query.usersTable.findFirst({
    where: (u, { eq }) => eq(u.isAi, true)
  })
  if (!aiUser) throw new Error("No AI user found")

  for (const term of terms) {
    console.log(`\n\n[TERM] ${term.term}`)

    const definitions = await db.query.definitionsTable.findMany({
      where: (def, { eq }) => eq(def.termId, term.id),
      orderBy: desc(definitionsTable.createdAt)
    })

    for (const definition of definitions) {
      const aiGenerated = definition.authorId === aiUser.id

      const [comments, revisions, chats] = await Promise.all([
        db.query.commentsTable.findMany({
          where: (c, { eq }) => eq(c.definitionId, definition.id)
        }),
        db.query.definitionRevisionsTable.findMany({
          where: (revision, { eq }) => eq(revision.definitionId, definition.id),
          orderBy: asc(definitionRevisionsTable.version)
        }),
        aiGenerated
          ? db.query.chatsTable.findMany({
            where: (c, { eq }) => eq(c.termId, definition.termId),
            orderBy: desc(chatsTable.createdAt)
          })
          : []
      ])

      const currentRevision =
        revisions.find(
          (revision) => revision.id === definition.currentRevisionId
        ) ?? revisions.at(-1)

      if (!currentRevision) {
        console.log(
          `=> Definition record ${definition.id} has no revision history`
        )
        continue
      }

      console.log(
        `=> Current revision: v${currentRevision.version}\n   Definition: ${diffToStringSimple(currentRevision.definitionDiff)}\n   Example: ${currentRevision.exampleDiff === null ? "[not retained in legacy record]" : diffToStringSimple(currentRevision.exampleDiff)}\n   AI Generated: ${aiGenerated}`
      )

      const versionsById = new Map(
        revisions.map((revision) => [revision.id, revision.version])
      )

      const history = [
        ...comments.map((c) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          type: "comment" as const
        })),
        ...revisions.map((revision) => ({
          ...revision,
          createdAt: new Date(revision.createdAt),
          type: "revision" as const
        })),
        ...chats.map((c) => ({
          ...c,
          type: "chat" as const,
          createdAt: new Date(c.createdAt)
        }))
      ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

      for (const item of history) {
        if (item.type == "comment") {
          const version = versionsById.get(item.revisionId)
          const importNote = item.migratedLegacy
            ? " [VERSION ASSOCIATION INFERRED DURING IMPORT]"
            : ""

          console.log(
            `\t[${item.createdAt.toISOString()}] [COMMENT ON v${version ?? "unknown"}]${importNote} ${item.message}`
          )
        } else if (item.type === "chat") {
          const safeMsg = item.message.replaceAll(/[\r\n]+/g, "")
          console.log(
            `\t[${item.createdAt.toISOString()}] [AI CHAT] [${item.role.toUpperCase()}] ${safeMsg}`
          )
        } else {
          const legacyNote = item.legacyIncomplete
            ? " [PARTIAL LEGACY RECORD]"
            : ""

          console.log(
            `\t[${item.createdAt.toISOString()}] [REVISION v${item.version}] [${item.source}]${legacyNote}\n\t  Definition: ${diffToStringSimple(item.definitionDiff)}\n\t  Example: ${item.exampleDiff === null ? "[not retained]" : diffToStringSimple(item.exampleDiff)}\n\t  Change note: ${item.changeNote ?? "[not retained]"}\n\t  Editor ID: ${item.editorId ?? "[not retained]"}`
          )
        }
      }
    }
  }
}

main()
