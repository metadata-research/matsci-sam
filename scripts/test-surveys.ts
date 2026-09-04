import assert from "node:assert/strict"

// Every rule is asserted in both directions. A rule checked only where it
// refuses can pass while permitting nothing at all.

const main = async () => {
  // lib/surveys.ts holds one database write, so importing it opens the pool
  // lazily; a placeholder keeps that harmless without a database, as
  // scripts/test-definition-revisions.ts does.
  process.env.DATABASE_URL ??= "postgresql:///survey-rule-test"
  const {
    DEFAULT_INSTRUCTIONS,
    DEFAULT_QUESTIONS,
    actMatchesStep,
    mayParticipate,
    mayRegenerateSteps,
    isDefaultInstructions,
    planSteps,
    resumePosition,
    stepGate
  } = await import("../lib/surveys")
  type Step = import("../lib/surveys").Step

  // --- The plan: instructions, defines, reviews, then questions ---

  const terms = [
    { id: 11, term: "band gap" },
    { id: 12, term: "grain boundary" }
  ]
  const plan = planSteps({
    welcome: "Read each term and write what it means in your lab.",
    terms,
    questions: DEFAULT_QUESTIONS
  })
  assert.deepEqual(
    plan.map((step) => [step.position, step.kind, step.termId]),
    [
      [1, "instructions", null],
      [2, "define", 11],
      [3, "define", 12],
      [4, "review", 11],
      [5, "review", 12],
      [6, "question", null],
      [7, "question", null]
    ],
    "instructions, every define, every review, then the questions, from 1"
  )
  assert.equal(
    plan[0].prompt,
    "Read each term and write what it means in your lab.",
    "the welcome text is the instructions step"
  )
  assert.equal(plan[0].responseKind, null)
  assert.match(plan[1].prompt ?? "", /band gap/, "a define step names its term")
  assert.match(
    plan[4].prompt ?? "",
    /grain boundary/,
    "a review step names its term"
  )
  assert.match(
    plan[3].prompt ?? "",
    /Compare the definitions of band gap/,
    "a review step uses the same participant-facing name as Position"
  )
  assert.doesNotMatch(plan[3].prompt ?? "", /candidate/i)
  assert.equal(plan[5].prompt, DEFAULT_QUESTIONS[0].prompt)
  assert.equal(plan[5].responseKind, "scale")
  assert.equal(plan[6].responseKind, "text")
  assert.ok(
    plan.slice(1, 5).every((step) => step.responseKind === null),
    "only a question has a response kind"
  )

  // No welcome, and a blank one, both fall back to the default text, because
  // the table refuses a blank instructions prompt.
  assert.equal(
    planSteps({ welcome: null, terms, questions: [] })[0].prompt,
    DEFAULT_INSTRUCTIONS
  )
  assert.equal(
    planSteps({ welcome: "   ", terms, questions: [] })[0].prompt,
    DEFAULT_INSTRUCTIONS
  )
  assert.equal(
    planSteps({ welcome: null, terms, questions: [] }).length,
    5,
    "no questions means the plan ends at the last review"
  )
  assert.equal(
    planSteps({ welcome: null, terms: [], questions: DEFAULT_QUESTIONS })
      .length,
    3,
    "a plan with no terms is instructions and the questions"
  )

  // The default closing questions ask about likely use and possible changes,
  // and the instructions describe the protocol without claiming consensus.
  assert.equal(DEFAULT_QUESTIONS.length, 2)
  assert.deepEqual(
    DEFAULT_QUESTIONS.map((question) => question.responseKind),
    ["scale", "text"]
  )
  assert.equal(
    DEFAULT_QUESTIONS[0].prompt,
    "How likely are you to use this list in your work?",
    "the scale question is one sentence; the shell labels the ends"
  )
  assert.equal(
    DEFAULT_QUESTIONS[1].prompt,
    "What would you add or change in this list?"
  )
  assert.ok(DEFAULT_INSTRUCTIONS.trim().length > 0)
  assert.match(DEFAULT_INSTRUCTIONS, /second round/)
  assert.match(DEFAULT_INSTRUCTIONS, /position/)
  assert.match(
    DEFAULT_INSTRUCTIONS,
    /If you do not know a term well enough to choose, skip it\./
  )
  assert.match(DEFAULT_INSTRUCTIONS, /Outside a study/)
  assert.match(DEFAULT_INSTRUCTIONS, /whole-term alternative/)
  assert.doesNotMatch(DEFAULT_INSTRUCTIONS, /candidate/i)
  assert.doesNotMatch(
    DEFAULT_INSTRUCTIONS,
    /agreed|group's reference|nobody corrects|drafts are wrong/i
  )
  assert.match(plan[1].prompt ?? "", /closest to what you think is right/i)
  assert.match(plan[1].prompt ?? "", /accept it as written/i)
  assert.match(plan[1].prompt ?? "", /suggest a revision/i)
  assert.match(plan[1].prompt ?? "", /propose a new definition/i)
  assert.match(plan[1].prompt ?? "", /do not know the term.*skip it/i)
  assert.doesNotMatch(
    plan[1].prompt ?? "",
    /as it stands|propose a replacement/i,
    "a define prompt uses the clarified Position choices"
  )
  assert.equal(
    isDefaultInstructions(
      DEFAULT_INSTRUCTIONS.replace(
        " If you do not know a term well enough to choose, skip it.",
        ""
      )
    ),
    true,
    "the persisted default immediately before Skip remains recognized"
  )
  assert.equal(
    isDefaultInstructions(
      "This study is a second round on a terminology list. Each term may have " +
        "candidate definitions, examples, and comments from earlier work.\n\n" +
        "MatSci-SAM uses five contribution actions: New term, Suggest a revision, " +
        "Propose a replacement, Comment, and Add example. Language-model assistance, " +
        "when offered, is an optional drafting aid inside New term or Suggest a " +
        "revision; it does not publish automatically. A comment stays a comment, and an example stays " +
        "separate from the definition.\n\nFor each term in this study, take a " +
        "position by accepting a candidate as written, using Suggest a revision to " +
        "say what is wrong or missing, or using Propose a replacement to offer a " +
        "different candidate. Then compare the candidates, vote on each, and use " +
        "Comment where you disagree or can add information. Any closing questions " +
        "come last.\n\nMatSci-SAM records the upvote used to accept a candidate, " +
        "revision and replacement proposals, review votes, comments, and question " +
        "responses. Completed steps are saved between visits, and the study " +
        "activity returns to the first incomplete step."
    ),
    true,
    "the previous persisted default remains recognized"
  )

  // --- Resumption is the lowest position without a completion ---

  const steps: Step[] = plan.map((step, index) => ({
    id: 100 + index,
    ...step
  }))
  const ids = (positions: number[]) =>
    new Set(
      steps
        .filter((step) => positions.includes(step.position))
        .map((step) => step.id)
    )

  assert.equal(resumePosition(steps, new Set()), 1, "nothing done: the start")
  assert.equal(resumePosition(steps, ids([1])), 2)
  assert.equal(
    resumePosition(steps, ids([1, 2, 4])),
    3,
    "a gap resumes at the gap, whatever is done after it"
  )
  assert.equal(
    resumePosition(steps, ids([1, 2, 3, 4, 5, 6, 7])),
    null,
    "everything done: nothing to resume"
  )
  assert.equal(
    resumePosition([], new Set()),
    null,
    "no steps: nothing to resume"
  )
  assert.equal(
    resumePosition(steps, new Set([999])),
    1,
    "a completion of a step not in the list counts for nothing"
  )
  // Order of arrival does not change the answer.
  assert.equal(resumePosition([...steps].reverse(), ids([1, 2])), 3)

  // --- Gates ---

  const byKind = (kind: Step["kind"]) =>
    steps.find((step) => step.kind === kind)!
  const neither = { hasPosition: false, hasResponse: false }
  const both = { hasPosition: true, hasResponse: true }

  assert.deepEqual(stepGate(byKind("instructions"), neither), { ok: true })
  assert.deepEqual(stepGate(byKind("review"), neither), { ok: true })
  assert.deepEqual(stepGate(byKind("define"), both), { ok: true })
  assert.deepEqual(stepGate(byKind("define"), neither), {
    ok: false,
    reason: "Take a position on this term first"
  })
  assert.deepEqual(
    stepGate(byKind("define"), { hasPosition: false, hasResponse: true }),
    { ok: false, reason: "Take a position on this term first" },
    "a response is not a position"
  )
  assert.deepEqual(stepGate(byKind("question"), both), { ok: true })
  assert.deepEqual(stepGate(byKind("question"), neither), {
    ok: false,
    reason: "Answer the question first"
  })
  assert.deepEqual(
    stepGate(byKind("question"), { hasPosition: true, hasResponse: false }),
    { ok: false, reason: "Answer the question first" },
    "a position is not an answer"
  )

  // --- Steps are replaced only while nobody has started ---

  assert.equal(mayRegenerateSteps(0), true)
  assert.equal(mayRegenerateSteps(1), false)
  assert.equal(mayRegenerateSteps(40), false)

  // --- An act names the step it belongs to ---

  const define11 = steps.find(
    (step) => step.kind === "define" && step.termId === 11
  )!
  const define12 = steps.find(
    (step) => step.kind === "define" && step.termId === 12
  )!
  const review11 = steps.find(
    (step) => step.kind === "review" && step.termId === 11
  )!
  const review12 = steps.find(
    (step) => step.kind === "review" && step.termId === 12
  )!

  const vote = (termId: number, vote: "up" | "down" | null) =>
    ({ kind: "vote", termId, vote }) as const

  assert.equal(actMatchesStep({ kind: "comment", termId: 11 }, review11), true)
  assert.equal(actMatchesStep(vote(11, "up"), review11), true)
  assert.equal(
    actMatchesStep(vote(11, "down"), review11),
    true,
    "a review step takes a vote of either kind"
  )
  assert.equal(
    actMatchesStep(vote(11, null), review11),
    true,
    "and a withdrawal"
  )
  assert.equal(
    actMatchesStep(vote(11, "up"), define11),
    true,
    "an upvote accepts a candidate in the define step of its term"
  )
  assert.equal(
    actMatchesStep(vote(11, "down"), define11),
    false,
    "a downvote takes no position"
  )
  assert.equal(
    actMatchesStep(vote(11, null), define11),
    false,
    "a withdrawal takes no position"
  )
  assert.equal(actMatchesStep({ kind: "define", termId: 11 }, define11), true)
  assert.equal(
    actMatchesStep({ kind: "comment", termId: 11 }, review12),
    false,
    "a review step of another term"
  )
  assert.equal(
    actMatchesStep(vote(11, "up"), define12),
    false,
    "a define step of another term is not where a vote accepts"
  )
  assert.equal(
    actMatchesStep({ kind: "comment", termId: 11 }, define11),
    false,
    "a comment is not a position"
  )
  assert.equal(
    actMatchesStep({ kind: "define", termId: 11 }, review11),
    false,
    "a definition is not a review act"
  )
  assert.equal(
    actMatchesStep({ kind: "define", termId: 12 }, define11),
    false,
    "a define step of another term"
  )
  assert.equal(
    actMatchesStep({ kind: "comment", termId: 11 }, byKind("instructions")),
    false
  )
  assert.equal(actMatchesStep(vote(11, "up"), byKind("question")), false)

  // The kind rule on its own: a step of the term of the act and of a kind
  // the act does not belong to, so the term check cannot answer for it.
  const question11: Step = { ...byKind("question"), termId: 11 }
  const instructions11: Step = { ...byKind("instructions"), termId: 11 }
  assert.equal(
    actMatchesStep(vote(11, "up"), question11),
    false,
    "a vote names no question step, whatever the term"
  )
  assert.equal(
    actMatchesStep({ kind: "comment", termId: 11 }, instructions11),
    false,
    "a comment names no instructions step, whatever the term"
  )
  assert.equal(
    actMatchesStep({ kind: "define", termId: 11 }, question11),
    false,
    "a definition names no question step, whatever the term"
  )

  // --- Taking part needs a live membership and an open study ---

  const asMember = { role: "member" }
  const asSteward = { role: "steward" }
  assert.equal(mayParticipate(asMember, "open"), true)
  assert.equal(mayParticipate(asSteward, "open"), true)
  assert.equal(
    mayParticipate(null, "open"),
    false,
    "a non-member, whoever they are"
  )
  assert.equal(mayParticipate(asMember, "draft"), false)
  assert.equal(mayParticipate(asMember, "closed"), false)
  assert.equal(mayParticipate(asMember, "retired"), false)
  assert.equal(mayParticipate(null, "closed"), false)

  console.log("Survey rule tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
