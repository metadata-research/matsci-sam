import "server-only"

import {
  chatsTable,
  coauthorsTable,
  commentsTable,
  db,
  definitionsTable,
  editsTable,
  refinementsTable,
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
    | "refine-requested"
    | "refine-suggested"
    | "refine-accepted"
    | "refine-kept"
    | "refine-failed"
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

export const buildTermProvenance = async (
  termId: number,
  // The public view shows vote events without voter identities; the admin
  // view passes nothing and keeps full detail
  options: { anonymizeVoters?: boolean } = {}
) => {
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
      refinedFromId: definitionsTable.refinedFromId,
      score: definitionsTable.score,
      createdAt: definitionsTable.createdAt,
      author: { id: usersTable.id, name: usersTable.name, isAi: usersTable.isAi }
    })
    .from(definitionsTable)
    .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
    .where(eq(definitionsTable.termId, termId))
    .orderBy(asc(definitionsTable.createdAt))

  const definitionIds = definitions.map((d) => d.id)

  const [edits, comments, chats, votes, refinements, coauthors] =
    await Promise.all([
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
      : Promise.resolve([]),
    definitionIds.length
      ? db
          .select()
          .from(refinementsTable)
          .where(inArray(refinementsTable.definitionId, definitionIds))
          .orderBy(asc(refinementsTable.round))
      : Promise.resolve([]),
    definitionIds.length
      ? db
          .select({
            definitionId: coauthorsTable.definitionId,
            user: { id: usersTable.id, name: usersTable.name, isAi: usersTable.isAi }
          })
          .from(coauthorsTable)
          .innerJoin(usersTable, eq(coauthorsTable.userId, usersTable.id))
          .where(inArray(coauthorsTable.definitionId, definitionIds))
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

    const isRefined = definition.refinedFromId !== null
    const defCoauthors = coauthors.filter(
      (c) => c.definitionId === definition.id
    )

    versions.forEach((version, i) => {
      const id = `def_${definition.id}_v${i + 1}`
      const isLatest = i === versions.length - 1
      addNode({
        id,
        label: `${
          isRefined ? "Refined definition" : isAi ? "AI definition" : "Definition"
        } v${i + 1}${isLatest ? " (current)" : ""}`,
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
        // so edits are attributed to the definition author. Every version of
        // a refined definition is an accepted AI suggestion.
        const actId = `act_def_${definition.id}_v${i + 1}`
        addNode({
          id: actId,
          label: isRefined
            ? "Accept AI suggestion"
            : i === 0
              ? "Write definition"
              : "Edit definition",
          type: "activity",
          meta: { at: version.at }
        })
        addEdge(id, actId, "wasGeneratedBy")
        addEdge(actId, personNode(definition.author), "wasAssociatedWith")
        addEdge(id, personNode(definition.author), "wasAttributedTo")

        // co-authors (the model whose suggestion was accepted) share
        // attribution, GitHub-style
        for (const coauthor of defCoauthors)
          addEdge(
            id,
            coauthor.user.isAi
              ? modelNode(coauthor.user.name ?? `model ${coauthor.user.id}`)
              : personNode(coauthor.user),
            "wasAttributedTo"
          )
      }
    })

    if (!isAi) {
      events.push({
        id: `def_${definition.id}_created`,
        at: definition.createdAt,
        kind: "definition-created",
        actor: definition.author.name ?? `User ${definition.author.id}`,
        actorKind: "person",
        summary: isRefined
          ? "Refined definition published (accepted AI suggestion)"
          : "Definition written",
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

  // --- interactive refinement rounds ---
  // Each round is an activity associated with both agents (the author who
  // requested it, the model that generated); it used the author's current
  // definition version and their feedback, and generated a suggestion
  // entity. An accepted suggestion is what the refined definition (rendered
  // by the definitions loop above) was derived from.
  for (const round of refinements) {
    const definition = definitions.find((d) => d.id === round.definitionId)
    if (!definition) continue
    const authorName = definition.author.name ?? `User ${definition.author.id}`

    // the round reviewed the author's then-current (= latest) version
    const currentVersion = `def_${definition.id}_v${
      edits.filter((e) => e.definitionId === definition.id).length + 1
    }`

    const actId = `act_refine_${round.id}`
    addNode({
      id: actId,
      label: `Refine definition (round ${round.round})`,
      type: "activity",
      meta: { at: round.createdAt, model: round.model, status: round.status }
    })
    addEdge(actId, personNode(definition.author), "wasAssociatedWith")
    if (round.model) addEdge(actId, modelNode(round.model), "wasAssociatedWith")
    if (round.promptHash)
      addEdge(
        actId,
        promptNode(round.promptHash, round.promptText, round.promptKey),
        "used"
      )
    if (seen.has(currentVersion)) addEdge(actId, currentVersion, "used")

    if (round.userComment) {
      const feedbackId = `refine_feedback_${round.id}`
      addNode({
        id: feedbackId,
        label: `Refine feedback (round ${round.round})`,
        type: "entity",
        detail: round.userComment
      })
      addEdge(feedbackId, personNode(definition.author), "wasAttributedTo")
      addEdge(actId, feedbackId, "used")
    }

    events.push({
      id: `refine_req_${round.id}`,
      at: round.createdAt,
      kind: "refine-requested",
      actor: authorName,
      actorKind: "person",
      summary: round.userComment
        ? `Re-evaluation requested (round ${round.round})`
        : `AI refinement requested (round ${round.round})`,
      detail: round.userComment ? excerpt(round.userComment) : undefined
    })

    if (round.status === "failed") {
      events.push({
        id: `refine_fail_${round.id}`,
        at: round.suggestedAt ?? round.createdAt,
        kind: "refine-failed",
        actor: round.model ?? "AI",
        actorKind: "software",
        summary: `Refinement round ${round.round} failed`,
        detail: round.errorMessage ?? undefined
      })
      continue
    }

    if (!round.suggestedDefinition) continue // still pending

    const sugId = `refine_sug_${round.id}`
    addNode({
      id: sugId,
      label: `Suggestion (round ${round.round})`,
      type: "entity",
      detail: round.suggestedDefinition,
      meta: { example: round.suggestedExample }
    })
    addEdge(sugId, actId, "wasGeneratedBy")
    if (round.model) addEdge(sugId, modelNode(round.model), "wasAttributedTo")

    events.push({
      id: sugId,
      at: round.suggestedAt ?? round.createdAt,
      kind: "refine-suggested",
      actor: round.model ?? "AI",
      actorKind: "software",
      summary: `AI suggested a revision (round ${round.round})`,
      detail: excerpt(round.suggestedDefinition),
      model: round.model,
      promptRef: round.promptKey ?? round.promptHash
    })

    if (round.status === "accepted") {
      const refined = definitions.find(
        (d) => d.refinedFromId === definition.id
      )
      if (refined) {
        // acceptances are the only writes to a refined definition, so the
        // nth accepted round produced its nth version
        const versionIndex =
          refinements
            .filter(
              (r) =>
                r.definitionId === definition.id && r.status === "accepted"
            )
            .findIndex((r) => r.id === round.id) + 1
        const refinedVersion = `def_${refined.id}_v${versionIndex}`
        if (seen.has(refinedVersion)) {
          addEdge(refinedVersion, sugId, "wasDerivedFrom")
          addEdge(refinedVersion, currentVersion, "wasDerivedFrom")
        }
      }

      events.push({
        id: `refine_acc_${round.id}`,
        at: round.decidedAt ?? round.suggestedAt ?? round.createdAt,
        kind: "refine-accepted",
        actor: authorName,
        actorKind: "person",
        summary: `Suggestion accepted (round ${round.round})`,
        detail: excerpt(round.suggestedDefinition)
      })
    }

    if (round.status === "kept")
      events.push({
        id: `refine_kept_${round.id}`,
        at: round.decidedAt ?? round.suggestedAt ?? round.createdAt,
        kind: "refine-kept",
        actor: authorName,
        actorKind: "person",
        summary: `Author kept their original (round ${round.round})`
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
  // Votes that predate timestamp tracking carry their definition's
  // createdAt, which is close enough to present as the vote date.
  for (const [i, vote] of votes.entries()) {
    const definition = definitions.find((d) => d.id === vote.definitionId)
    if (!definition) continue
    events.push({
      id: `vote_${vote.definitionId}_${vote.author.id}_${i}`,
      at: vote.createdAt,
      kind: "vote",
      actor: options.anonymizeVoters
        ? "A community member"
        : (vote.author.name ?? `User ${vote.author.id}`),
      actorKind: "person",
      summary: `${vote.kind === "up" ? "Upvoted" : "Downvoted"} the ${
        definition.author.isAi ? "AI definition" : "definition"
      }`
    })
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return {
    term: { id: term.id, term: term.term },
    events,
    graph: { nodes, edges }
  }
}
