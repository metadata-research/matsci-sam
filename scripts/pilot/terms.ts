/*
 * The pilot term set: eight terms of the 2025 list. Their drafts are the
 * 2025 MatBot Gemma 3 definitions already in the database, with the
 * comments the first round left on them, so the walkthrough is a second
 * round on that list.
 *
 * The driver never creates a term: terms are matched by label against the
 * collection the operator built, and a term that is missing stops the run.
 * The hint seeds only the persona's amend message.
 */

export type PilotTerm = {
  term: string
  // A nudge for the amend step: what corner of the field the term is used
  // in, spoken to the persona.
  hint: string
}

export const pilotTerms: PilotTerm[] = [
  { term: "phase diagram", hint: "alloy design and solidification" },
  { term: "band gap", hint: "electronic structure of semiconductors" },
  {
    term: "density functional theory (dft)",
    hint: "first-principles calculation"
  },
  { term: "activation energy", hint: "diffusion and reaction kinetics" },
  { term: "high-entropy alloy", hint: "multi-principal-element alloy design" },
  { term: "space group", hint: "crystallography and structure refinement" },
  {
    term: "coordination environment",
    hint: "local structure of crystalline and amorphous materials"
  },
  { term: "elastic properties", hint: "mechanical testing and modulus measurement" }
]
