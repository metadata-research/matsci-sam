// The two published studies this platform answers to, reconstructed from the
// papers, and the second ID4 study they are the template for.
//
// A study is a record here, not a row. Phase 4 of the implementation program
// owns the data model for a study run on this platform, and it is not started.
// Nothing below is stored, none of it is published as RDF, and no identifier
// here is a public one. The value of writing it down now is that Phase 4 has
// to be scoped against what the papers actually did, and both protocols say
// much of the work was email rather than platform features.
//
// Both studies ran on predecessor software. The 2024 study used YAMZ and the
// 2025 study used MatSci-YAMZ, a Python application at matsci.yamz.net. This
// application is the successor, and no study has yet run on it.

export type StepSupport = "supported" | "partial" | "missing"

export type ProtocolStep = {
  title: string
  detail: string
  // What this application provides for the step today, which is the question
  // Phase 4 has to answer before any of it is built.
  support: StepSupport
  supportNote: string
}

export type Study = {
  slug: string
  title: string
  lede: string
  state: "completed" | "proposed"
  platform: string
  period: string
  cohort: string
  termSet: string
  protocol: ProtocolStep[]
  produced: string[]
  source: string
  sourceHref?: string
}

const ID4_PROTOCOL: ProtocolStep[] = [
  {
    title: "Orientation and setup",
    detail:
      "Participants reviewed tutorial slides with a supplementary video recording, then created an account with their Google credentials.",
    support: "supported",
    supportNote:
      "Google, ORCID and email sign-in all work. Orientation material is not held here."
  },
  {
    title: "Term entry and definition",
    detail:
      "Each participant was instructed to add two terms relevant to their own research domain, each with an initial definition and an illustrative example.",
    support: "supported",
    supportNote:
      "The add flow captures a definition and requires at least one example."
  },
  {
    title: "AI-generated definitions",
    detail:
      "Gemma3 generated one AI definition per term from the definition and example the participant supplied. The example disambiguates context and is what starts generation.",
    support: "supported",
    supportNote:
      "Generation runs against the shared Ollama host, attributed to the model, with prompts from the registry."
  },
  {
    title: "Commenting on AI definitions",
    detail:
      "Participants commented on the AI definitions for their own terms, then on those for other participants' terms, which is where peer review and cross-disciplinary reflection enter.",
    support: "partial",
    supportNote:
      "Comments and votes are recorded against a revision. A comment records the author and the time and nothing else, so a model comment is separable from a human one only by the AI flag on that account, an AI-drafted comment accepted from a suggestion is stored under the human who accepted it, and nothing marks a comment as simulated. Nothing distinguishes a comment on your own term from a comment on someone else's, or records that a participant finished the step."
  }
]

export const STUDIES: Study[] = [
  {
    slug: "id4-2025",
    title: "ID4 human-in-the-loop study",
    lede: "The proof-of-concept case study this platform's second study is modelled on. Six ID4-affiliated participants entered terms, a model answered, and the participants reviewed what it produced.",
    state: "completed",
    platform: "MatSci-YAMZ, a Python application at matsci.yamz.net",
    period:
      "Open from late July to mid-September 2025, with the required tasks in a two-week window at the end of August",
    cohort:
      "Six participants, materials science researchers and people with computational experience working alongside them, all affiliated with the NSF Institute for Data-Driven Dynamical Design",
    termSet:
      "Two terms per participant as instructed, chosen by the participant from their own research area. The six of them entered twenty terms between them. The platform was seeded beforehand with terms from earlier YAMZ testing.",
    protocol: ID4_PROTOCOL,
    produced: [
      "20 human-entered terms, each with a definition and an illustrative example",
      "19 AI-generated definitions, one per term, with one term carrying two human definitions",
      "Provenance logs showing the back and forth between participant and model on a single term",
      "Activity continuing past the close of the designated test period"
    ],
    source:
      "Greenberg et al. 2025, Human-in-the-Loop and AI: Crowdsourcing Metadata Vocabulary for Materials Science",
    sourceHref: "https://arxiv.org/abs/2512.09895"
  },
  {
    slug: "form-finding-2024",
    title: "Form-finding terminological consensus study",
    lede: "The earlier YAMZ study, run in civil engineering. It is the more prescriptive of the two, and it is where term distribution, an ordered week and a rebuttal step come from.",
    state: "completed",
    platform: "YAMZ",
    period:
      "One working week, planned as five days and extended to six, with participants asked for half-hour sessions on three or four days",
    cohort:
      "Nine of thirteen invited researchers from the form-finding community, a third holding a doctorate and the rest graduate students. Anonymised usernames were distributed to reduce the chance of identifying a participant.",
    termSet:
      "Thirteen pre-selected terms in three categories: three recently coined in the last decade, five well established but used with particular meanings inside the group, and five trending terms whose usage has drifted. Twenty-one terms in all went out by individual email to the thirteen invited people, three required and one optional each. One term went to everyone, three went to subgroups with each person in one subgroup only, and the rest went out individually.",
    protocol: [
      {
        title: "Instructions and tutorial",
        detail:
          "Day one. A tutorial session on the tool, followed by individual email carrying the study instructions, that participant's terms and their generated username.",
        support: "missing",
        supportNote:
          "There is no cohort, no assignment of a term to a person, and no instruction text held anywhere."
      },
      {
        title: "Define",
        detail:
          "Days two and three as planned. Participants contributed a definition and an example for each term they had been given.",
        support: "partial",
        supportNote:
          "Definitions and examples work. Which terms a given participant owes is not recorded."
      },
      {
        title: "Comment and vote",
        detail:
          "Days four and five. Participants commented on other participants' definitions, at least three terms each, and voted on them. Voting days were suggested, and the paper cannot say when voting actually happened because YAMZ recorded no timestamp on a vote.",
        support: "partial",
        supportNote:
          "Comments and votes both work, and a vote here records when it was cast. A per-participant quota is not expressible. A vote that changes direction keeps its original timestamp and a withdrawn vote deletes the row, so the record answers when a person first voted on a revision and not when they changed their mind."
      },
      {
        title: "Rebuttal",
        detail:
          "The sixth day, added to the plan. Participants answered the comments left on their own definitions.",
        support: "partial",
        supportNote:
          "A reply is an ordinary comment. Nothing marks it as a rebuttal or ties it to a phase of the study."
      }
    ],
    produced: [
      "Definitions and examples for thirteen of the twenty-one distributed terms, against published definitions for comparison",
      "A matching score from one to five between each contributed definition and the published one",
      "Fifty-one comments across twenty-three entries, six of them rebuttals",
      "At least one vote on twenty-two entries, the busiest reaching a magnitude of five",
      "A timeline showing tasks as executed against tasks as planned"
    ],
    source:
      "De Oliveira et al. 2024, Exploratory analysis of a crowdsourcing metadata tool for building terminological consensus in civil engineering, Automation in Construction 166, 105627"
  },
  {
    slug: "id4-second",
    title: "Second ID4 study",
    lede: "The near-term goal. It repeats the 2025 protocol on this platform, where the provenance record is finer and the vocabulary is published, so the result is measurable afterwards.",
    state: "proposed",
    platform: "This application",
    period: "Not scheduled",
    cohort:
      "Not selected. Communities supply the cohort half and can be built today, with a roster, stewards named by an administrator, and per-person invitations that record who was asked and who arrived. What is missing is a record of which cohort a study ran with, because a worklist carries no protocol and no window.",
    termSet:
      "Not selected. Collections supply the term set half and can be built today. Whether terms are distributed to participants or chosen by them is the open protocol question, and the two studies answer it differently.",
    protocol: ID4_PROTOCOL,
    produced: [
      "Human, model and simulated review separable in the record, which the MTSR system paper needs and the comment record cannot express yet"
    ],
    source: "docs-internal/IMPLEMENTATION-PROGRAM.md, Phase 4"
  }
]

export const studyBySlug = (slug: string) =>
  STUDIES.find((study) => study.slug === slug) ?? null

export const SUPPORT_LABEL: Record<StepSupport, string> = {
  supported: "Supported",
  partial: "Partly supported",
  missing: "Not supported"
}
