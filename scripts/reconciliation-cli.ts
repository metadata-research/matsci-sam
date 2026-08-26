const PLAN_HASH = /^[a-f0-9]{64}$/
const SLUG = /^[a-z0-9][a-z0-9_-]*$/

export type CuratePilotArgs = {
  manifest: string
  dryRun: boolean
  expectNoChanges: boolean
}

export const parseCuratePilotArgs = (
  argv: string[]
): CuratePilotArgs | null => {
  let manifest: string | undefined
  let dryRun = false
  let expectNoChanges = false

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === "--") continue
    if (argument === "--manifest") manifest = argv[++index]
    else if (argument === "--dry-run") dryRun = true
    else if (argument === "--expect-no-changes") expectNoChanges = true
    else return null
  }

  if (!manifest || (expectNoChanges && !dryRun)) return null
  return { manifest, dryRun, expectNoChanges }
}

export type StudyCopyArgs = {
  manifest: string
  mode: "dry-run" | "apply"
  expectPlan: string | undefined
  expectNoChanges: boolean
  allowUsedInstructions: Set<string>
}

export const parseStudyCopyArgs = (argv: string[]): StudyCopyArgs | null => {
  let manifest: string | undefined
  let mode: "dry-run" | "apply" | undefined
  let expectPlan: string | undefined
  let expectNoChanges = false
  const allowUsedInstructions = new Set<string>()

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === "--") continue
    if (argument === "--manifest") manifest = argv[++index]
    else if (argument === "--dry-run") {
      if (mode) return null
      mode = "dry-run"
    } else if (argument === "--apply") {
      if (mode) return null
      mode = "apply"
    } else if (argument === "--expect-plan") expectPlan = argv[++index]
    else if (argument === "--expect-no-changes") expectNoChanges = true
    else if (argument === "--allow-used-instructions") {
      const slug = argv[++index]
      if (!slug || !SLUG.test(slug)) return null
      allowUsedInstructions.add(slug)
    } else return null
  }

  if (!manifest || !mode) return null
  if (mode === "apply" && (!expectPlan || !PLAN_HASH.test(expectPlan)))
    return null
  if (mode === "dry-run" && expectPlan !== undefined) return null
  if (expectNoChanges && mode !== "dry-run") return null
  return {
    manifest,
    mode,
    expectPlan,
    expectNoChanges,
    allowUsedInstructions
  }
}
