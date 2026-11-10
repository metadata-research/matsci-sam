import assert from "node:assert/strict"
import { renderCommunityReviewPacket } from "../lib/community-review-packet-render"
import { reviewPacketContent } from "../lib/community-review-packet-content"
import { emptyMatcoreDraftPayload } from "../lib/matcore-workflow-types"
import {
  parseReviewPacketQuery,
  reviewPacketSourceUrl,
  type CommunityReviewPacket
} from "../lib/community-review-packet-types"

let checks = 0
const check = (value: unknown, message: string) => {
  assert.ok(value, message)
  checks++
}
const query = parseReviewPacketQuery(
  new URLSearchParams(
    "target=definition:2&target=proposal:00000000-0000-4000-8000-000000000001"
  )
)
check(
  query.targets.length === 2 && query.includeRespondentNames === false,
  "Preview defaults to unnamed feedback"
)
for (const bad of [
  "target=definition:1&names=1&names=0",
  "target=definition:1&names=true",
  "target=definition:1&examples=yes",
  "target=definition:1&examples=1&examples=0",
  "target=definition:1&extra=x",
  "target=definition:0",
  "target=definition:1&target=definition:1",
  "target=definition:1&format=html",
  Array.from({ length: 101 }, (_, i) => `target=definition:${i + 1}`).join("&")
]) {
  assert.throws(() => parseReviewPacketQuery(new URLSearchParams(bad)))
  checks++
}
check(
  parseReviewPacketQuery(
    new URLSearchParams(
      `target=definition:1&format=json&fingerprint=${"a".repeat(64)}&names=1`
    )
  ).includeRespondentNames,
  "Names require explicit opt-in"
)
for (const bad of [
  "javascript:alert(1)",
  "data:text/html,test",
  "file:///etc/passwd",
  "https://user:password@example.com",
  "//example.com",
  "https://example.com/\nsecret"
])
  check(
    reviewPacketSourceUrl(bad) === undefined,
    `Reject unsafe source URL ${bad.split(":")[0]}`
  )
check(
  reviewPacketSourceUrl("https://example.com/reference#field") ===
    "https://example.com/reference#field",
  "Keep HTTP source citation"
)
const packet: CommunityReviewPacket = {
  format: "matsci-sam-review-packet",
  formatVersion: 1,
  community: {
    slug: "materials",
    title: "Materials <script>alert(1)</script>",
    visibility: "members"
  },
  generatedAt: "2026-11-10T12:00:00Z",
  fingerprint: "a".repeat(64),
  includeRespondentNames: false,
  includeDatasetExamples: false,
  datasetExamples: [],
  items: [
    {
      target: "definition:1",
      kind: "definition",
      label: 'Phase width <img src=x onerror="alert(1)">',
      revisionId: "1",
      versionLabel: "Revision 1",
      href: "/vocabulary/materials/interface_width",
      status: "Published candidate",
      author: "Contributor",
      createdAt: "2026-11-10",
      rationale: "Describe the interface.",
      comparisonBasis: "Previous revision",
      before: {
        label: "Interface width",
        definition: "A narrow region.",
        example: "Old",
        rules: [{ label: "Repeatable", value: "no" }]
      },
      after: {
        label: "Interface width",
        definition: "A diffuse region.",
        example: "New",
        rules: [{ label: "Repeatable", value: "yes" }]
      },
      sources: [
        {
          title: "Unsafe source",
          kind: "Citation",
          url: "javascript:alert(1)"
        },
        {
          title: "Reference",
          kind: "Citation",
          url: "https://example.com/?a=1&b=2"
        }
      ],
      feedback: [
        {
          itemId: "review-item",
          roundId: "round1",
          roundName: "Field review",
          closedAt: null,
          revisionId: "1",
          question: "Suitable?",
          counts: [
            { value: "support", label: "Suitable as written", count: 1 }
          ],
          responseCount: 1,
          comments: [
            { text: "<script>evil()</script>", updatedAt: "2026-11-10" }
          ]
        }
      ],
      votes: { up: 1, down: 0, net: 1, scope: "Exact revision" },
      discussion: [],
      history: [
        {
          action: "accepted",
          actor: "Steward",
          createdAt: "2026-11-10",
          revisionId: "1",
          note: "Agreed"
        }
      ],
      limitations: []
    }
  ]
}
const html = renderCommunityReviewPacket(packet, "https://example.com")
check(!html.includes("<script"), "User content never creates script elements")
check(!html.includes("<img"), "User content never creates image elements")
check(
  !html.includes('href="javascript:'),
  "Renderer independently rejects unsafe links"
)
check(
  html.includes("&lt;script&gt;evil()&lt;/script&gt;"),
  "Comments are escaped"
)
check(html.includes("a=1&amp;b=2"), "Source attributes are escaped")
check(
  html.includes("<del>") && html.includes("<ins>"),
  "Changes are highlighted"
)
check(
  html.includes("Repeatable") && html.includes('class="changed"'),
  "Field rule changes are visible"
)
check(
  html.includes("Members-only") && html.includes("Respondent names omitted"),
  "Private packet and privacy selection are explicit"
)
check(
  html.includes("Snapshot:") && html.includes("Reviewed revision: 1"),
  "Export names snapshot and reviewed revision"
)
check(
  !html.includes("Named responses"),
  "Unnamed packet has no respondent appendix"
)
check(
  html.includes("@media print") && !html.includes("onclick="),
  "Printable report needs no script or active content"
)
packet.includeRespondentNames = true
packet.items[0].feedback[0].respondents = [
  {
    name: "Ada <Test>",
    response: "support",
    comment: "Useful",
    updatedAt: "2026-11-10"
  }
]
const named = renderCommunityReviewPacket(packet, "https://example.com")
check(
  named.includes("Named responses") && named.includes("Ada &lt;Test&gt;"),
  "Opted-in names are safely rendered"
)
check(query.includeDatasetExamples === false, "Dataset examples are opt-in")
check(
  parseReviewPacketQuery(new URLSearchParams("target=definition:1&examples=1"))
    .includeDatasetExamples,
  "Examples require explicit option"
)
packet.includeDatasetExamples = true
packet.datasetExamples = [
  {
    revisionId: "example-revision",
    roundId: "round",
    roundName: "Phase Field review",
    referenceReleaseId: "matcore:0.5.0",
    profile: "pf",
    version: 1,
    updatedAt: "2026-11-10",
    reviewItemIds: ["review-item"],
    datasetTitle: "Interface mobility",
    datasetSource: "Repository citation",
    completedXml: '<dataset><script>alert("x")</script></dataset>',
    notes: "Units need clarification.",
    xmlStatus: "well_formed"
  }
]
packet.items[0].feedback[0].datasetExerciseRevisionIds = ["example-revision"]
const examples = renderCommunityReviewPacket(packet, "https://example.com")
check(
  examples.includes('href="#dataset-example-revision"'),
  "Feedback links to saved dataset revision"
)
check(
  examples.includes("&lt;dataset&gt;&lt;script&gt;"),
  "Dataset XML is escaped as text"
)
check(!examples.includes("<script>"), "Dataset content cannot execute scripts")
check(
  examples.includes("Later edits do not replace them"),
  "Appendix explains immutable evidence"
)
check(
  examples.includes("Field values are not validated"),
  "Packet distinguishes syntax checks from field validation"
)
check(
  examples.includes("matcore:0.5.0"),
  "Dataset appendix identifies its reference version"
)
const legacy = emptyMatcoreDraftPayload()
legacy.specification.valueType = "list"
legacy.specification.guidance = "Provide one value for each phase."
const preserved = JSON.stringify(legacy)
const interpreted = reviewPacketContent(legacy)
const readRule = (label: string) =>
  interpreted.rules.find((rule) => rule.label === label)?.value
check(
  readRule("Data type") === "Not recorded separately",
  "Legacy list does not become a data type"
)
check(
  readRule("Value form") === "List",
  "Legacy list becomes the displayed value form"
)
check(
  readRule("Requirement") === "Not recorded separately" &&
    readRule("Repeatable") === "Not recorded separately",
  "Unrecorded rules acknowledge source guidance"
)
check(
  readRule("Value guidance") === legacy.specification.guidance,
  "Guidance remains in the report"
)
check(
  JSON.stringify(legacy) === preserved,
  "Display interpretation leaves stored baseline unchanged"
)
const explicit = emptyMatcoreDraftPayload()
explicit.specification.valueType = "number"
explicit.specification.valueForm = "array"
explicit.specification.requirement = "required"
explicit.specification.repeatability = "yes"
check(
  reviewPacketContent(explicit).rules.find((rule) => rule.label === "Data type")
    ?.value === "Number",
  "Explicit type uses shared UI label"
)
check(
  reviewPacketContent(explicit).rules.find(
    (rule) => rule.label === "Repeatable"
  )?.value === "Yes",
  "Repeatability uses shared UI label"
)
console.log(`Community review packet tests passed (${checks} checks).`)
