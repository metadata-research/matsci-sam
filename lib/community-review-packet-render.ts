import { createTextDiff } from "./definition-comparison"
import {
  reviewPacketSourceUrl,
  type CommunityReviewPacket,
  type ReviewPacketContent,
  type ReviewPacketDatasetExample,
  type ReviewPacketItem
} from "./community-review-packet-types"

const escape = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
const paragraphs = (value: string | null) =>
  `<div class="text">${escape(value ?? "Not recorded")}</div>`
const link = (label: string, url: string | undefined) =>
  url
    ? `<a href="${escape(url)}" rel="noopener noreferrer">${escape(label)}</a>`
    : escape(label)
const appLink = (value: string, origin: string) =>
  value.startsWith("/") &&
  !value.startsWith("//") &&
  !/[\\\u0000-\u0020]/.test(value)
    ? reviewPacketSourceUrl(new URL(value, origin).toString())
    : undefined
const diff = (before: string, after: string) =>
  createTextDiff(before, after)
    .map(([operation, text]) =>
      operation === -1
        ? `<del>${escape(text)}</del>`
        : operation === 1
          ? `<ins>${escape(text)}</ins>`
          : escape(text)
    )
    .join("")

function changedRules(
  before: ReviewPacketContent | null,
  after: ReviewPacketContent
) {
  if (!after.rules.length && !before?.rules.length) return ""
  const labels = [
    ...new Set([
      ...(before?.rules.map((row) => row.label) ?? []),
      ...after.rules.map((row) => row.label)
    ])
  ]
  return `<h3>Field rules</h3><table><thead><tr><th>Rule</th>${before ? "<th>Before</th>" : ""}<th>${before ? "Proposed" : "Value"}</th></tr></thead><tbody>${labels
    .map((label) => {
      const previous =
        before?.rules.find((row) => row.label === label)?.value ?? ""
      const next = after.rules.find((row) => row.label === label)?.value ?? ""
      return `<tr${before && previous !== next ? ' class="changed"' : ""}><th>${escape(label)}</th>${before ? `<td>${escape(previous || "Not specified")}</td>` : ""}<td>${escape(next || "Not specified")}</td></tr>`
    })
    .join("")}</tbody></table>`
}
function renderItem(item: ReviewPacketItem, origin: string) {
  return `<article><h2>${escape(item.label)}</h2><p>${escape(item.versionLabel)} · ${escape(item.status.replaceAll("_", " "))}</p>
  <p>${link("Open contribution", appLink(item.href, origin))}${item.author ? ` · By ${escape(item.author)}` : ""}${item.createdAt ? ` · ${escape(item.createdAt)}` : ""}</p>
  <p class="muted">${escape(item.comparisonBasis)}</p>
  ${item.before ? `<div class="comparison"><section><h3>Before</h3>${paragraphs(item.before.definition)}</section><section><h3>Proposed definition</h3>${paragraphs(item.after.definition)}</section></div><h3>Text changes</h3><div class="text diff">${diff(item.before.definition, item.after.definition)}</div>` : `<h3>Definition</h3>${paragraphs(item.after.definition)}`}
  ${item.before && item.before.label !== item.after.label ? `<p>Label: <del>${escape(item.before.label)}</del> <ins>${escape(item.after.label)}</ins></p>` : ""}
  ${item.after.example || item.before?.example ? `<h3>Example</h3><div class="text">${item.before ? diff(item.before.example ?? "", item.after.example ?? "") : escape(item.after.example)}</div>` : ""}
  ${changedRules(item.before, item.after)}
  ${item.rationale ? `<h3>Reason for the change</h3>${paragraphs(item.rationale)}` : ""}
  <h3>Sources</h3>${item.sources.length ? `<ul>${item.sources.map((source) => `<li>${link(source.title, reviewPacketSourceUrl(source.url))} (${escape(source.kind)})${source.version ? `, ${escape(source.version)}` : ""}${source.license ? `, ${escape(source.license)}` : ""}${source.note ? paragraphs(source.note) : ""}</li>`).join("")}</ul>` : "<p>No sources recorded for this revision.</p>"}
  <h3>Review feedback</h3>${item.feedback.length ? item.feedback.map((round) => `<section class="round"><h4>${escape(round.roundName)}${round.closedAt ? " (closed)" : " (open)"}</h4><p>${escape(round.question)}</p><p>${round.counts.map((count) => `${escape(count.label)}: ${count.count}`).join(" · ")} · Responses: ${round.responseCount}</p><p class="muted">Reviewed revision: ${escape(round.revisionId)}</p>${round.comments.map((comment) => `<blockquote>${paragraphs(comment.text)}${comment.name ? `<p>${escape(comment.name)}</p>` : ""}<small>${escape(comment.updatedAt)}</small></blockquote>`).join("")}${round.datasetExerciseRevisionIds?.length ? `<p>Dataset examples: ${round.datasetExerciseRevisionIds.map((id) => `<a href="#dataset-${escape(id)}">${escape(id)}</a>`).join(", ")}</p>` : ""}${round.respondents ? `<details open><summary>Named responses</summary><table><thead><tr><th>Respondent</th><th>Response</th><th>Updated</th></tr></thead><tbody>${round.respondents.map((response) => `<tr><td>${escape(response.name)}</td><td>${escape(round.counts.find((count) => count.value === response.response)?.label ?? "Comment only")}</td><td>${escape(response.updatedAt)}</td></tr>`).join("")}</tbody></table></details>` : ""}</section>`).join("") : "<p>No review rounds include this revision.</p>"}
  ${item.votes ? `<h3>Definition votes</h3><p>Up: ${item.votes.up} · Down: ${item.votes.down} · Net: ${item.votes.net}</p><p class="muted">${escape(item.votes.scope)}</p>` : ""}
  ${item.discussion.length ? `<h3>Discussion</h3>${item.discussion.map((comment) => `<blockquote>${paragraphs(comment.text)}${comment.name ? `<p>${escape(comment.name)}</p>` : ""}<small>${escape(comment.createdAt)}</small></blockquote>`).join("")}` : ""}
  <h3>Provenance and decisions</h3>${item.history.length ? `<ol>${item.history.map((event) => `<li>${escape(event.action)}${event.actor ? ` · ${escape(event.actor)}` : ""} · ${escape(event.createdAt)}${event.note ? paragraphs(event.note) : ""}</li>`).join("")}</ol>` : "<p>No contribution events recorded.</p>"}
  ${item.limitations.map((note) => `<p class="muted">${escape(note)}</p>`).join("")}
  </article>`
}

function renderDatasetExample(example: ReviewPacketDatasetExample) {
  const xmlStatus =
    example.xmlStatus === "well_formed"
      ? "XML syntax checked. Field values are not validated."
      : example.xmlStatus === "template"
        ? "XML contains FILL placeholders."
        : "XML not added."
  return `<section class="round" id="dataset-${escape(example.revisionId)}"><h3>${escape(example.datasetTitle || "Dataset example")}</h3><p>${escape(example.roundName)} · ${escape(example.referenceReleaseId)} · ${escape(example.profile)}</p><p>Example revision ${example.version} · ${escape(example.updatedAt)}</p>${example.reviewerName || example.reviewerAffiliation ? `<p>${escape([example.reviewerName, example.reviewerAffiliation].filter(Boolean).join(" · "))}</p>` : ""}<h4>Dataset source</h4>${paragraphs(example.datasetSource)}<h4>Metadata XML</h4><pre class="text">${escape(example.completedXml)}</pre>${example.notes ? `<h4>Notes</h4>${paragraphs(example.notes)}` : ""}<p class="muted">${xmlStatus} Saved with ${example.reviewItemIds.length} selected review ${example.reviewItemIds.length === 1 ? "item" : "items"}. Revision ${escape(example.revisionId)}.</p></section>`
}

/** Standalone, script-free HTML. Browser Print can save the same packet as PDF. */
export function renderCommunityReviewPacket(
  packet: CommunityReviewPacket,
  origin: string
): string {
  const safeOrigin = reviewPacketSourceUrl(origin)
  if (!safeOrigin) throw new Error("Invalid report origin")
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(packet.community.title)} review packet</title><style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:1080px;padding:32px;margin:auto;color:#202b38}h1,h2,h3,h4{line-height:1.25}h2{margin-bottom:8px}h3{margin-top:24px}article{border-top:2px solid #60768e;margin-top:36px;padding-top:20px;break-before:page}article:first-of-type{break-before:auto}.muted,small{color:#526171}.text{white-space:pre-wrap;overflow-wrap:anywhere}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:24px}.comparison section,.round{background:#f4f6f8;padding:16px;border:1px solid #d5dce3;border-radius:6px}.round{margin:16px 0}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:8px;border:1px solid #ccd3da;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{font-weight:600}thead{display:table-header-group}.changed{background:#fff8e7}ins{background:#dcfce7;text-decoration:underline}del{background:#fee2e2;text-decoration:line-through}blockquote{margin:16px 0;padding-left:16px;border-left:3px solid #b7c5d3}a{color:#185b91;overflow-wrap:anywhere}.fingerprint{font:12px monospace;overflow-wrap:anywhere}li{margin-bottom:10px}@media(max-width:650px){body{padding:16px}.comparison{grid-template-columns:1fr}}@media print{body{padding:0;max-width:none;font-size:10pt}h2,h3,h4{break-after:avoid}.round,blockquote,tr{break-inside:avoid}.screen{display:none}a{color:inherit}ins,del,.changed{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><header><h1>${escape(packet.community.title)} review packet</h1><p>${packet.items.length} selected contributions · Generated ${escape(packet.generatedAt)}</p><p>${packet.includeRespondentNames ? "Includes named responses." : "Respondent names omitted. Comments may still identify their authors."} Contributor and decision attribution is retained.</p><p>${packet.community.visibility === "members" ? "Members-only community content. Share only with authorized recipients." : "Community review copy."}</p><p class="screen">Use your browser's Print command to print or save as PDF.</p><p class="fingerprint">Snapshot: ${escape(packet.fingerprint)}</p></header>${packet.items.map((item) => renderItem(item, safeOrigin)).join("")}${packet.includeDatasetExamples ? `<article><h2>Dataset examples</h2><p>Examples are the revisions saved with the selected feedback. Later edits do not replace them. Their text may identify contributors.</p>${packet.datasetExamples.length ? packet.datasetExamples.map(renderDatasetExample).join("") : "<p>No dataset examples were attached to the selected feedback.</p>"}</article>` : ""}</body></html>`
}
