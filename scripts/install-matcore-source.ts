import "next/dist/server/node-environment"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { lstat, readFile, realpath } from "node:fs/promises"
import { resolve, relative, isAbsolute, sep } from "node:path"
import { db } from "../drizzle"
import { parseMatcoreSourceManifest } from "../lib/matcore-standard"
import { installMatcoreSource } from "../lib/matcore-workflow"

class RehearsalComplete extends Error {}
async function main() {
  const args = process.argv.slice(2),
    values = new Map<string, string>()
  let apply = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") {
      apply = true
      continue
    }
    if (
      !["--manifest", "--artifact", "--vocabulary", "--actor"].includes(
        args[i]
      ) ||
      !args[i + 1] ||
      values.has(args[i])
    )
      throw new Error(
        "Use --manifest PATH --artifact PATH --vocabulary SLUG --actor ADMIN_ID [--apply]. Default is a rolled-back rehearsal."
      )
    values.set(args[i], args[++i])
  }
  const actorId = Number(values.get("--actor")),
    vocabularySlug = values.get("--vocabulary")
  if (
    !Number.isSafeInteger(actorId) ||
    actorId <= 0 ||
    !vocabularySlug ||
    !/^[a-z0-9][a-z0-9_-]{0,199}$/.test(vocabularySlug)
  )
    throw new Error(
      "Provide an explicit administrator ID and workspace vocabulary."
    )
  async function protectedFile(flag: string) {
    const input = values.get(flag)
    if (!input || !isAbsolute(input))
      throw new Error(
        `${flag} requires an absolute protected path outside this checkout.`
      )
    const path = resolve(input),
      info = await lstat(path),
      root = await realpath(process.cwd()),
      actual = await realpath(path),
      within = relative(root, actual)
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.size > 24 * 1024 * 1024 ||
      (info.mode & 0o007) !== 0 ||
      (within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within))
    )
      throw new Error(
        `${flag} must be a private regular file outside the checkout, at most 24 MiB.`
      )
    return readFile(path)
  }
  const manifestBytes = await protectedFile("--manifest"),
    artifact = await protectedFile("--artifact")
  const manifest = parseMatcoreSourceManifest(
    JSON.parse(manifestBytes.toString("utf8"))
  )
  if (
    createHash("sha256").update(artifact).digest("hex") !==
    manifest.release.sha256
  )
    throw new Error(
      "Protected source artifact hash does not match the manifest."
    )
  if (manifest.release.version !== "0.3.0")
    throw new Error(
      "This installer accepts the reviewed 0.3.0 source only. Review the parser and identity mapping before installing another release."
    )
  const verification = spawnSync(
    "python3",
    [
      "scripts/build-matcore-standard.py",
      "--source",
      values.get("--artifact")!,
      "--output",
      values.get("--manifest")!,
      "--check"
    ],
    { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 }
  )
  if (verification.status !== 0)
    throw new Error(
      "Protected manifest does not reproduce from the reviewed source artifact. No database writes were attempted."
    )
  let result: Awaited<ReturnType<typeof installMatcoreSource>> | undefined
  try {
    await db.transaction(async (tx) => {
      result = await installMatcoreSource(
        tx,
        { manifest, vocabularySlug },
        actorId
      )
      if (!apply) throw new RehearsalComplete()
    })
  } catch (error) {
    if (!(error instanceof RehearsalComplete)) throw error
  }
  console.log(
    JSON.stringify({
      mode: apply ? "applied" : "rehearsed; rolled back",
      ...result
    })
  )
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Source installation failed."
    )
    process.exitCode = 1
  })
  .finally(() => db.$client.end())
