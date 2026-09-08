import { actMatchesStep, type Act, type Step } from "./surveys"
import { isSinglePassStudy } from "./study-protocol"

// Public comments move into ID4's retained Position step. They do not select
// a definition, cast a vote, or satisfy its completion gate.
export const studyActMatchesStep = (slug: string, act: Act, step: Step) =>
  actMatchesStep(act, step) ||
  (isSinglePassStudy(slug) &&
    act.kind === "comment" &&
    step.kind === "define" &&
    act.termId === step.termId)
