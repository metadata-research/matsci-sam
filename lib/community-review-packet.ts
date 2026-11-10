import "server-only"
import { createHash } from "node:crypto"
import { TRPCError } from "@trpc/server"
import { and, asc, desc, eq, inArray, notExists, sql } from "drizzle-orm"
import {
  communitiesTable as communities,
  definitionsTable as definitions,
  definitionRevisionsTable as revisions,
  definitionRevisionReferencesTable as references,
  termReferenceEntriesTable as referenceEntries,
  revisionManualCitationsTable as manualCitations,
  contributionFilesTable as files,
  termsTable as terms,
  usersTable as users,
  commentsTable as comments,
  votesTable as votes,
  voteEventsTable as voteEvents,
  matcoreSpecRevisionsTable as proposals,
  matcoreWorkflowEventsTable as proposalEvents,
  matcoreSourceOccurrencesTable as occurrences,
  matcoreSourceReleasesTable as releases,
  vocabularyMatcoreSourcesTable as grants,
  communityReviewRoundsTable as rounds,
  communityReviewItemsTable as reviewItems,
  communityReviewResponsesTable as responses
} from "@yamz/db"
import {
  communityAccess,
  vocabularyContentVisible,
  type CommunityReader
} from "./community-access"
import { participationContentVisible } from "./content-access"
import { diffToStringSimple } from "./definition-comparison"
import { getMatcoreField } from "./matcore-workflow"
import { communityReviewExerciseRevisions } from "./community-reviews"
import { hasReviewFeedback } from "./community-review-exercise-types"
import { reviewPacketContent as content } from "./community-review-packet-content"
import type { MatcoreDraftPayload } from "./matcore-workflow-types"
import { revisionPath } from "./public-identifiers"
import { termIsListed } from "./term-visibility"
import {
  REVIEW_PACKET_BYTE_LIMIT,
  REVIEW_PACKET_ROW_LIMIT,
  reviewPacketRequestSchema,
  reviewPacketSourceUrl,
  type CommunityReviewPacket,
  type ReviewPacketContent,
  type ReviewPacketDatasetExample,
  type ReviewPacketFeedback,
  type ReviewPacketItem,
  type ReviewPacketRequest,
  type ReviewPacketSource
} from "./community-review-packet-types"

const unavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "A selected contribution is unavailable in this community."
  })
function bounded<T>(rows: T[]): T[] {
  if (rows.length > REVIEW_PACKET_ROW_LIMIT)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This packet has too much history or feedback. Export fewer contributions or contact an administrator."
    })
  return rows
}
function sources(payload: MatcoreDraftPayload): ReviewPacketSource[] {
  return payload.citations.map((citation) => ({
    title: citation.title,
    kind: "Contributor citation",
    url: reviewPacketSourceUrl(citation.url),
    note: citation.note
  }))
}

/** Whitelisted values only. Neither stored prompts nor private drafts enter this model. */
async function definitionSources(
  reader: CommunityReader,
  revisionId: number,
  viewerId: number
) {
  const referenceRows = bounded(
    await reader
      .select({
        title: referenceEntries.term,
        url: referenceEntries.sourceIri,
        source: referenceEntries.source,
        version: referenceEntries.version,
        license: referenceEntries.license
      })
      .from(references)
      .innerJoin(
        referenceEntries,
        eq(references.referenceId, referenceEntries.id)
      )
      .where(eq(references.revisionId, revisionId))
      .orderBy(asc(referenceEntries.id))
      .limit(REVIEW_PACKET_ROW_LIMIT + 1)
  )
  const manual = bounded(
    await reader
      .select({ declaration: manualCitations.declaration })
      .from(manualCitations)
      .where(eq(manualCitations.revisionId, revisionId))
      .orderBy(asc(manualCitations.id))
      .limit(REVIEW_PACKET_ROW_LIMIT + 1)
  )
  const uploads = bounded(
    await reader
      .select({
        title: files.title,
        origin: files.origin,
        citation: files.citation,
        page: files.page,
        cited: files.contributorCited
      })
      .from(files)
      .where(
        and(
          eq(files.publishedRevisionId, revisionId),
          eq(files.role, "source"),
          vocabularyContentVisible(files.vocabularySlug, viewerId)
        )
      )
      .orderBy(asc(files.id))
      .limit(REVIEW_PACKET_ROW_LIMIT + 1)
  )
  return [
    ...referenceRows.map((row) => ({
      title: row.title,
      kind: "Ontology citation",
      url: reviewPacketSourceUrl(row.url),
      note: row.source,
      version: row.version,
      license: row.license ?? undefined
    })),
    ...manual.map(({ declaration }) => ({
      title: declaration.title || "Declared source",
      kind: "Declared citation",
      url: reviewPacketSourceUrl(declaration.url),
      note: declaration.creator,
      version: declaration.version,
      license: declaration.license
    })),
    ...uploads.map((row) => ({
      title: row.title,
      kind: `${row.origin === "paste" ? "Pasted" : "Uploaded"} source${row.cited ? ", cited" : ""}`,
      note: [row.citation, row.page ? `Page ${row.page}` : ""]
        .filter(Boolean)
        .join("\n")
    }))
  ] satisfies ReviewPacketSource[]
}

async function feedback(
  reader: CommunityReader,
  communityId: number,
  item: Pick<ReviewPacketItem, "kind" | "revisionId">,
  names: boolean,
  examples: boolean
): Promise<ReviewPacketFeedback[]> {
  const target =
    item.kind === "definition"
      ? eq(reviewItems.definitionRevisionId, Number(item.revisionId))
      : item.kind === "proposal"
        ? eq(reviewItems.proposalRevisionId, item.revisionId)
        : eq(reviewItems.sourceOccurrenceId, item.revisionId)
  const selected = bounded(
    await reader
      .select({
        id: reviewItems.id,
        preset: reviewItems.preset,
        roundId: rounds.id,
        roundName: rounds.name,
        closedAt: rounds.closedAt
      })
      .from(reviewItems)
      .innerJoin(rounds, eq(reviewItems.roundId, rounds.id))
      .where(
        and(
          eq(rounds.communityId, communityId),
          eq(reviewItems.kind, item.kind),
          target
        )
      )
      .orderBy(asc(rounds.createdAt), asc(rounds.id), asc(reviewItems.position))
      .limit(REVIEW_PACKET_ROW_LIMIT + 1)
  )
  if (!selected.length) return []
  const answered = bounded(
    await reader
      .select({
        itemId: responses.itemId,
        name: users.name,
        response: responses.response,
        comment: responses.comment,
        updatedAt: responses.updatedAt,
        datasetExerciseRevisionId: responses.datasetExerciseRevisionId
      })
      .from(responses)
      .innerJoin(users, eq(responses.userId, users.id))
      .where(
        inArray(
          responses.itemId,
          selected.map((row) => row.id)
        )
      )
      .orderBy(
        asc(responses.itemId),
        asc(responses.updatedAt),
        asc(responses.userId)
      )
      .limit(REVIEW_PACKET_ROW_LIMIT + 1)
  )
  return selected.map((row) => {
    const answers = answered.filter(
      (answer) => answer.itemId === row.id && hasReviewFeedback(answer)
    )
    return {
      itemId: row.id,
      roundId: row.roundId,
      roundName: row.roundName,
      closedAt: row.closedAt,
      revisionId: item.revisionId,
      question: row.preset.question,
      counts: row.preset.options.map((option) => ({
        ...option,
        count: answers.filter((answer) => answer.response === option.value)
          .length
      })),
      responseCount: answers.length,
      ...(examples
        ? {
            datasetExerciseRevisionIds: [
              ...new Set(
                answers.flatMap((answer) =>
                  answer.datasetExerciseRevisionId
                    ? [answer.datasetExerciseRevisionId]
                    : []
                )
              )
            ].sort()
          }
        : {}),
      comments: answers
        .filter((answer) => answer.comment.trim())
        .map((answer) => ({
          text: answer.comment,
          updatedAt: answer.updatedAt,
          ...(names ? { name: answer.name || "Unnamed contributor" } : {})
        })),
      ...(names
        ? {
            respondents: answers.map((answer) => ({
              name: answer.name || "Unnamed contributor",
              response: answer.response,
              comment: answer.comment,
              updatedAt: answer.updatedAt
            }))
          }
        : {})
    }
  })
}

async function loadDefinition(
  reader: CommunityReader,
  target: string,
  vocabularySlug: string,
  viewerId: number,
  names: boolean
): Promise<ReviewPacketItem> {
  const revisionId = Number(target.slice("definition:".length))
  const [row] = await reader
    .select({
      revision: revisions,
      label: terms.term,
      slug: terms.slug,
      vocabularySlug: terms.vocabularySlug,
      number: definitions.definitionNumber,
      author: users.name,
      replacesDefinitionId: definitions.replacesDefinitionId
    })
    .from(revisions)
    .innerJoin(definitions, eq(revisions.definitionId, definitions.id))
    .innerJoin(terms, eq(definitions.termId, terms.id))
    .leftJoin(users, eq(revisions.editorId, users.id))
    .where(
      and(
        eq(revisions.id, revisionId),
        eq(terms.vocabularySlug, vocabularySlug),
        termIsListed(),
        vocabularyContentVisible(terms.vocabularySlug, viewerId),
        participationContentVisible(revisions.surveyStepId, viewerId)
      )
    )
    .limit(1)
  if (!row) throw unavailable()
  const selected = row.revision
  const [metadataProjection] = await reader
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.definitionRevisionId, revisionId))
    .limit(1)
  if (metadataProjection)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Select the metadata proposal instead of its dictionary projection."
    })
  const predecessorId =
    selected.previousRevisionId ?? selected.derivedFromRevisionId
  // A dictionary projection retains the metadata proposal's source boundary.
  // Do not re-export that text or its history through an ordinary successor.
  const ordinaryRevision = () =>
    notExists(
      reader
        .select({ id: proposals.id })
        .from(proposals)
        .where(eq(proposals.definitionRevisionId, revisions.id))
    )
  const [before] = predecessorId
    ? await reader
        .select({ revision: revisions, label: terms.term })
        .from(revisions)
        .innerJoin(definitions, eq(revisions.definitionId, definitions.id))
        .innerJoin(terms, eq(definitions.termId, terms.id))
        .where(
          and(
            eq(revisions.id, predecessorId),
            termIsListed(),
            vocabularyContentVisible(terms.vocabularySlug, viewerId),
            participationContentVisible(revisions.surveyStepId, viewerId),
            ordinaryRevision()
          )
        )
        .limit(1)
    : []
  const discussion = bounded(
    await reader
      .select({
        text: comments.message,
        createdAt: comments.createdAt,
        name: users.name
      })
      .from(comments)
      .innerJoin(users, eq(comments.userId, users.id))
      .where(
        and(
          eq(comments.revisionId, revisionId),
          participationContentVisible(comments.surveyStepId, viewerId)
        )
      )
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(REVIEW_PACKET_ROW_LIMIT + 1)
  )
  // Match the current vote to its most recent event before applying survey access.
  // Filtering events first would revive a superseded public vote after a private act.
  const latestVoteEvents = reader
    .selectDistinctOn([voteEvents.userId], {
      userId: voteEvents.userId,
      kind: voteEvents.kind,
      visible:
        sql<boolean>`${participationContentVisible(voteEvents.surveyStepId, viewerId)}`.as(
          "visible"
        )
    })
    .from(voteEvents)
    .where(eq(voteEvents.revisionId, revisionId))
    .orderBy(asc(voteEvents.userId), desc(voteEvents.id))
    .as("packet_vote_events")
  const [tally] = await reader
    .select({
      up: sql<number>`count(*) filter (where ${votes.kind}='up')::int`,
      down: sql<number>`count(*) filter (where ${votes.kind}='down')::int`
    })
    .from(votes)
    .innerJoin(
      latestVoteEvents,
      and(
        eq(votes.userId, latestVoteEvents.userId),
        eq(votes.kind, latestVoteEvents.kind)
      )
    )
    .where(
      and(eq(votes.revisionId, revisionId), eq(latestVoteEvents.visible, true))
    )
  const history = bounded(
    await reader
      .select({
        id: revisions.id,
        version: revisions.version,
        source: revisions.source,
        note: revisions.changeNote,
        createdAt: revisions.createdAt,
        actor: users.name
      })
      .from(revisions)
      .leftJoin(users, eq(revisions.editorId, users.id))
      .where(
        and(
          eq(revisions.definitionId, selected.definitionId),
          participationContentVisible(revisions.surveyStepId, viewerId),
          ordinaryRevision()
        )
      )
      .orderBy(asc(revisions.version))
      .limit(REVIEW_PACKET_ROW_LIMIT + 1)
  )
  const [hasProjectedHistory] = await reader
    .select({ id: proposals.id })
    .from(proposals)
    .innerJoin(revisions, eq(proposals.definitionRevisionId, revisions.id))
    .where(eq(revisions.definitionId, selected.definitionId))
    .limit(1)
  const snapshot = (
    revision: typeof selected,
    label: string
  ): ReviewPacketContent => ({
    label,
    definition: diffToStringSimple(revision.definitionDiff),
    example: revision.exampleDiff
      ? diffToStringSimple(revision.exampleDiff)
      : null,
    rules: []
  })
  return {
    target,
    kind: "definition",
    label: row.label,
    revisionId: String(revisionId),
    versionLabel: `Definition ${row.number}, revision ${selected.version}`,
    href: revisionPath(
      row.slug,
      row.number,
      selected.version,
      row.vocabularySlug
    ),
    status: "Published definition candidate",
    author: row.author,
    createdAt: selected.createdAt,
    rationale: selected.changeNote,
    comparisonBasis: before
      ? selected.previousRevisionId
        ? "Previous revision"
        : "Recorded source revision"
      : predecessorId
        ? "Comparison source unavailable"
        : row.replacesDefinitionId
          ? "Replacement proposal. An exact source revision was not recorded."
          : "Initial definition",
    before: before ? snapshot(before.revision, before.label) : null,
    after: snapshot(selected, row.label),
    sources: await definitionSources(reader, revisionId, viewerId),
    feedback: [],
    votes: {
      up: tally.up,
      down: tally.down,
      net: tally.up - tally.down,
      scope:
        "Current votes on this exact revision, limited to visible participation. Separate from review-round responses."
    },
    discussion: discussion.map((comment) => ({
      text: comment.text,
      createdAt: comment.createdAt,
      ...(names ? { name: comment.name || "Unnamed contributor" } : {})
    })),
    history: history.map((event) => ({
      action: `Revision ${event.version}: ${event.source.replaceAll("_", " ")}`,
      actor: event.actor,
      createdAt: event.createdAt,
      revisionId: String(event.id),
      ...(event.note ? { note: event.note } : {})
    })),
    limitations: [
      ...(selected.legacyIncomplete
        ? ["Some details were not recorded in this legacy revision."]
        : []),
      ...(hasProjectedHistory
        ? [
            "Metadata-linked revisions are omitted here. Their source-authorized history is available through the metadata proposal."
          ]
        : [])
    ]
  }
}

async function loadProposal(
  reader: CommunityReader,
  target: string,
  vocabularySlug: string,
  viewerId: number,
  names: boolean
): Promise<ReviewPacketItem> {
  const revisionId = target.slice("proposal:".length)
  const [stored] = await reader
    .select({ fieldId: proposals.fieldId })
    .from(proposals)
    .where(eq(proposals.id, revisionId))
    .limit(1)
  if (!stored) throw unavailable()
  const record = await getMatcoreField(
    reader,
    stored.fieldId,
    revisionId,
    viewerId
  )
  if (record.field.vocabularySlug !== vocabularySlug) throw unavailable()
  const revision = record.revisions.find((item) => item.id === revisionId)!
  const [author] = await reader
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, revision.createdById))
  const events = bounded(
    await reader
      .select({
        action: proposalEvents.action,
        detail: proposalEvents.detail,
        actor: users.name,
        createdAt: proposalEvents.createdAt,
        revisionId: proposalEvents.revisionId
      })
      .from(proposalEvents)
      .innerJoin(users, eq(proposalEvents.actorId, users.id))
      .where(eq(proposalEvents.revisionId, revisionId))
      .orderBy(asc(proposalEvents.id))
      .limit(REVIEW_PACKET_ROW_LIMIT + 1)
  )
  const before =
    record.baseline ??
    record.revisions.find((item) => item.id === revision.previousRevisionId)
      ?.payload ??
    null
  const citations = sources(revision.payload)
  if (record.sourceRelease && record.sourceOccurrence)
    citations.unshift({
      title:
        record.sourceRelease.artifactTitle ??
        `Reference specification ${record.sourceRelease.version}`,
      kind: "Reference baseline",
      url: reviewPacketSourceUrl(record.sourceOccurrence.sourceUrl),
      version: record.sourceRelease.version,
      note: [
        record.sourceRelease.attribution,
        record.sourceOccurrence.sourcePage
          ? `Page ${record.sourceOccurrence.sourcePage}`
          : "",
        record.sourceRelease.sourceUrlRole === "publisher"
          ? "The link opens the publisher website. The reference was supplied as a PDF."
          : ""
      ]
        .filter(Boolean)
        .join("\n"),
      license: record.sourceRelease.license ?? undefined
    })
  if (revision.definitionRevisionId)
    citations.push(
      ...(await definitionSources(
        reader,
        revision.definitionRevisionId,
        viewerId
      ))
    )
  return {
    target,
    kind: "proposal",
    label: revision.payload.label,
    revisionId,
    versionLabel: `Proposal revision ${revision.version}`,
    href: `/metadata/fields/${encodeURIComponent(record.field.id)}?revision=${encodeURIComponent(revisionId)}`,
    status: revision.reviewState,
    author: author?.name ?? null,
    createdAt: revision.createdAt,
    rationale: revision.payload.rationale,
    comparisonBasis: record.baseline
      ? "Cited reference baseline"
      : before
        ? "Previous proposal revision"
        : "New field proposal",
    before: before ? content(before) : null,
    after: content(revision.payload),
    sources: citations,
    feedback: [],
    votes: null,
    discussion: events
      .filter((event) => event.action === "commented")
      .map((event) => ({
        text: event.detail.reason ?? "",
        createdAt: event.createdAt,
        ...(names ? { name: event.actor || "Unnamed contributor" } : {})
      })),
    history: events
      .filter((event) => event.action !== "commented")
      .map((event) => ({
        action: event.detail.decision ?? event.action,
        actor: event.actor,
        createdAt: event.createdAt,
        revisionId,
        ...(event.detail.reason ? { note: event.detail.reason } : {})
      })),
    limitations: [
      "Community proposals and decisions do not imply approval by the reference publisher."
    ]
  }
}

async function loadReference(
  reader: CommunityReader,
  target: string,
  vocabularySlug: string,
  communitySlug: string
): Promise<ReviewPacketItem> {
  const id = target.slice("reference:".length)
  const [row] = await reader
    .select({ occurrence: occurrences, release: releases })
    .from(occurrences)
    .innerJoin(releases, eq(occurrences.releaseId, releases.id))
    .innerJoin(
      grants,
      and(
        eq(grants.releaseId, releases.id),
        eq(grants.vocabularySlug, vocabularySlug)
      )
    )
    .where(eq(occurrences.id, id))
    .limit(1)
  if (!row) throw unavailable()
  return {
    target,
    kind: "reference",
    label: row.occurrence.baseline.label,
    revisionId: id,
    versionLabel: `Reference ${row.release.version}`,
    href: `/communities/${encodeURIComponent(communitySlug)}?view=vocabulary&standard=reference&release=${encodeURIComponent(row.release.id)}&profile=${encodeURIComponent(row.occurrence.profileKey)}&source=${encodeURIComponent(id)}`,
    status: "Reference entry",
    author: row.release.source.attribution,
    createdAt: null,
    rationale: null,
    comparisonBasis: "Reference entry",
    before: null,
    after: content(row.occurrence.baseline),
    sources: [
      {
        title:
          row.release.source.artifactTitle ??
          `Reference specification ${row.release.version}`,
        kind: "Reference baseline",
        url: reviewPacketSourceUrl(row.occurrence.source.sourceUrl),
        version: row.release.version,
        note: [
          row.release.source.attribution,
          row.occurrence.source.sourcePage
            ? `Page ${row.occurrence.source.sourcePage}`
            : "",
          row.release.source.sourceUrlRole === "publisher"
            ? "The link opens the publisher website. The reference was supplied as a PDF."
            : ""
        ]
          .filter(Boolean)
          .join("\n"),
        license: row.release.source.license ?? undefined
      }
    ],
    feedback: [],
    votes: null,
    discussion: [],
    history: [],
    limitations: []
  }
}

export function reviewPacketFingerprint(
  packet: Omit<CommunityReviewPacket, "generatedAt" | "fingerprint">
): string {
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex")
}

/** The HTTP caller supplies a read-only REPEATABLE READ transaction. */
export async function createCommunityReviewPacket(
  reader: CommunityReader,
  slug: string,
  input: ReviewPacketRequest,
  viewerId: number
): Promise<CommunityReviewPacket> {
  const request = reviewPacketRequestSchema.parse(input)
  const [community] = await reader
    .select({ id: communities.id, vocabularySlug: communities.vocabularySlug })
    .from(communities)
    .where(eq(communities.slug, slug))
    .limit(1)
  if (!community) throw unavailable()
  const access = await communityAccess(reader, community.id, viewerId)
  if (!access.canRead) throw unavailable()
  if (!access.canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only community stewards can export review packets."
    })
  const items: ReviewPacketItem[] = []
  let itemBytes = 0
  for (const target of [...request.targets].sort()) {
    const item = target.startsWith("definition:")
      ? await loadDefinition(
          reader,
          target,
          community.vocabularySlug,
          viewerId,
          request.includeRespondentNames
        )
      : target.startsWith("proposal:")
        ? await loadProposal(
            reader,
            target,
            community.vocabularySlug,
            viewerId,
            request.includeRespondentNames
          )
        : await loadReference(
            reader,
            target,
            community.vocabularySlug,
            access.slug
          )
    item.feedback = await feedback(
      reader,
      community.id,
      item,
      request.includeRespondentNames,
      request.includeDatasetExamples
    )
    itemBytes += Buffer.byteLength(JSON.stringify(item))
    if (itemBytes > REVIEW_PACKET_BYTE_LIMIT)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This packet is too large. Export fewer contributions."
      })
    items.push(item)
  }
  const datasetExamples: ReviewPacketDatasetExample[] = []
  if (request.includeDatasetExamples) {
    const itemIds = [
      ...new Set(
        items.flatMap((item) => item.feedback.map((round) => round.itemId))
      )
    ].sort()
    const linked = await communityReviewExerciseRevisions(
      reader,
      itemIds,
      viewerId
    )
    const grouped = new Map<string, ReviewPacketDatasetExample>()
    for (const row of linked) {
      const existing = grouped.get(row.revisionId)
      if (existing) {
        for (const id of row.itemIds)
          if (!existing.reviewItemIds.includes(id))
            existing.reviewItemIds.push(id)
        continue
      }
      const example: ReviewPacketDatasetExample = {
        revisionId: row.revisionId,
        roundId: row.roundId,
        roundName: row.roundName,
        referenceReleaseId: row.config.referenceReleaseId,
        profile: row.config.profile,
        version: row.version,
        updatedAt: row.updatedAt,
        reviewItemIds: [...row.itemIds],
        datasetTitle: row.payload.datasetTitle,
        datasetSource: row.payload.datasetSource,
        completedXml: row.payload.completedXml,
        notes: row.payload.notes,
        xmlStatus: row.xmlStatus,
        ...(request.includeRespondentNames
          ? {
              reviewerName: row.payload.reviewerName,
              reviewerAffiliation: row.payload.reviewerAffiliation
            }
          : {})
      }
      itemBytes += Buffer.byteLength(JSON.stringify(example))
      if (itemBytes > REVIEW_PACKET_BYTE_LIMIT)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This packet is too large. Export fewer contributions or omit dataset examples."
        })
      grouped.set(row.revisionId, example)
    }
    datasetExamples.push(
      ...[...grouped.values()].sort(
        (a, b) =>
          a.roundId.localeCompare(b.roundId) ||
          a.revisionId.localeCompare(b.revisionId)
      )
    )
    for (const example of datasetExamples) example.reviewItemIds.sort()
  }
  const manifest = {
    format: "matsci-sam-review-packet" as const,
    formatVersion: 1 as const,
    community: {
      slug: access.slug,
      title: access.title,
      visibility: access.visibility
    },
    includeRespondentNames: request.includeRespondentNames,
    includeDatasetExamples: request.includeDatasetExamples,
    datasetExamples,
    items
  }
  const fingerprint = reviewPacketFingerprint(manifest)
  if (request.fingerprint && request.fingerprint !== fingerprint)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The selected contributions or feedback changed. Preview the packet again."
    })
  const packet = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    fingerprint
  }
  if (Buffer.byteLength(JSON.stringify(packet)) > REVIEW_PACKET_BYTE_LIMIT)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This packet is too large. Export fewer contributions."
    })
  return packet
}
