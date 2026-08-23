/*
 * The simulated cohort.
 *
 * Six persona accounts, all driven by the one registered model identity.
 * Each is a users row with isAi true and no aiModels row, on the precedent
 * of the legacy unnamed AI user: an aiModels row names a model identity, and
 * a persona is not a model, it is an account a model is driven under. The
 * display names say so, because a reader of the public record must not
 * mistake one for a person.
 *
 * Every persona walks every term, as every participant does. The voice
 * lines flavor the user message a generation runs from. The registered
 * prompt stays identical across personas, so the stamp records one prompt
 * key and the conversation shows the persona.
 *
 * TODO [Chris]: confirm the display-name wording before the public run.
 */

export type Persona = {
  // Index 1..6, stable across runs; the manifest records ids against it.
  n: number
  displayName: string
  // The persona's line of work, spoken in first person inside prompts.
  voice: string
}

export const personaName = (n: number, suffix: string) =>
  `Simulated Participant ${n} (Gemma 4)${suffix ? ` ${suffix}` : ""}`

export const personas: Omit<Persona, "displayName">[] = [
  {
    n: 1,
    voice:
      "I run uniaxial tension and hardness tests on additively manufactured steel coupons."
  },
  {
    n: 2,
    voice: "I do DFT calculations of defect energetics in oxide semiconductors."
  },
  {
    n: 3,
    voice: "I characterize microstructure with SEM and EBSD in a metallurgy lab."
  },
  {
    n: 4,
    voice:
      "I develop polymer composites and worry mostly about processing windows."
  },
  {
    n: 5,
    voice:
      "I manage a materials data repository and map submissions to a schema."
  },
  {
    n: 6,
    voice:
      "I study fatigue and fracture of welded joints for civil infrastructure."
  }
]
