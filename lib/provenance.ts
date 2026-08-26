import "server-only"

import { createHash } from "node:crypto"
import {
  aiModelsTable,
  chatsTable,
  commentsTable,
  db,
  definitionExamplesTable,
  definitionExampleSelectionsTable,
  definitionRevisionsTable,
  definitionsTable,
  refinementsTable,
  termsTable,
  usersTable,
  voteEventsTable,
  votesTable
} from "@yamz/db"
import { asc, eq, getTableColumns, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import {
  definitionUri,
  modelUri,
  revisionUri,
  termUri
} from "./public-identifiers"
import { diffToStringSimple } from "./definition-revisions"
import {
  acceptedAiSuggestionsForOutputs,
  acceptedLegacyDiscussionSuggestionsForOutputs
} from "./ai-contribution-provenance"

const exampleSelectedByUsers = alias(usersTable, "exampleSelectedByUsers")
const exampleEndedByUsers = alias(usersTable, "exampleEndedByUsers")

// Read-only PROV-O mapping over the domain tables. Definition revisions are
// the canonical version record; the mutable definitions row is used only for
// the stable contribution identity, author, term, and current-revision pointer.

export type ProvNodeType =
  | "term"
  | "entity"
  | "activity"
  | "person"
  | "software"

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
  publicResource?: {
    uri: string
    specializationOf?: string
    wasRevisionOf?: string
    proposesReplacementFor?: string
  }
  // Records without a published identifier (examples and feature decisions)
  // remain document-scoped blank nodes in RDF. This label is derived without
  // exposing a database row id.
  rdfBlankNode?: string
  profileUserId?: number
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
  // The recorded three-way category of the act where the row carries one:
  // a person, a model acting as itself, or a scripted participant driven
  // under an AI identity account. Absent on event kinds whose rows predate
  // the record.
  agency?: "human" | "model" | "simulated"
  profileUserId?: number
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

const generatedChatContent = (message: string) => {
  const match = message.match(
    /^<definition>\n([\s\S]*?)\n\n<example>\n([\s\S]*)$/
  )
  return match ? { definition: match[1], example: match[2] } : null
}

const revisionNodeId = (definitionId: number, version: number) =>
  `def_${definitionId}_v${version}`

type ProfileCapableUser = {
  id: number
  name: string | null
  isAi?: boolean | null
  isProfilePublic?: boolean | null
}

const publicProfileUserId = (user: ProfileCapableUser | null | undefined) =>
  user?.isProfilePublic === true && user.isAi === false ? user.id : undefined

export const buildTermProvenance = async (
  termId: number,
  // Public provenance keeps the vote itself visible but does not reveal the
  // voter node or identity. The dataset-wide graph (lib/graph/) leaves votes
  // out of the per-term body and states each voting act once, as a
  // matsci:VoteEvent, so it passes includeVotes: false. It also passes
  // modelIdentities: true, so a model with a profile is named by its own
  // IRI, the agent its assertions and vote events name in that graph. The
  // per-term document keeps naming a model by the string it ran under.
  options: {
    anonymizeVoters?: boolean
    includeVotes?: boolean
    modelIdentities?: boolean
  } = {}
) => {
  const includeVotes = options.includeVotes ?? true
  const modelIdentities = options.modelIdentities
    ? await db
        .select({
          userId: aiModelsTable.userId,
          slug: aiModelsTable.slug,
          tag: aiModelsTable.tag
        })
        .from(aiModelsTable)
    : []
  const modelSlugByTag = new Map(modelIdentities.map((m) => [m.tag, m.slug]))
  const modelSlugByUserId = new Map(
    modelIdentities.map((m) => [m.userId, m.slug])
  )
  const term = await db.query.termsTable.findFirst({
    where: eq(termsTable.id, termId)
  })
  if (!term) return null

  const definitions = await db
    .select({
      id: definitionsTable.id,
      definitionNumber: definitionsTable.definitionNumber,
      currentRevisionId: definitionsTable.currentRevisionId,
      replacesDefinitionId: definitionsTable.replacesDefinitionId,
      createdAt: definitionsTable.createdAt,
      author: {
        id: usersTable.id,
        name: usersTable.name,
        isAi: usersTable.isAi,
        isProfilePublic: usersTable.isProfilePublic
      }
    })
    .from(definitionsTable)
    .leftJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
    .where(eq(definitionsTable.termId, termId))
    .orderBy(asc(definitionsTable.createdAt))

  const definitionIds = definitions.map((definition) => definition.id)

  const [
    revisions,
    comments,
    chats,
    votes,
    refinements,
    discussionSuggestions,
    aiContributionSuggestions,
    definitionExamples,
    exampleSelections
  ] = await Promise.all([
    definitionIds.length
      ? db
          .select({
            id: definitionRevisionsTable.id,
            definitionId: definitionRevisionsTable.definitionId,
            version: definitionRevisionsTable.version,
            previousRevisionId: definitionRevisionsTable.previousRevisionId,
            definitionDiff: definitionRevisionsTable.definitionDiff,
            exampleDiff: definitionRevisionsTable.exampleDiff,
            editorId: definitionRevisionsTable.editorId,
            changeNote: definitionRevisionsTable.changeNote,
            legacyIncomplete: definitionRevisionsTable.legacyIncomplete,
            source: definitionRevisionsTable.source,
            model: definitionRevisionsTable.model,
            prompt: definitionRevisionsTable.prompt,
            derivedFromRevisionId:
              definitionRevisionsTable.derivedFromRevisionId,
            sourceRefinementId: definitionRevisionsTable.sourceRefinementId,
            createdAt: definitionRevisionsTable.createdAt,
            charsAdded: definitionRevisionsTable.charsAdded,
            charsRemoved: definitionRevisionsTable.charsRemoved,
            changeDelta: definitionRevisionsTable.changeDelta,
            editor: {
              id: usersTable.id,
              name: usersTable.name,
              isAi: usersTable.isAi,
              isProfilePublic: usersTable.isProfilePublic
            }
          })
          .from(definitionRevisionsTable)
          .leftJoin(
            usersTable,
            eq(definitionRevisionsTable.editorId, usersTable.id)
          )
          .where(inArray(definitionRevisionsTable.definitionId, definitionIds))
          .orderBy(
            asc(definitionRevisionsTable.definitionId),
            asc(definitionRevisionsTable.version)
          )
      : Promise.resolve([]),
    definitionIds.length
      ? db
          .select({
            id: commentsTable.id,
            definitionId: commentsTable.definitionId,
            revisionId: commentsTable.revisionId,
            message: commentsTable.message,
            createdAt: commentsTable.createdAt,
            migratedLegacy: commentsTable.migratedLegacy,
            authorKind: commentsTable.authorKind,
            promptKey: commentsTable.promptKey,
            promptHash: commentsTable.promptHash,
            model: commentsTable.model,
            author: {
              id: usersTable.id,
              name: usersTable.name,
              isAi: usersTable.isAi,
              isProfilePublic: usersTable.isProfilePublic
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
        authorId: usersTable.id,
        authorIsAi: usersTable.isAi,
        authorProfilePublic: usersTable.isProfilePublic
      })
      .from(chatsTable)
      .leftJoin(usersTable, eq(chatsTable.userId, usersTable.id))
      .where(eq(chatsTable.termId, termId))
      .orderBy(asc(chatsTable.createdAt)),
    // The current-state votes, read for the standing score of each revision
    // and nothing else: every voting act is in voteEvents.
    definitionIds.length
      ? db
          .select({
            revisionId: votesTable.revisionId,
            kind: votesTable.kind
          })
          .from(votesTable)
          .where(inArray(votesTable.definitionId, definitionIds))
      : Promise.resolve([]),
    definitionIds.length
      ? db
          .select()
          .from(refinementsTable)
          .where(inArray(refinementsTable.definitionId, definitionIds))
          .orderBy(
            asc(refinementsTable.definitionId),
            asc(refinementsTable.round)
          )
      : Promise.resolve([]),
    acceptedLegacyDiscussionSuggestionsForOutputs(definitionIds),
    acceptedAiSuggestionsForOutputs(definitionIds),
    definitionIds.length
      ? db
          .select({
            ...getTableColumns(definitionExamplesTable),
            author: {
              id: usersTable.id,
              name: usersTable.name,
              isAi: usersTable.isAi,
              isProfilePublic: usersTable.isProfilePublic
            }
          })
          .from(definitionExamplesTable)
          .leftJoin(
            usersTable,
            eq(definitionExamplesTable.authorId, usersTable.id)
          )
          .where(inArray(definitionExamplesTable.definitionId, definitionIds))
          .orderBy(
            asc(definitionExamplesTable.definitionId),
            asc(definitionExamplesTable.exampleNumber)
          )
      : Promise.resolve([]),
    definitionIds.length
      ? db
          .select({
            ...getTableColumns(definitionExampleSelectionsTable),
            selectedBy: {
              id: exampleSelectedByUsers.id,
              name: exampleSelectedByUsers.name,
              isAi: exampleSelectedByUsers.isAi,
              isProfilePublic: exampleSelectedByUsers.isProfilePublic
            },
            endedBy: {
              id: exampleEndedByUsers.id,
              name: exampleEndedByUsers.name,
              isAi: exampleEndedByUsers.isAi,
              isProfilePublic: exampleEndedByUsers.isProfilePublic
            }
          })
          .from(definitionExampleSelectionsTable)
          .leftJoin(
            exampleSelectedByUsers,
            eq(
              definitionExampleSelectionsTable.selectedById,
              exampleSelectedByUsers.id
            )
          )
          .leftJoin(
            exampleEndedByUsers,
            eq(
              definitionExampleSelectionsTable.endedById,
              exampleEndedByUsers.id
            )
          )
          .where(
            inArray(
              definitionExampleSelectionsTable.definitionId,
              definitionIds
            )
          )
          .orderBy(
            asc(definitionExampleSelectionsTable.definitionId),
            asc(definitionExampleSelectionsTable.selectedAt),
            asc(definitionExampleSelectionsTable.id)
          )
      : Promise.resolve([])
  ])

  // Vote events are the record of every voting act: one row per act from
  // migration 0040 forward, withdrawals included, and one row per earlier
  // vote as the 0043 backfill wrote it, at the recorded time of the vote.
  const voteEvents =
    definitionIds.length && includeVotes
      ? await db
          .select({
            id: voteEventsTable.id,
            revisionId: voteEventsTable.revisionId,
            definitionId: voteEventsTable.definitionId,
            kind: voteEventsTable.kind,
            actorKind: voteEventsTable.actorKind,
            createdAt: voteEventsTable.createdAt,
            backfilled: voteEventsTable.backfilled,
            migratedLegacy: voteEventsTable.migratedLegacy,
            author: {
              id: usersTable.id,
              name: usersTable.name,
              isAi: usersTable.isAi,
              isProfilePublic: usersTable.isProfilePublic
            }
          })
          .from(voteEventsTable)
          .innerJoin(usersTable, eq(voteEventsTable.userId, usersTable.id))
          .where(inArray(voteEventsTable.definitionId, definitionIds))
          .orderBy(asc(voteEventsTable.createdAt), asc(voteEventsTable.id))
      : []

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
    publicResource: { uri: termUri(term.slug, term.vocabularySlug) },
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

  // --- agents and prompts ---
  const personNode = (author: ProfileCapableUser) => {
    const id = `user_${author.id}`
    addNode({
      id,
      label: author.name ?? `User ${author.id}`,
      // An AI identity account, whether a model author or a simulated pilot
      // persona, is a software agent wherever it appears in the graph.
      type: author.isAi ? "software" : "person",
      profileUserId: publicProfileUserId(author)
    })
    return id
  }
  // A model is keyed by the string it ran under, which is the tag of its
  // aiModels row when it has one. With modelIdentities the node resolves to
  // the /models/<slug> IRI, by the account where the act names one and by
  // the tag otherwise.
  const modelNode = (model: string, userId?: number) => {
    const id = `model_${model}`
    const slug =
      (userId !== undefined ? modelSlugByUserId.get(userId) : undefined) ??
      modelSlugByTag.get(model)
    addNode({
      id,
      label: model,
      type: "software",
      ...(slug !== undefined ? { publicResource: { uri: modelUri(slug) } } : {})
    })
    return id
  }
  const promptNode = (
    hash: string,
    text: string | null,
    key: string | null
  ) => {
    const id = `prompt_${hash}`
    addNode({
      id,
      label: key ? `prompt: ${key}` : `prompt ${hash.slice(0, 8)}`,
      type: "entity",
      detail: text ?? undefined,
      meta: { hash, ...(key !== null ? { promptKey: key } : {}) }
    })
    return id
  }
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition])
  )
  const revisionById = new Map(
    revisions.map((revision) => [revision.id, revision])
  )
  const exampleById = new Map(
    definitionExamples.map((example) => [example.id, example])
  )
  const blankNodeScope = createHash("sha256")
    .update(`${term.vocabularySlug}/${term.slug}`)
    .digest("hex")
    .slice(0, 16)
  const stableDefinitionNodeId = (definitionNumber: number) =>
    `definition_${definitionNumber}`
  const exampleNodeId = (definitionNumber: number, exampleNumber: number) =>
    `definition_${definitionNumber}_example_${exampleNumber}`

  // Stable definitions already have published IRIs. Naming them explicitly
  // lets replacement proposals and feature decisions point at the stable
  // candidate rather than falsely treating either as a revision derivation.
  for (const definition of definitions) {
    const replacementTarget =
      definition.replacesDefinitionId === null
        ? undefined
        : definitionById.get(definition.replacesDefinitionId)
    addNode({
      id: stableDefinitionNodeId(definition.definitionNumber),
      label: `Definition ${definition.definitionNumber}`,
      type: "entity",
      publicResource: {
        uri: definitionUri(
          term.slug,
          definition.definitionNumber,
          term.vocabularySlug
        ),
        ...(replacementTarget
          ? {
              proposesReplacementFor: definitionUri(
                term.slug,
                replacementTarget.definitionNumber,
                term.vocabularySlug
              )
            }
          : {})
      },
      meta: {
        definitionNumber: definition.definitionNumber,
        ...(replacementTarget
          ? { replacesDefinitionNumber: replacementTarget.definitionNumber }
          : {})
      }
    })
  }
  const revisionCoordinate = (revision: (typeof revisions)[number]) => {
    const definition = definitionById.get(revision.definitionId)
    return definition
      ? `definition ${definition.definitionNumber} · revision ${revision.version}`
      : `revision ${revision.version}`
  }
  const revisionLabel = (revision: (typeof revisions)[number]) => {
    const definition = definitionById.get(revision.definitionId)
    return definition
      ? `Definition ${definition.definitionNumber} · revision ${revision.version}`
      : `Revision ${revision.version}`
  }
  const revisionPromptNode = (revision: (typeof revisions)[number]) => {
    const id = `prompt_revision_${revision.id}`
    addNode({
      id,
      label: `Stored prompt for ${revisionCoordinate(revision)}`,
      type: "entity",
      detail: revision.prompt ?? undefined,
      meta: { revisionId: revision.id }
    })
    return id
  }

  const scoreByRevisionId = new Map<number, number>()
  for (const vote of votes)
    scoreByRevisionId.set(
      vote.revisionId,
      (scoreByRevisionId.get(vote.revisionId) ?? 0) +
        (vote.kind === "up" ? 1 : -1)
    )

  // A chat row and a revision are linked only when their stored definition and
  // example match unambiguously. Ambiguous duplicate generations stay as
  // separate transcript activities rather than receiving a guessed link.
  const chatForRevision = new Map<number, (typeof chats)[number]>()
  const revisionForChat = new Map<number, (typeof revisions)[number]>()
  for (const chat of chats.filter((row) => row.role === "system")) {
    const generated = generatedChatContent(chat.message)
    if (!generated) continue

    const candidates = revisions.filter((revision) => {
      const definition = definitionById.get(revision.definitionId)
      return (
        definition?.author?.isAi === true &&
        revision.exampleDiff !== null &&
        diffToStringSimple(revision.definitionDiff) === generated.definition &&
        diffToStringSimple(revision.exampleDiff) === generated.example &&
        (!revision.model || !chat.model || revision.model === chat.model) &&
        (!revision.prompt ||
          !chat.promptText ||
          revision.prompt === chat.promptText) &&
        !chatForRevision.has(revision.id)
      )
    })

    if (candidates.length === 1) {
      chatForRevision.set(candidates[0].id, chat)
      revisionForChat.set(chat.id, candidates[0])
    }
  }
  const revisionActivityId = (revision: (typeof revisions)[number]) => {
    const matchedChat = chatForRevision.get(revision.id)
    return matchedChat
      ? `act_chat_${matchedChat.id}`
      : `act_revision_${revision.id}`
  }

  // Comments on AI definitions are mirrored into the chat thread as
  // "<feedback>\n<text>" user rows. Pair them one-to-one and use the
  // revision-scoped comment as the canonical entity.
  const mirroredChatIds = new Set<number>()
  const feedbackEntityForChat = new Map<number, string>()
  const matchedCommentIds = new Set<number>()
  for (const chat of chats.filter((row) => row.role === "user")) {
    const match = comments.find(
      (comment) =>
        !matchedCommentIds.has(comment.id) &&
        `<feedback>\n${comment.message}` === chat.message &&
        (chat.authorId === null || chat.authorId === comment.author.id)
    )
    if (!match) continue
    matchedCommentIds.add(match.id)
    mirroredChatIds.add(chat.id)
    feedbackEntityForChat.set(chat.id, `comment_${match.id}`)
  }

  // --- immutable definition revisions ---
  for (const definition of definitions) {
    const definitionRevisions = revisions.filter(
      (revision) => revision.definitionId === definition.id
    )
    for (const revision of definitionRevisions) {
      const id = revisionNodeId(definition.id, revision.version)
      const isCurrent = definition.currentRevisionId === revision.id
      const stableDefinitionUri = definitionUri(
        term.slug,
        definition.definitionNumber,
        term.vocabularySlug
      )
      const previousRevision =
        revision.previousRevisionId === null
          ? undefined
          : revisionById.get(revision.previousRevisionId)
      const meta: Record<string, string | number | null> = {
        definitionId: definition.id,
        definitionNumber: definition.definitionNumber,
        revisionId: revision.id,
        version: revision.version,
        published: revision.createdAt,
        source: revision.source,
        score: scoreByRevisionId.get(revision.id) ?? 0,
        current: isCurrent ? "yes" : "no",
        legacyIncomplete: revision.legacyIncomplete ? "yes" : "no"
      }

      if (revision.previousRevisionId !== null)
        meta.previousRevisionId = revision.previousRevisionId
      if (revision.derivedFromRevisionId !== null)
        meta.derivedFromRevisionId = revision.derivedFromRevisionId
      if (revision.exampleDiff !== null)
        meta.example = diffToStringSimple(revision.exampleDiff)
      if (revision.editorId !== null) meta.editorId = revision.editorId
      if (revision.editor?.name) meta.editor = revision.editor.name
      if (revision.changeNote !== null) meta.changeNote = revision.changeNote
      if (revision.model !== null) meta.model = revision.model
      if (revision.prompt !== null) meta.prompt = revision.prompt
      if (revision.sourceRefinementId !== null)
        meta.sourceRefinementId = revision.sourceRefinementId

      addNode({
        id,
        label: `${revisionLabel(revision)}${isCurrent ? " (current)" : ""}`,
        type: "entity",
        publicResource: {
          uri: revisionUri(
            term.slug,
            definition.definitionNumber,
            revision.version,
            term.vocabularySlug
          ),
          specializationOf: stableDefinitionUri,
          ...(previousRevision
            ? {
                wasRevisionOf: revisionUri(
                  term.slug,
                  definition.definitionNumber,
                  previousRevision.version,
                  term.vocabularySlug
                )
              }
            : {})
        },
        detail: diffToStringSimple(revision.definitionDiff),
        meta
      })

      if (revision.previousRevisionId === null)
        addEdge(id, termNode, "wasDerivedFrom")
      else {
        if (previousRevision)
          addEdge(
            id,
            revisionNodeId(
              previousRevision.definitionId,
              previousRevision.version
            ),
            "wasDerivedFrom"
          )
      }

      // The chronological predecessor records sequence; this independently
      // stored pointer records the exact content source for restores and
      // cross-definition derivations.
      if (revision.derivedFromRevisionId !== null) {
        const derivedFrom = revisionById.get(revision.derivedFromRevisionId)
        if (derivedFrom)
          addEdge(
            id,
            revisionNodeId(derivedFrom.definitionId, derivedFrom.version),
            "wasDerivedFrom"
          )
      }

      const matchedChat = chatForRevision.get(revision.id)
      const activityId = revisionActivityId(revision)
      const activityLabel =
        revision.source === "rollback"
          ? "Restore earlier revision"
          : revision.source === "ai_assisted"
            ? "Publish AI-assisted contribution"
            : revision.source === "ai_refinement"
              ? "Accept AI suggestion"
              : revision.source === "ai_generation"
                ? revision.version === 1
                  ? "Generate definition"
                  : "Regenerate definition"
                : revision.source === "author_edit"
                  ? "Edit definition"
                  : revision.source === "legacy"
                    ? "Imported historical revision"
                    : "Write definition"

      addNode({
        id: activityId,
        label: activityLabel,
        type: "activity",
        meta: {
          at: revision.createdAt,
          revisionId: revision.id,
          source: revision.source
        }
      })
      addEdge(id, activityId, "wasGeneratedBy")

      if (revision.version === 1 && definition.replacesDefinitionId !== null) {
        const replacementTarget = definitionById.get(
          definition.replacesDefinitionId
        )
        if (replacementTarget)
          addEdge(
            activityId,
            stableDefinitionNodeId(replacementTarget.definitionNumber),
            "used"
          )
      }

      if (revision.editor) {
        const editorNode = revision.editor.isAi
          ? modelNode(
              revision.model ??
                revision.editor.name ??
                `AI user ${revision.editor.id}`,
              revision.editor.id
            )
          : personNode(revision.editor)
        addEdge(activityId, editorNode, "wasAssociatedWith")
        addEdge(id, editorNode, "wasAttributedTo")
      }

      if (
        revision.model &&
        (revision.source === "ai_assisted" ||
          revision.source === "ai_generation" ||
          revision.source === "ai_refinement")
      ) {
        const model = modelNode(revision.model)
        addEdge(id, model, "wasAttributedTo")
        if (
          revision.source === "ai_assisted" ||
          revision.source === "ai_generation"
        )
          addEdge(activityId, model, "wasAssociatedWith")
      }

      if (revision.prompt) {
        const prompt =
          matchedChat?.promptHash && matchedChat.promptText === revision.prompt
            ? promptNode(
                matchedChat.promptHash,
                matchedChat.promptText,
                matchedChat.promptKey
              )
            : revisionPromptNode(revision)
        addEdge(activityId, prompt, "used")
      }

      const actor =
        revision.editor === null
          ? {
              name: "unknown",
              kind: "unknown" as const,
              profileUserId: undefined
            }
          : revision.editor.isAi
            ? {
                name:
                  revision.model ??
                  revision.editor.name ??
                  `AI user ${revision.editor.id}`,
                kind: "software" as const,
                profileUserId: undefined
              }
            : {
                name: revision.editor.name ?? `User ${revision.editor.id}`,
                kind: "person" as const,
                profileUserId: publicProfileUserId(revision.editor)
              }

      const isAiGeneration = revision.source === "ai_generation"
      const kind =
        isAiGeneration && revision.version === 1
          ? ("ai-generation" as const)
          : isAiGeneration
            ? ("ai-revision" as const)
            : revision.version === 1
              ? ("definition-created" as const)
              : ("definition-edited" as const)
      const summary =
        revision.source === "legacy"
          ? `Imported historical ${revisionCoordinate(revision)} snapshot`
          : revision.source === "rollback"
            ? `Earlier content restored as ${revisionCoordinate(revision)}`
            : revision.source === "ai_assisted"
              ? `${revisionLabel(revision)} published with AI assistance`
              : revision.source === "ai_refinement"
                ? `${revisionLabel(revision)} published with AI assistance`
                : isAiGeneration
                  ? `${revisionLabel(revision)} generated by AI`
                  : revision.version === 1
                    ? `${revisionLabel(revision)} written`
                    : `${revisionLabel(revision)} revised`
      const detail = revision.changeNote
        ? `${revision.changeNote}\n\n${excerpt(diffToStringSimple(revision.definitionDiff))}`
        : excerpt(diffToStringSimple(revision.definitionDiff))

      events.push({
        id:
          revision.version === 1
            ? `def_${definition.id}_created`
            : `revision_${revision.id}`,
        at: revision.createdAt,
        kind,
        actor: actor.name,
        actorKind: actor.kind,
        profileUserId: actor.profileUserId,
        summary,
        detail,
        model:
          isAiGeneration || revision.source === "ai_assisted"
            ? revision.model
            : null,
        promptRef: matchedChat
          ? (matchedChat.promptKey ?? matchedChat.promptHash)
          : revision.prompt
            ? `revision ${revision.id}`
            : null
      })
    }
  }

  // --- immutable examples and featured-example decisions ---
  // Examples have no standalone published identifier, so their RDF nodes are
  // document-scoped blank nodes. Their graph ids use the permanent public
  // definition/example coordinates rather than database row ids.
  for (const example of definitionExamples) {
    const definition = definitionById.get(example.definitionId)
    const sourceRevision = revisionById.get(example.sourceRevisionId)
    if (!definition || !sourceRevision) continue

    const id = exampleNodeId(definition.definitionNumber, example.exampleNumber)
    const sourceVersion = revisionNodeId(
      sourceRevision.definitionId,
      sourceRevision.version
    )
    const activityId = `act_${id}`
    const hasObservedOrigin = !example.legacyBackfill
    const hasGenerationStamp =
      hasObservedOrigin &&
      example.promptHash !== null &&
      example.promptText !== null &&
      example.model !== null

    addNode({
      id,
      label: `Definition ${definition.definitionNumber} · example ${example.exampleNumber}`,
      type: "entity",
      rdfBlankNode: `example_${blankNodeScope}_${definition.definitionNumber}_${example.exampleNumber}`,
      detail: example.text,
      meta: hasObservedOrigin
        ? {
            definitionNumber: definition.definitionNumber,
            exampleNumber: example.exampleNumber,
            published: example.createdAt,
            withdrawnAt: example.withdrawnAt,
            actorKind: example.actorKind,
            legacyBackfill: "no",
            model: example.model
          }
        : {
            definitionNumber: definition.definitionNumber,
            exampleNumber: example.exampleNumber,
            legacyBackfill: "yes",
            origin:
              "Imported legacy example; exact source, actor, and time were not recorded",
            withdrawnAt: example.withdrawnAt
          }
    })
    addNode({
      id: activityId,
      label: example.legacyBackfill
        ? "Import legacy example"
        : hasGenerationStamp
          ? "Generate and publish example"
          : "Publish example",
      type: "activity",
      rdfBlankNode: `publishExample_${blankNodeScope}_${definition.definitionNumber}_${example.exampleNumber}`,
      meta: hasObservedOrigin
        ? {
            at: example.createdAt,
            actorKind: example.actorKind,
            legacyBackfill: "no",
            model: example.model
          }
        : {
            legacyBackfill: "yes",
            origin: "Legacy import; publication time was not recorded"
          }
    })
    addEdge(id, activityId, "wasGeneratedBy")
    if (hasObservedOrigin) {
      addEdge(id, sourceVersion, "wasDerivedFrom")
      addEdge(activityId, sourceVersion, "used")
    }
    addEdge(
      activityId,
      stableDefinitionNodeId(definition.definitionNumber),
      "used"
    )

    if (hasObservedOrigin && example.author) {
      const author = personNode(example.author)
      addEdge(id, author, "wasAttributedTo")
      addEdge(activityId, author, "wasAssociatedWith")
    }

    if (hasGenerationStamp) {
      const model = modelNode(
        example.model!,
        example.actorKind === "model"
          ? (example.author?.id ?? undefined)
          : undefined
      )
      const prompt = promptNode(
        example.promptHash!,
        example.promptText,
        example.promptKey
      )
      addEdge(id, model, "wasAttributedTo")
      addEdge(activityId, model, "wasAssociatedWith")
      addEdge(activityId, prompt, "used")
    }
  }

  for (const [index, selection] of exampleSelections.entries()) {
    const definition = definitionById.get(selection.definitionId)
    const example = exampleById.get(selection.exampleId)
    if (!definition || !example) continue

    const exampleId = exampleNodeId(
      definition.definitionNumber,
      example.exampleNumber
    )
    const selectionCoordinate = `${blankNodeScope}_${definition.definitionNumber}_${index + 1}`
    const selectionActivityId = `act_feature_${selectionCoordinate}`
    const featuredStateId = `featured_${selectionCoordinate}`
    const hasObservedSelection = !selection.legacyBackfill

    addNode({
      id: selectionActivityId,
      label: selection.legacyBackfill
        ? `Import featured state for example ${example.exampleNumber}`
        : `Feature example ${example.exampleNumber}`,
      type: "activity",
      rdfBlankNode: `featureExample_${selectionCoordinate}`,
      meta: hasObservedSelection
        ? {
            at: selection.selectedAt,
            decision: "feature",
            legacyBackfill: "no"
          }
        : {
            decision: "import legacy featured state",
            legacyBackfill: "yes",
            origin: "Selector and selection time were not recorded"
          }
    })
    addEdge(selectionActivityId, exampleId, "used")
    addEdge(
      selectionActivityId,
      stableDefinitionNodeId(definition.definitionNumber),
      "used"
    )
    if (hasObservedSelection && selection.selectedBy)
      addEdge(
        selectionActivityId,
        personNode(selection.selectedBy),
        "wasAssociatedWith"
      )

    addNode({
      id: featuredStateId,
      label: `Featured example ${example.exampleNumber}`,
      type: "entity",
      rdfBlankNode: `featuredExample_${selectionCoordinate}`,
      meta: hasObservedSelection
        ? {
            definitionNumber: definition.definitionNumber,
            exampleNumber: example.exampleNumber,
            selectedAt: selection.selectedAt,
            endedAt: selection.endedAt,
            state: selection.endedAt === null ? "active" : "ended",
            legacyBackfill: "no"
          }
        : {
            definitionNumber: definition.definitionNumber,
            exampleNumber: example.exampleNumber,
            endedAt: selection.endedAt,
            state: selection.endedAt === null ? "active" : "ended",
            legacyBackfill: "yes",
            origin: "Selection time was not recorded"
          }
    })
    addEdge(featuredStateId, selectionActivityId, "wasGeneratedBy")
    addEdge(featuredStateId, exampleId, "wasDerivedFrom")

    if (selection.endedAt !== null) {
      const endingActivityId = `act_end_feature_${selectionCoordinate}`
      addNode({
        id: endingActivityId,
        label: `End featured status for example ${example.exampleNumber}`,
        type: "activity",
        rdfBlankNode: `endFeatureExample_${selectionCoordinate}`,
        meta: { at: selection.endedAt, decision: "end feature interval" }
      })
      addEdge(endingActivityId, featuredStateId, "used")
      addEdge(
        endingActivityId,
        stableDefinitionNodeId(definition.definitionNumber),
        "used"
      )
      if (selection.endedBy)
        addEdge(
          endingActivityId,
          personNode(selection.endedBy),
          "wasAssociatedWith"
        )
    }
  }

  // --- term-level AI transcript activities ---
  for (const [index, chat] of chats.entries()) {
    if (chat.role === "user") {
      if (!mirroredChatIds.has(chat.id)) {
        const id = `chat_${chat.id}`
        addNode({
          id,
          label: index === 0 ? "Initial message" : "Feedback",
          type: "entity",
          detail: chat.message
        })
        feedbackEntityForChat.set(chat.id, id)
        if (chat.authorId !== null)
          addEdge(
            id,
            personNode({
              id: chat.authorId,
              name: chat.authorName,
              isAi: chat.authorIsAi,
              isProfilePublic: chat.authorProfilePublic
            }),
            "wasAttributedTo"
          )
        events.push({
          id,
          at: chat.createdAt,
          kind: index === 0 ? "initial-message" : "feedback",
          actor: chat.authorName ?? "user",
          actorKind: chat.authorName ? "person" : "unknown",
          profileUserId:
            chat.authorId === null
              ? undefined
              : publicProfileUserId({
                  id: chat.authorId,
                  name: chat.authorName,
                  isAi: chat.authorIsAi,
                  isProfilePublic: chat.authorProfilePublic
                }),
          summary:
            index === 0 ? "Initial message submitted" : "Feedback for the AI",
          detail: excerpt(chat.message)
        })
      }
      continue
    }

    const matchedRevision = revisionForChat.get(chat.id)
    const activityId = `act_chat_${chat.id}`
    const systemIndex = chats
      .slice(0, index + 1)
      .filter((row) => row.role === "system").length
    addNode({
      id: activityId,
      label:
        matchedRevision?.version === 1 ||
        (!matchedRevision && systemIndex === 1)
          ? "Generate definition"
          : "Revise definition",
      type: "activity",
      meta: {
        at: matchedRevision?.createdAt ?? chat.createdAt,
        model: chat.model
      }
    })

    if (chat.model)
      addEdge(activityId, modelNode(chat.model), "wasAssociatedWith")
    if (chat.promptHash)
      addEdge(
        activityId,
        promptNode(chat.promptHash, chat.promptText, chat.promptKey),
        "used"
      )

    // The activity consumed everything the user said since the prior AI
    // response. Mirrored feedback resolves to its revision-scoped comment.
    for (let priorIndex = index - 1; priorIndex >= 0; priorIndex--) {
      const prior = chats[priorIndex]
      if (prior.role === "system") break
      const feedback = feedbackEntityForChat.get(prior.id)
      if (feedback) addEdge(activityId, feedback, "used")
    }

    // A matched revision already supplied the canonical timeline event.
    if (matchedRevision) continue

    events.push({
      id: `chat_${chat.id}`,
      at: chat.createdAt,
      kind: systemIndex === 1 ? "ai-generation" : "ai-revision",
      actor: chat.model ?? "AI",
      actorKind: "software",
      summary:
        systemIndex === 1
          ? "AI generated a definition"
          : "AI revised its definition",
      detail: excerpt(chat.message),
      model: chat.model,
      promptRef: chat.promptKey ?? chat.promptHash
    })
  }

  // --- interactive refinement rounds ---
  for (const round of refinements) {
    const definition = definitionById.get(round.definitionId)
    if (!definition) continue
    const authorName = definition.author
      ? (definition.author.name ?? `User ${definition.author.id}`)
      : "unknown"
    const sourceRevision = revisionById.get(round.sourceRevisionId)
    const sourceVersion = sourceRevision
      ? revisionNodeId(sourceRevision.definitionId, sourceRevision.version)
      : null

    const activityId = `act_refine_${round.id}`
    addNode({
      id: activityId,
      label: `Refine definition (round ${round.round})`,
      type: "activity",
      meta: {
        at: round.createdAt,
        model: round.model,
        status: round.status,
        sourceRevisionId: round.sourceRevisionId
      }
    })
    if (definition.author)
      addEdge(activityId, personNode(definition.author), "wasAssociatedWith")
    if (round.model)
      addEdge(activityId, modelNode(round.model), "wasAssociatedWith")
    if (round.promptHash)
      addEdge(
        activityId,
        promptNode(round.promptHash, round.promptText, round.promptKey),
        "used"
      )
    if (sourceVersion) addEdge(activityId, sourceVersion, "used")

    if (round.userComment) {
      const feedbackId = `refine_feedback_${round.id}`
      addNode({
        id: feedbackId,
        label: `Refine feedback (round ${round.round})`,
        type: "entity",
        detail: round.userComment
      })
      if (definition.author)
        addEdge(feedbackId, personNode(definition.author), "wasAttributedTo")
      addEdge(activityId, feedbackId, "used")
    }

    events.push({
      id: `refine_req_${round.id}`,
      at: round.createdAt,
      kind: "refine-requested",
      actor: authorName,
      actorKind: definition.author ? "person" : "unknown",
      profileUserId: publicProfileUserId(definition.author),
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

    if (!round.suggestedDefinition) continue

    const suggestionId = `refine_sug_${round.id}`
    const suggestionMeta: Record<string, string | number | null> = {
      sourceRevisionId: round.sourceRevisionId
    }
    if (round.suggestedExample !== null)
      suggestionMeta.example = round.suggestedExample
    addNode({
      id: suggestionId,
      label: `Suggestion (round ${round.round})`,
      type: "entity",
      detail: round.suggestedDefinition,
      meta: suggestionMeta
    })
    addEdge(suggestionId, activityId, "wasGeneratedBy")
    if (round.model)
      addEdge(suggestionId, modelNode(round.model), "wasAttributedTo")

    events.push({
      id: suggestionId,
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
      const publishedRevision = revisions.find(
        (revision) => revision.sourceRefinementId === round.id
      )
      if (publishedRevision) {
        const publishedVersion = revisionNodeId(
          publishedRevision.definitionId,
          publishedRevision.version
        )
        addEdge(publishedVersion, suggestionId, "wasDerivedFrom")
        if (sourceVersion)
          addEdge(publishedVersion, sourceVersion, "wasDerivedFrom")
      }

      events.push({
        id: `refine_acc_${round.id}`,
        at: round.decidedAt ?? round.suggestedAt ?? round.createdAt,
        kind: "refine-accepted",
        actor: authorName,
        actorKind: definition.author ? "person" : "unknown",
        profileUserId: publicProfileUserId(definition.author),
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
        actorKind: definition.author ? "person" : "unknown",
        profileUserId: publicProfileUserId(definition.author),
        summary: `Author kept their original (round ${round.round})`
      })
  }

  // --- accepted canonical AI contribution suggestions ---
  // The preview is a first-class entity rather than being collapsed into the
  // published revision: a contributor may edit it before accepting it. This
  // keeps the model's exact output, every exact input, and the final human-
  // published output distinguishable while the accepted output foreign key
  // supplies their authoritative linkage.
  for (const suggestion of aiContributionSuggestions) {
    if (
      suggestion.status !== "accepted" ||
      suggestion.outputDefinitionId === null
    )
      continue

    const requesterName =
      suggestion.requester.name ?? `User ${suggestion.requester.id}`
    const requesterKind = suggestion.requester.isAi
      ? ("software" as const)
      : ("person" as const)
    const requester = personNode(suggestion.requester)
    const model = modelNode(suggestion.model)
    const sourceRevision =
      suggestion.sourceRevisionId === null
        ? undefined
        : revisionById.get(suggestion.sourceRevisionId)
    const sourceVersion = sourceRevision
      ? revisionNodeId(sourceRevision.definitionId, sourceRevision.version)
      : null
    const outputRevision = revisions.find(
      (revision) =>
        revision.definitionId === suggestion.outputDefinitionId &&
        revision.version === 1
    )
    const outputVersion = outputRevision
      ? revisionNodeId(outputRevision.definitionId, outputRevision.version)
      : null

    const requestId = `ai_contribution_request_${suggestion.id}`
    addNode({
      id: requestId,
      label:
        suggestion.intent === "new_term"
          ? `New-term AI request by ${requesterName}`
          : `Revision AI request by ${requesterName}`,
      type: "entity",
      detail: suggestion.termText,
      meta: {
        intent: suggestion.intent,
        termText: suggestion.termText,
        requestedAt: suggestion.createdAt,
        acceptedAt: suggestion.decidedAt
      }
    })
    addEdge(requestId, requester, "wasAttributedTo")

    const prompt = promptNode(
      suggestion.promptHash,
      suggestion.promptText,
      suggestion.promptKey
    )
    const activityId = `act_ai_contribution_suggestion_${suggestion.id}`
    addNode({
      id: activityId,
      label:
        suggestion.intent === "new_term"
          ? "Generate new-term suggestion"
          : "Generate revision suggestion",
      type: "activity",
      meta: {
        at: suggestion.createdAt,
        intent: suggestion.intent,
        model: suggestion.model,
        status: suggestion.status,
        acceptedAt: suggestion.decidedAt,
        sourceRevisionId: suggestion.sourceRevisionId,
        outputDefinitionId: suggestion.outputDefinitionId
      }
    })
    addEdge(activityId, model, "wasAssociatedWith")
    addEdge(activityId, requester, "wasAssociatedWith")
    addEdge(activityId, prompt, "used")
    addEdge(activityId, requestId, "used")
    if (sourceVersion) addEdge(activityId, sourceVersion, "used")

    if (suggestion.inputDefinition !== null) {
      const inputId = `ai_contribution_input_${suggestion.id}`
      addNode({
        id: inputId,
        label:
          suggestion.intent === "new_term"
            ? "Contributor notes supplied to the model"
            : "Source definition supplied to the model",
        type: "entity",
        detail: suggestion.inputDefinition,
        meta: { intent: suggestion.intent }
      })
      addEdge(activityId, inputId, "used")
      if (suggestion.intent === "new_term")
        addEdge(inputId, requester, "wasAttributedTo")
      else if (sourceVersion) addEdge(inputId, sourceVersion, "wasDerivedFrom")
    }

    if (suggestion.feedback !== null) {
      const feedbackId = `ai_contribution_feedback_${suggestion.id}`
      addNode({
        id: feedbackId,
        label: `Revision feedback by ${requesterName}`,
        type: "entity",
        detail: suggestion.feedback,
        meta: {
          requestedAt: suggestion.createdAt,
          sourceRevisionId: suggestion.sourceRevisionId
        }
      })
      addEdge(feedbackId, requester, "wasAttributedTo")
      if (sourceVersion) addEdge(feedbackId, sourceVersion, "wasDerivedFrom")
      addEdge(activityId, feedbackId, "used")
    }

    const suggestionId = `ai_contribution_suggestion_${suggestion.id}`
    addNode({
      id: suggestionId,
      label:
        suggestion.intent === "new_term"
          ? "Accepted new-term AI suggestion"
          : "Accepted revision AI suggestion",
      type: "entity",
      detail: suggestion.suggestedDefinition,
      meta: {
        intent: suggestion.intent,
        termText: suggestion.termText,
        model: suggestion.model,
        status: suggestion.status,
        generatedAt: suggestion.createdAt,
        acceptedAt: suggestion.decidedAt,
        sourceRevisionId: suggestion.sourceRevisionId,
        outputDefinitionId: suggestion.outputDefinitionId,
        ...(outputRevision !== undefined
          ? { outputRevisionId: outputRevision.id }
          : {})
      }
    })
    addEdge(suggestionId, activityId, "wasGeneratedBy")
    addEdge(suggestionId, model, "wasAttributedTo")
    if (sourceVersion) addEdge(suggestionId, sourceVersion, "wasDerivedFrom")

    if (outputRevision && outputVersion) {
      addEdge(outputVersion, suggestionId, "wasDerivedFrom")
      if (sourceVersion) addEdge(outputVersion, sourceVersion, "wasDerivedFrom")
      addEdge(outputVersion, model, "wasAttributedTo")

      const publicationActivity = revisionActivityId(outputRevision)
      addEdge(publicationActivity, suggestionId, "used")
      if (sourceVersion) addEdge(publicationActivity, sourceVersion, "used")
      addEdge(publicationActivity, requester, "wasAssociatedWith")
    }

    events.push({
      id: requestId,
      at: suggestion.createdAt,
      kind: suggestion.intent === "new_term" ? "initial-message" : "feedback",
      actor: requesterName,
      actorKind: requesterKind,
      profileUserId: publicProfileUserId(suggestion.requester),
      summary:
        suggestion.intent === "new_term"
          ? `AI assistance requested for new term “${suggestion.termText}”`
          : sourceRevision
            ? `Revision guidance submitted for ${revisionCoordinate(sourceRevision)}`
            : "Revision guidance submitted",
      detail:
        suggestion.feedback !== null
          ? excerpt(suggestion.feedback)
          : suggestion.inputDefinition !== null
            ? excerpt(suggestion.inputDefinition)
            : undefined
    })
    events.push({
      id: suggestionId,
      at: suggestion.createdAt,
      kind:
        suggestion.intent === "new_term" ? "ai-generation" : "refine-suggested",
      actor: suggestion.model,
      actorKind: "software",
      summary:
        suggestion.intent === "new_term"
          ? "AI generated a new-term suggestion"
          : "AI generated a revision suggestion",
      detail: excerpt(suggestion.suggestedDefinition),
      model: suggestion.model,
      promptRef: suggestion.promptKey ?? suggestion.promptHash
    })
  }

  // --- accepted discussion suggestions ---
  // These records persist the request, exact model output, source revision, and
  // output stable definition. Link an output revision only when its immutable
  // v1 snapshot confirms every stored field and derivation pointer.
  for (const suggestion of discussionSuggestions) {
    if (
      suggestion.acceptedAt === null ||
      suggestion.outputDefinitionId === null
    )
      continue

    const sourceRevision = revisionById.get(suggestion.revisionId)
    const sourceVersion = sourceRevision
      ? revisionNodeId(sourceRevision.definitionId, sourceRevision.version)
      : null
    const outputRevision = revisions.find(
      (revision) =>
        revision.definitionId === suggestion.outputDefinitionId &&
        revision.version === 1 &&
        revision.derivedFromRevisionId === suggestion.revisionId &&
        revision.exampleDiff !== null &&
        diffToStringSimple(revision.definitionDiff) ===
          suggestion.suggestedDefinition &&
        diffToStringSimple(revision.exampleDiff) ===
          suggestion.suggestedExample &&
        revision.model === suggestion.model &&
        revision.prompt === suggestion.prompt
    )
    const outputVersion = outputRevision
      ? revisionNodeId(outputRevision.definitionId, outputRevision.version)
      : null

    const feedbackId = `discussion_feedback_${suggestion.id}`
    addNode({
      id: feedbackId,
      label: `Discussion feedback by ${
        suggestion.requester.name ?? `User ${suggestion.requester.id}`
      }`,
      type: "entity",
      detail: suggestion.comment,
      meta: {
        sourceRevisionId: suggestion.revisionId,
        requestedAt: suggestion.createdAt
      }
    })
    addEdge(feedbackId, personNode(suggestion.requester), "wasAttributedTo")

    const promptId = `prompt_discussion_${suggestion.id}`
    addNode({
      id: promptId,
      label: "Stored discussion-refinement prompt",
      type: "entity",
      detail: suggestion.prompt,
      meta: { suggestionId: suggestion.id }
    })

    const activityId = `act_discussion_suggestion_${suggestion.id}`
    addNode({
      id: activityId,
      label: "Generate discussion revision suggestion",
      type: "activity",
      meta: {
        at: suggestion.createdAt,
        model: suggestion.model,
        sourceRevisionId: suggestion.revisionId
      }
    })
    addEdge(activityId, modelNode(suggestion.model), "wasAssociatedWith")
    addEdge(activityId, promptId, "used")
    addEdge(activityId, feedbackId, "used")
    if (sourceVersion) addEdge(activityId, sourceVersion, "used")

    const suggestionId = `discussion_suggestion_${suggestion.id}`
    const suggestionMeta: Record<string, string | number | null> = {
      sourceRevisionId: suggestion.revisionId,
      outputDefinitionId: suggestion.outputDefinitionId,
      generatedAt: suggestion.createdAt,
      acceptedAt: suggestion.acceptedAt,
      model: suggestion.model,
      example: suggestion.suggestedExample
    }
    if (outputRevision) suggestionMeta.outputRevisionId = outputRevision.id
    addNode({
      id: suggestionId,
      label: "Accepted discussion revision suggestion",
      type: "entity",
      detail: suggestion.suggestedDefinition,
      meta: suggestionMeta
    })
    addEdge(suggestionId, activityId, "wasGeneratedBy")
    addEdge(suggestionId, modelNode(suggestion.model), "wasAttributedTo")
    if (sourceVersion) addEdge(suggestionId, sourceVersion, "wasDerivedFrom")

    events.push({
      id: feedbackId,
      at: suggestion.createdAt,
      kind: "feedback",
      actor: suggestion.requester.name ?? `User ${suggestion.requester.id}`,
      actorKind: "person",
      profileUserId: publicProfileUserId(suggestion.requester),
      summary: sourceRevision
        ? `Revision feedback submitted on ${revisionCoordinate(sourceRevision)}`
        : "Revision feedback submitted",
      detail: excerpt(suggestion.comment)
    })
    events.push({
      id: suggestionId,
      at: suggestion.createdAt,
      kind: "refine-suggested",
      actor: suggestion.model,
      actorKind: "software",
      summary: "AI generated a discussion revision suggestion",
      detail: excerpt(suggestion.suggestedDefinition),
      model: suggestion.model,
      promptRef: "stored discussion prompt"
    })

    if (outputRevision && outputVersion) {
      addEdge(outputVersion, suggestionId, "wasDerivedFrom")
      if (sourceVersion) addEdge(outputVersion, sourceVersion, "wasDerivedFrom")

      const acceptanceActivity = revisionActivityId(outputRevision)
      addEdge(acceptanceActivity, suggestionId, "used")
      if (sourceVersion) addEdge(acceptanceActivity, sourceVersion, "used")
      addEdge(
        acceptanceActivity,
        personNode(suggestion.requester),
        "wasAssociatedWith"
      )
    }

    events.push({
      id: `discussion_accept_${suggestion.id}`,
      at: suggestion.acceptedAt,
      kind: "refine-accepted",
      actor: suggestion.requester.name ?? `User ${suggestion.requester.id}`,
      actorKind: "person",
      profileUserId: publicProfileUserId(suggestion.requester),
      summary: outputRevision
        ? `Discussion suggestion accepted and published as ${revisionCoordinate(outputRevision)}`
        : "Discussion suggestion accepted",
      detail: excerpt(suggestion.suggestedDefinition)
    })
  }

  // --- revision-scoped comments ---
  for (const comment of comments) {
    const id = `comment_${comment.id}`
    const revision = revisionById.get(comment.revisionId)
    const versionId = revision
      ? revisionNodeId(revision.definitionId, revision.version)
      : null
    const commentMeta: Record<string, string | number | null> = {
      revisionId: comment.revisionId,
      actorKind: comment.authorKind,
      legacyAssociationInferred: comment.migratedLegacy ? "yes" : "no"
    }
    if (revision) commentMeta.version = revision.version
    if (comment.model) commentMeta.model = comment.model
    if (comment.promptKey) commentMeta.promptKey = comment.promptKey
    if (comment.promptHash) commentMeta.promptHash = comment.promptHash

    addNode({
      id,
      label: `Comment by ${comment.author.name ?? "user"}`,
      type: "entity",
      detail: comment.message,
      meta: commentMeta
    })
    addEdge(id, personNode(comment.author), "wasAttributedTo")
    if (versionId) addEdge(id, versionId, "wasDerivedFrom")
    events.push({
      id,
      at: comment.createdAt,
      kind: "comment",
      actor: comment.author.name ?? `User ${comment.author.id}`,
      actorKind: comment.author.isAi ? "software" : "person",
      agency: comment.authorKind,
      profileUserId: publicProfileUserId(comment.author),
      summary: revision
        ? `Comment posted on ${revisionCoordinate(revision)}`
        : `Comment posted on revision ${comment.revisionId}`,
      detail: excerpt(comment.message),
      model: comment.model,
      promptRef: comment.promptKey ?? comment.promptHash
    })
  }

  // --- revision-scoped votes ---
  // One activity per vote event: cast, change, withdrawal, and the one act
  // the backfill wrote for a vote cast before the record began. A migrated
  // row discloses its inferred binding, and a backfilled row says so, the
  // same way; an event written by a vote says neither.
  for (const [voteIndex, act] of voteEvents.entries()) {
    const revision = revisionById.get(act.revisionId)
    const definition = definitionById.get(act.definitionId)
    const activityId = options.anonymizeVoters
      ? `anonymous_vote_${voteIndex + 1}`
      : `vote_event_${act.id}`
    const versionId = revision
      ? revisionNodeId(revision.definitionId, revision.version)
      : null
    const verb =
      act.kind === null
        ? "Vote withdrawn"
        : act.kind === "up"
          ? "Upvote"
          : "Downvote"
    const voteMeta: Record<string, string | number | null> = {
      at: act.createdAt,
      revisionId: act.revisionId,
      actorKind: act.actorKind,
      legacyAssociationInferred: act.migratedLegacy ? "yes" : "no"
    }
    if (act.backfilled) voteMeta.backfilled = "yes"
    addNode({
      id: activityId,
      label: `${verb}${revision ? ` on ${revisionCoordinate(revision)}` : ""}`,
      type: "activity",
      meta: voteMeta
    })
    if (versionId) addEdge(activityId, versionId, "used")
    if (!options.anonymizeVoters)
      addEdge(activityId, personNode(act.author), "wasAssociatedWith")

    events.push({
      id: activityId,
      at: act.createdAt,
      kind: "vote",
      actor: options.anonymizeVoters
        ? "A community member"
        : (act.author.name ?? `User ${act.author.id}`),
      actorKind: act.author.isAi ? "software" : "person",
      agency: act.actorKind,
      profileUserId: options.anonymizeVoters
        ? undefined
        : publicProfileUserId(act.author),
      summary:
        act.kind === null
          ? `Withdrew their vote on ${revision ? revisionCoordinate(revision) : "the definition"}`
          : `${act.kind === "up" ? "Upvoted" : "Downvoted"} ${
              definition?.author?.isAi ? "AI-authored " : ""
            }${revision ? revisionCoordinate(revision) : "definition"}`
    })
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  return {
    // slug carried so the RDF serialization can build the concept IRI, which
    // is slug-based (lib/skos.ts termUri)
    term: {
      id: term.id,
      term: term.term,
      slug: term.slug,
      vocabularySlug: term.vocabularySlug
    },
    events,
    graph: { nodes, edges }
  }
}
