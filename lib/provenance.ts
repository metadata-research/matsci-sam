import "server-only"

import {
  chatsTable,
  commentsTable,
  db,
  definitionsTable,
  editsTable,
  termsTable,
  usersTable,
  votesTable
} from "@yamz/db"
import { asc, eq, getTableColumns, inArray } from "drizzle-orm"

// Read-only PROV-O mapping over the existing domain tables. Nothing here is
// stored: terms, definitions, definitionEdits, comments, and chats already
// record every event with timestamps and attribution, so the provenance
// record is derived on demand.

export type ProvNodeType = "term" | "entity" | "activity" | "person" | "software"

export type ProvRelation =
  | "wasGeneratedBy"
  | "wasDerivedFrom"
  | "wasAssociatedWith"
  | "wasAttributedTo"
  | "used"

export type ProvNode = {
  id: string
  label: string
  type: ProvNodeType
  // shown in the node details panel
  detail?: string
  meta?: Record<string, string | number | null>
}

export type ProvEdge = {
  id: string
  source: string
  target: string
  rel: ProvRelation
}

export type ProvEvent = {
  id: string
  at: string
  kind:
    | "term-created"
    | "initial-message"
    | "feedback"
    | "ai-generation"
    | "ai-revision"
    | "definition-created"
    | "definition-edited"
    | "comment"
    | "vote"
  actor: string
  actorKind: "person" | "software" | "unknown"
  summary: string
  detail?: string
  model?: string | null
  promptRef?: string | null
}

const excerpt = (text: string, max = 240) =>
  text.length > max ? `${text.slice(0, max)}…` : text

// terms.createdAt is stored without a timezone (it is UTC); normalize to ISO
// so it sorts correctly against the timezone-aware tables
const naiveUtcToIso = (ts: string) =>
  /[zZ]|[+-]\d\d(:?\d\d)?$/.test(ts) ? ts : `${ts.replace(" ", "T")}Z`

export const buildTermProvenance = async (termId: number) => {
  const term = await db.query.termsTable.findFirst({
    where: eq(termsTable.id, termId)
  })
  if (!term) return null

  const definitions = await db
    .select({
      id: definitionsTable.id,
      definition: definitionsTable.definition,
      example: definitionsTable.example,
      model: definitionsTable.model,
      prompt: definitionsTable.prompt,
      score: definitionsTable.score,
      createdAt: definitionsTable.createdAt,
      author: { id: usersTable.id, name: usersTable.name, isAi: usersTable.isAi }
    })
    .from(definitionsTable)
    .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
    .where(eq(definitionsTable.termId, termId))
    .orderBy(asc(definitionsTable.createdAt))

  const definitionIds = definitions.map((d) => d.id)

  const [edits, comments, chats, votes] = await Promise.all([
    definitionIds.length
      ? db
          .select()
          .from(editsTable)
          .where(inArray(editsTable.definitionId, definitionIds))
          .orderBy(asc(editsTable.editedAt))
      : Promise.resolve([]),
    definitionIds.length
      ? db
          .select({
            id: commentsTable.id,
            definitionId: commentsTable.definitionId,
            message: commentsTable.message,
            createdAt: commentsTable.createdAt,
            author: {
              id: usersTable.id,
              name: usersTable.name,
              isAi: usersTable.isAi
            }
          })
          .from(commentsTable)
          .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
          .where(inArray(commentsTable.definitionId, definitionIds))
          .orderBy(asc(commentsTable.createdAt))
      : Promise.resolve([]),
    db
      .select({
        ...getTableColumns(chatsTable),
        authorName: usersTable.name,
        authorId: usersTable.id
      })
      .from(chatsTable)
      .leftJoin(usersTable, eq(chatsTable.userId, usersTable.id))
      .where(eq(chatsTable.termId, termId))
      .orderBy(asc(chatsTable.createdAt)),
    definitionIds.length
      ? db
          .select({
            definitionId: votesTable.definitionId,
            kind: votesTable.kind,
            createdAt: votesTable.createdAt,
            author: { id: usersTable.id, name: usersTable.name }
          })
          .from(votesTable)
          .innerJoin(usersTable, eq(votesTable.userId, usersTable.id))
          .where(inArray(votesTable.definitionId, definitionIds))
          .orderBy(asc(votesTable.createdAt))
      : Promise.resolve([])
  ])

  const nodes: ProvNode[] = []
  const edges: ProvEdge[] = []
  const events: ProvEvent[] = []
  const seen = new Set<string>()

  const addNode = (node: ProvNode) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    nodes.push(node)
  }
  const addEdge = (source: string, target: string, rel: ProvRelation) => {
    const id = `${source}->${target}:${rel}`
    if (seen.has(id)) return
    seen.add(id)
    edges.push({ id, source, target, rel })
  }

  // --- term entity ---
  const termNode = `term_${term.id}`
  addNode({
    id: termNode,
    label: term.term,
    type: "term",
    meta: { created: term.createdAt }
  })
  events.push({
    id: termNode,
    at: naiveUtcToIso(term.createdAt),
    kind: "term-created",
    actor: "unknown",
    actorKind: "unknown",
    summary: `Term "${term.term}" created`
  })

  // --- agents ---
  const personNode = (author: { id: number; name: string | null }) => {
    const id = `user_${author.id}`
    addNode({ id, label: author.name ?? `User ${author.id}`, type: "person" })
    return id
  }
  const modelNode = (model: string) => {
    const id = `model_${model}`
    addNode({ id, label: model, type: "software" })
    return id
  }
  const promptNode = (hash: string, text: string | null, key: string | null) => {
    const id = `prompt_${hash}`
    addNode({
      id,
      label: key ? `prompt: ${key}` : `prompt ${hash.slice(0, 8)}`,
      type: "entity",
      detail: text ?? undefined,
      meta: { hash }
    })
    return id
  }

  // Comments on AI definitions are mirrored into the chat thread as
  // "<feedback>\n<text>" user rows; treat the comment as the canonical
  // entity so the pair does not appear twice.
  const mirroredChatIds = new Set<number>()
  const feedbackEntityForChat = new Map<number, string>()
  const userChats = chats.filter((c) => c.role === "user")
  for (const chat of userChats) {
    const match = comments.find(
      (c) => `<feedback>\n${c.message}` === chat.message
    )
    if (match) {
      mirroredChatIds.add(chat.id)
      feedbackEntityForChat.set(chat.id, `comment_${match.id}`)
    }
  }

  // --- definitions with their version chains ---
  const aiDefinition = definitions.find((d) => d.author.isAi)
  const systemChats = chats.filter((c) => c.role === "system")

  for (const definition of definitions) {
    const defEdits = edits.filter((e) => e.definitionId === definition.id)
    const isAi = definition.author.isAi

    // versions: v1 text is the oldest edit's "before"; the definition row is
    // always the latest text
    const versions = [
      ...defEdits.map((e, i) => ({
        text: e.definition,
        at:
          i === 0
            ? definition.createdAt
            : defEdits[i - 1].editedAt.toISOString()
      })),
      {
        text: definition.definition,
        at: defEdits.length
          ? defEdits[defEdits.length - 1].editedAt.toISOString()
          : definition.createdAt
      }
    ]

    versions.forEach((version, i) => {
      const id = `def_${definition.id}_v${i + 1}`
      const isLatest = i === versions.length - 1
      addNode({
        id,
        label: `${isAi ? "AI definition" : "Definition"} v${i + 1}${isLatest ? " (current)" : ""}`,
        type: "entity",
        detail: version.text,
        meta: isLatest
          ? { score: definition.score, example: definition.example }
          : undefined
      })
      if (i === 0) addEdge(id, termNode, "wasDerivedFrom")
      else addEdge(id, `def_${definition.id}_v${i}`, "wasDerivedFrom")

      if (!isAi) {
        // human authorship/edit activities; the edits table records no editor,
        // so edits are attributed to the definition author
        const actId = `act_def_${definition.id}_v${i + 1}`
        addNode({
          id: actId,
          label: i === 0 ? "Write definition" : "Edit definition",
          type: "activity",
          meta: { at: version.at }
        })
        addEdge(id, actId, "wasGeneratedBy")
        addEdge(actId, personNode(definition.author), "wasAssociatedWith")
        addEdge(id, personNode(definition.author), "wasAttributedTo")
      }
    })

    if (!isAi) {
      events.push({
        id: `def_${definition.id}_created`,
        at: definition.createdAt,
        kind: "definition-created",
        actor: definition.author.name ?? `User ${definition.author.id}`,
        actorKind: "person",
        summary: "Definition written",
        detail: excerpt(definition.definition)
      })
    }

    for (const [i, edit] of defEdits.entries()) {
      events.push({
        id: `edit_${edit.id}`,
        at: edit.editedAt.toISOString(),
        kind: "definition-edited",
        actor: isAi
          ? "AI revision"
          : (definition.author.name ?? `User ${definition.author.id}`),
        actorKind: isAi ? "software" : "person",
        summary: `${isAi ? "AI definition" : "Definition"} revised (v${i + 1} → v${i + 2})`,
        detail: excerpt(edit.newDefinition ?? "")
      })
    }
  }

  // --- AI activities from the chat thread ---
  // The nth system chat produced the nth version of the AI definition.
  let aiVersionIndex = 0
  for (const [i, chat] of chats.entries()) {
    if (chat.role === "user") {
      if (!mirroredChatIds.has(chat.id)) {
        const id = `chat_${chat.id}`
        addNode({
          id,
          label: i === 0 ? "Initial message" : "Feedback",
          type: "entity",
          detail: chat.message
        })
        feedbackEntityForChat.set(chat.id, id)
        if (chat.authorId !== null)
          addEdge(
            id,
            personNode({ id: chat.authorId, name: chat.authorName }),
            "wasAttributedTo"
          )
        // mirrored feedback is already covered by its comment event, which
        // carries author attribution
        events.push({
          id: `chat_${chat.id}`,
          at: chat.createdAt,
          kind: i === 0 ? "initial-message" : "feedback",
          actor: chat.authorName ?? "user",
          actorKind: chat.authorName ? "person" : "unknown",
          summary: i === 0 ? "Initial message submitted" : "Feedback for the AI",
          detail: excerpt(chat.message)
        })
      }
      continue
    }

    // system chat: a generation/revision activity
    aiVersionIndex += 1
    const actId = `act_chat_${chat.id}`
    const isInitial = aiVersionIndex === 1
    addNode({
      id: actId,
      label: isInitial ? "Generate definition" : "Revise definition",
      type: "activity",
      meta: { at: chat.createdAt, model: chat.model }
    })

    if (chat.model) addEdge(actId, modelNode(chat.model), "wasAssociatedWith")
    if (chat.promptHash)
      addEdge(
        actId,
        promptNode(chat.promptHash, chat.promptText, chat.promptKey),
        "used"
      )

    // the activity consumed everything the user said since the last AI response
    for (let j = i - 1; j >= 0; j--) {
      const prior = chats[j]
      if (prior.role === "system") break
      const feedback = feedbackEntityForChat.get(prior.id)
      if (feedback) addEdge(actId, feedback, "used")
    }

    if (aiDefinition) {
      const versionId = `def_${aiDefinition.id}_v${aiVersionIndex}`
      if (seen.has(versionId)) {
        addEdge(versionId, actId, "wasGeneratedBy")
        if (chat.model)
          addEdge(versionId, modelNode(chat.model), "wasAttributedTo")
      }
    }

    events.push({
      id: `chat_${chat.id}`,
      at: chat.createdAt,
      kind: isInitial ? "ai-generation" : "ai-revision",
      actor: chat.model ?? "AI",
      actorKind: "software",
      summary: isInitial ? "AI generated a definition" : "AI revised its definition",
      detail: excerpt(chat.message),
      model: chat.model,
      promptRef: chat.promptKey ?? chat.promptHash
    })
  }

  // --- comments ---
  for (const comment of comments) {
    const id = `comment_${comment.id}`
    addNode({
      id,
      label: `Comment by ${comment.author.name ?? "user"}`,
      type: "entity",
      detail: comment.message
    })
    addEdge(id, personNode(comment.author), "wasAttributedTo")
    events.push({
      id,
      at: comment.createdAt,
      kind: "comment",
      actor: comment.author.name ?? `User ${comment.author.id}`,
      actorKind: "person",
      summary: "Comment posted",
      detail: excerpt(comment.message)
    })
  }

  // --- votes ---
  for (const [i, vote] of votes.entries()) {
    const definition = definitions.find((d) => d.id === vote.definitionId)
    if (!definition) continue
    // backfilled votes carry the definition's createdAt as a placeholder
    const isPlaceholder = vote.createdAt === definition.createdAt
    events.push({
      id: `vote_${vote.definitionId}_${vote.author.id}_${i}`,
      at: vote.createdAt,
      kind: "vote",
      actor: vote.author.name ?? `User ${vote.author.id}`,
      actorKind: "person",
      summary: `${vote.kind === "up" ? "Upvoted" : "Downvoted"} the ${
        definition.author.isAi ? "AI definition" : "definition"
      }`,
      detail: isPlaceholder
        ? "Date is a placeholder — this vote predates timestamp tracking"
        : undefined
    })
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return {
    term: { id: term.id, term: term.term },
    events,
    graph: { nodes, edges }
  }
}
