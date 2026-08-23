/*
 * Pilot driver configuration.
 *
 * One place for the names, the seed, and the flags, so a rehearsal and the
 * public run differ only in the --suffix argument. The containers named here
 * are created by the operator through the interface; the driver resolves
 * them and refuses to run when they are missing.
 *
 * The run-once guard: with no --suffix the driver targets the clean public
 * slugs, and it refuses them when the manifest of the clean run says it
 * finished, and when the study already holds a completion by a persona with
 * the clean name while no manifest records the run, which is the public run
 * seen from the database alone. A rehearsal always passes --suffix, which
 * mints distinct slugs and persona names, and nothing is ever torn down.
 */

export type PilotArgs = {
  suffix: string
  dryRun: boolean
  resume: boolean
  steps: string[] | null
}

export const parseArgs = (argv: string[]): PilotArgs => {
  const args: PilotArgs = { suffix: "", dryRun: false, resume: false, steps: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--") continue // pnpm forwards the separator itself
    if (arg === "--suffix") {
      const value = (argv[++i] ?? "").replace(/^-+/, "")
      args.suffix = value ? `-${value}` : ""
    } else if (arg === "--dry-run") args.dryRun = true
    else if (arg === "--resume") args.resume = true
    else if (arg === "--steps") args.steps = argv[++i].split(",")
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

// Container slugs. The suffix separates rehearsals from the one public run.
export const slugs = (suffix: string) => ({
  community: `id4-pilot${suffix}`,
  study: `id4-pilot${suffix}`,
  collection: `id4-pilot-terms${suffix}`
})

/*
 * Deterministic structure. The positions are the personas' own, decided
 * from the text of each draft, and the review vote follows the position.
 * What is drawn is the rest of the shape: who comments in the review of a
 * term, how a tie in support between candidates is broken, and the scale
 * answers. Each term draws from a generator of its own, derived from the
 * seed and the label of the term, so the picks of a term depend on nothing
 * but those two, and adding a term or a question moves no other term's
 * picks. A rehearsal is then comparable to the last one in shape. Text
 * generation is not deterministic and is not made to look like it is.
 */
export const PILOT_SEED = Number(process.env.PILOT_SEED ?? 20260913)

export const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The generator of one label: FNV-1a over the label, folded with the seed,
// feeding mulberry32. The same label and seed give the same draws on any
// host.
export const generatorFor = (label: string) => {
  let hash = (0x811c9dc5 ^ PILOT_SEED) >>> 0
  for (const char of label) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return mulberry32(hash)
}

/*
 * Where the manifest checkpoints. Every write is recorded after it lands, so
 * --resume skips completed units after a transport failure against the
 * inference host.
 */
export const stateDir = process.env.PILOT_STATE_DIR ?? ".cache/pilot"

// The operator who owns the containers and the membership additions. The
// driver never invents an operator: it resolves this address and stops when
// it is absent.
export const operatorEmail = process.env.PILOT_OPERATOR_EMAIL

// Where verify.ts sends its HTTP checks. Defaults to the local dev server.
export const pilotBaseUrl = (
  process.env.PILOT_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "")

export const requireEnv = () => {
  const missing: string[] = []
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL")
  if (!process.env.OLLAMA_HOST) missing.push("OLLAMA_HOST")
  if (!process.env.SYSTEM_PROMPT_KEY && !process.env.SYSTEM_PROMPT)
    missing.push("SYSTEM_PROMPT_KEY")
  if (!operatorEmail) missing.push("PILOT_OPERATOR_EMAIL")
  if (missing.length) {
    console.error(`Missing environment: ${missing.join(", ")}`)
    process.exit(2)
  }
}
