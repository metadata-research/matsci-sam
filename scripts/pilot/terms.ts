/*
 * The pilot term set.
 *
 * PLACEHOLDER. The 2025 ID4 study entered twenty terms; this list is to be
 * replaced with that set once recovered from the paper and the
 * matsci.yamz.net record [Chris has access]. Until then these twelve stand
 * in so rehearsals exercise the full protocol shape: two assigned terms per
 * persona, chosen to sit inside each persona's line of work.
 *
 * The driver never creates a term that already exists: terms are matched by
 * slug against the collection the operator built, and a hint here only
 * seeds the persona's define message.
 */

export type PilotTerm = {
  term: string
  // A nudge for the define step: what corner of the field the term is used
  // in, spoken to the persona.
  hint: string
}

export const pilotTerms: PilotTerm[] = [
  { term: "yield strength", hint: "mechanical testing of metals" },
  { term: "work hardening", hint: "plastic deformation behavior" },
  { term: "band gap", hint: "electronic structure calculations" },
  { term: "formation energy", hint: "defect thermodynamics" },
  { term: "grain boundary", hint: "microstructural characterization" },
  { term: "texture", hint: "crystallographic orientation distributions" },
  { term: "glass transition temperature", hint: "polymer processing" },
  { term: "cure kinetics", hint: "thermoset composite manufacture" },
  { term: "metadata schema", hint: "research data curation" },
  { term: "controlled vocabulary", hint: "data interoperability" },
  { term: "fatigue limit", hint: "cyclic loading of structural steel" },
  { term: "fracture toughness", hint: "crack growth resistance" }
]
