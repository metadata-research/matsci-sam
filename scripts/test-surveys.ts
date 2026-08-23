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
  assert.match(plan[4].prompt ?? "", /grain boundary/, "a review step names its term")
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

  // The closing questions are about the list the group settled, and the
  // instructions say what the protocol is for.
  assert.equal(DEFAULT_QUESTIONS.length, 2)
  assert.deepEqual(
    DEFAULT_QUESTIONS.map((question) => question.responseKind),
    ["scale", "text"]
  )
  assert.match(DEFAULT_QUESTIONS[0].prompt, /use this list as it stands/)
  assert.match(DEFAULT_QUESTIONS[1].prompt, /missing from the list, or wrong/)
  assert.ok(DEFAULT_INSTRUCTIONS.trim().length > 0)
  assert.match(DEFAULT_INSTRUCTIONS, /second round/)
  assert.match(DEFAULT_INSTRUCTIONS, /position/)
  assert.match(DEFAULT_INSTRUCTIONS, /reference/)
  assert.match(
    plan[1].prompt ?? "",
    /accept|amend/i,
    "a define step asks for a position"
  )

  // --- Resumption is the lowest position without a completion ---

  const steps: Step[] = plan.map((step, index) => ({ id: 100 + index, ...step }))
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
  assert.equal(resumePosition([], new Set()), null, "no steps: nothing to resume")
  assert.equal(
    resumePosition(steps, new Set([999])),
    1,
    "a completion of a step not in the list counts for nothing"
  )
  // Order of arrival does not change the answer.
  assert.equal(resumePosition([...steps].reverse(), ids([1, 2])), 3)

  // --- Gates ---

  const byKind = (kind: Step["kind"]) => steps.find((step) => step.kind === kind)!
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

  assert.equal(actMatchesStep({ kind: "comment", termId: 11 }, review11), true)
  assert.equal(actMatchesStep({ kind: "vote", termId: 11 }, review11), true)
  assert.equal(
    actMatchesStep({ kind: "vote", termId: 11 }, define11),
    true,
    "an upvote accepts a candidate in the define step of its term"
  )
  assert.equal(actMatchesStep({ kind: "define", termId: 11 }, define11), true)
  assert.equal(
    actMatchesStep({ kind: "comment", termId: 11 }, review12),
    false,
    "a review step of another term"
  )
  assert.equal(
    actMatchesStep({ kind: "vote", termId: 11 }, define12),
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
  assert.equal(
    actMatchesStep({ kind: "vote", termId: 11 }, byKind("question")),
    false
  )

  // --- Taking part needs a live membership and an open study ---

  const asMember = { role: "member" }
  const asSteward = { role: "steward" }
  assert.equal(mayParticipate(asMember, "open"), true)
  assert.equal(mayParticipate(asSteward, "open"), true)
  assert.equal(mayParticipate(null, "open"), false, "a non-member, whoever they are")
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
