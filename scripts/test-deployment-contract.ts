import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"

const root = process.cwd()

const read = (path: string) => readFileSync(resolve(root, path), "utf8")


const equivalenceDirectory = mkdtempSync(
  resolve(tmpdir(), "matsci-sam-source-equivalence-")
)
const runGit = (...args: string[]) =>
  execFileSync("git", ["-C", equivalenceDirectory, ...args], {
    encoding: "utf8"
  }).trim()
const commitIndex = (message: string) => {
  runGit(
    "-c",
    "user.name=MatSci deployment test",
    "-c",
    "user.email=deployment-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message
  )
  return runGit("rev-parse", "HEAD")
}
const commitFixture = (message: string) => {
  runGit("add", ".")
  return commitIndex(message)
}
try {
  runGit("init", "--quiet")
  // Seeded with the exact content the hidden-index loop below restores, so the
  // worktree still matches the commit after each skip-worktree round trip.
  const verifierFixturePath = "deploy/lib/verify-superego-public-content.sh"
  const verifierFixture = resolve(equivalenceDirectory, verifierFixturePath)
  mkdirSync(dirname(verifierFixture), { recursive: true })
  writeFileSync(verifierFixture, `validated ${verifierFixturePath}\n`)
  mkdirSync(resolve(equivalenceDirectory, "app"), { recursive: true })
  writeFileSync(
    resolve(equivalenceDirectory, "app/page.tsx"),
    "export default function Page() { return null }\n"
  )
  const validatedCommit = commitFixture("validated application")
  execFileSync(
    resolve(root, "deploy/lib/verify-superego-public-content.sh"),
    ["--verify-worktree", equivalenceDirectory, validatedCommit],
    { stdio: "pipe" }
  )

  const hiddenVerifierPath =
    "deploy/lib/verify-superego-public-content.sh"
  for (const [hide, unhide] of [
    ["--skip-worktree", "--no-skip-worktree"],
    ["--assume-unchanged", "--no-assume-unchanged"]
  ] as const) {
    runGit("update-index", hide, hiddenVerifierPath)
    writeFileSync(
      resolve(equivalenceDirectory, hiddenVerifierPath),
      `hidden modification via ${hide}\n`
    )
    assert.equal(
      runGit("status", "--porcelain=v1"),
      "",
      `${hide} no longer reproduces an empty porcelain status`
    )
    assert.throws(() =>
      execFileSync(
        resolve(root, "deploy/lib/verify-superego-public-content.sh"),
        ["--verify-worktree", equivalenceDirectory, validatedCommit],
        { stdio: "pipe" }
      )
    )
    runGit("update-index", unhide, hiddenVerifierPath)
    writeFileSync(
      resolve(equivalenceDirectory, hiddenVerifierPath),
      `validated ${hiddenVerifierPath}\n`
    )
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      ["--verify-worktree", equivalenceDirectory, validatedCommit],
      { stdio: "pipe" }
    )
  }

  const archiveDirectory = mkdtempSync(
    resolve(tmpdir(), "matsci-sam-source-archive-")
  )
  try {
    const ambientAttributes = resolve(
      equivalenceDirectory,
      ".git/info/attributes"
    )
    writeFileSync(ambientAttributes, "app/page.tsx export-ignore\n")
    const unsafeArchive = resolve(archiveDirectory, "unsafe.tar")
    execFileSync(
      "git",
      [
        "-C",
        equivalenceDirectory,
        "archive",
        "--format=tar",
        `--output=${unsafeArchive}`,
        validatedCommit
      ],
      { stdio: "pipe" }
    )
    const unsafeEntries = execFileSync(
      "tar",
      ["--list", `--file=${unsafeArchive}`],
      { encoding: "utf8" }
    )
    assert(
      !unsafeEntries.split("\n").includes("app/page.tsx"),
      "The ambient export-ignore regression fixture is ineffective"
    )

    const globalAttributes = resolve(archiveDirectory, "global-attributes")
    writeFileSync(globalAttributes, "app/page.tsx export-ignore\n")
    const maliciousTemplate = resolve(archiveDirectory, "template")
    mkdirSync(resolve(maliciousTemplate, "info"), { recursive: true })
    writeFileSync(
      resolve(maliciousTemplate, "info/attributes"),
      "app/page.tsx export-ignore\n"
    )
    const hostileGitEnvironment = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.attributesFile",
      GIT_CONFIG_VALUE_0: globalAttributes,
      GIT_TEMPLATE_DIR: maliciousTemplate
    }
    for (const [name, prefix, expectedEntry] of [
      ["root.tar", undefined, "app/page.tsx"],
      ["prefixed.tar", "--prefix=source/", "source/app/page.tsx"]
    ] as const) {
      const safeArchive = resolve(archiveDirectory, name)
      const arguments_ = [
        "--create-archive",
        equivalenceDirectory,
        validatedCommit,
        safeArchive
      ]
      if (prefix) arguments_.push(prefix)
      execFileSync(
        resolve(root, "deploy/lib/verify-superego-public-content.sh"),
        arguments_,
        { env: hostileGitEnvironment, stdio: "pipe" }
      )
      const safeEntries = execFileSync(
        "tar",
        ["--list", `--file=${safeArchive}`],
        { encoding: "utf8" }
      )
      assert(
        safeEntries.split("\n").includes(expectedEntry),
        "The reviewed archive inherited ambient export-ignore attributes"
      )
    }
  } finally {
    rmSync(archiveDirectory, { recursive: true, force: true })
  }

} finally {
  rmSync(equivalenceDirectory, { recursive: true, force: true })
}

const parseAssignments = (path: string) => {
  const result = new Map<string, string>()

  for (const [index, rawLine] of read(path).split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const separator = line.indexOf("=")
    assert.notEqual(
      separator,
      -1,
      `${path}:${index + 1} is not an assignment`
    )
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    assert.match(key, /^[A-Z][A-Z0-9_]*$/, `${path} has an unsafe key`)
    assert(!result.has(key), `${path} repeats ${key}`)

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    result.set(key, value)
  }

  return result
}

const local = parseAssignments(".env.example")
const superego = parseAssignments("deploy/app.env.example")
const ego = parseAssignments("deploy/ego/app.env.example")
const versions = parseAssignments("deploy/runtime-versions.env")

const sortedKeys = (values: Map<string, string>) =>
  [...values.keys()].sort()

assert.deepEqual(
  sortedKeys(superego),
  sortedKeys(local),
  "Superego and local environment contracts differ"
)
assert.deepEqual(
  sortedKeys(ego),
  sortedKeys(local),
  "Ego and local environment contracts differ"
)

assert.equal(
  superego.get("NEXT_PUBLIC_SITE_URL"),
  "https://superego.cci.drexel.edu"
)
assert.equal(
  superego.get("GOOGLE_CALLBACK_URL"),
  "https://superego.cci.drexel.edu/api/auth/callback"
)
assert.equal(ego.get("NEXT_PUBLIC_SITE_URL"), "https://ego.cci.drexel.edu")
assert.equal(
  ego.get("GOOGLE_CALLBACK_URL"),
  "https://ego.cci.drexel.edu/api/auth/callback"
)
assert.equal(ego.get("SESSION_COOKIE_SECURE"), "true")
assert.equal(ego.get("DEV_AUTH_ENABLED"), "false")

for (const key of [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SESSION_PASSWORD",
  "AUTH_TOKEN_ENCRYPTION_KEY"
]) {
  assert.equal(ego.get(key), "", `Ego template must not contain ${key}`)
}


const packageJson = JSON.parse(read("package.json")) as {
  packageManager?: string
}
assert.equal(
  packageJson.packageManager,
  `pnpm@${versions.get("PNPM_VERSION")}`,
  "packageManager and the runtime contract differ"
)








const repeatableReleaseRemote = read(
  "deploy/lib/deploy-superego-in-place-remote.sh"
)
const previousSourceRecordParser = repeatableReleaseRemote.match(
  /^parse_previous_source_record\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  previousSourceRecordParser,
  "Could not locate the previous-release source-record parser"
)
const runPreviousSourceRecordParser = (
  target: "superego" | "ego",
  sourceRecord: string,
  sourceRecordSize = Buffer.byteLength(sourceRecord, "utf8") + 1
) =>
  execFileSync(
    "bash",
    [
      "-c",
      `set -Eeuo pipefail
${previousSourceRecordParser[0]}
parse_previous_source_record "$1" "$2" "$3"
printf '%s|%s|%s|%s\\n' \
  "\${recorded_previous_commit}" \
  "\${recorded_previous_sha}" \
  "\${recorded_previous_tree}" \
  "\${recorded_previous_validated_superego_commit}"
`,
      "source-record-parser",
      sourceRecord,
      target,
      String(sourceRecordSize)
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim()

const currentSourceCommit = "e".repeat(40)
const currentSourceSha = "f".repeat(64)
assert.equal(
  runPreviousSourceRecordParser(
    "superego",
    `${currentSourceCommit} ${currentSourceSha}`
  ),
  `${currentSourceCommit}|${currentSourceSha}||`
)
assert.equal(
  runPreviousSourceRecordParser(
    "ego",
    `${currentSourceCommit} ${currentSourceSha}`
  ),
  `${currentSourceCommit}|${currentSourceSha}||`
)
const legacyEgoCommit = "a".repeat(40)
const legacyEgoTree = "b".repeat(40)
const legacyValidatedSuperego = "c".repeat(40)
const legacyEgoArchive = "d".repeat(64)
const legacyEgoRecord = [
  legacyEgoCommit,
  legacyEgoTree,
  legacyValidatedSuperego,
  legacyEgoArchive
].join(" ")
assert.equal(
  runPreviousSourceRecordParser("ego", legacyEgoRecord),
  `${legacyEgoCommit}|${legacyEgoArchive}|${legacyEgoTree}|${legacyValidatedSuperego}`
)
for (const [target, sourceRecord] of [
  ["superego", legacyEgoRecord],
  ["ego", ""],
  ["ego", legacyEgoCommit],
  ["ego", `${legacyEgoRecord} extra`],
  ["ego", `${legacyEgoCommit} ${legacyEgoTree} ${currentSourceSha}`],
  [
    "ego",
    `${legacyEgoCommit}  ${legacyEgoTree} ${legacyValidatedSuperego} ${legacyEgoArchive}`
  ],
  ["ego", `${currentSourceCommit}\n${currentSourceSha}`],
  ["ego", `${currentSourceCommit}  ${currentSourceSha}`],
  ["ego", `${currentSourceCommit}\t${currentSourceSha}`],
  ["ego", ` ${currentSourceCommit} ${currentSourceSha}`],
  ["ego", `${currentSourceCommit} ${currentSourceSha} `],
  ["ego", `${currentSourceCommit.toUpperCase()} ${currentSourceSha}`],
  ["ego", `${currentSourceCommit} ${currentSourceSha.toUpperCase()}`],
  ["ego", `${"g".repeat(40)} ${currentSourceSha}`],
  ["ego", `${currentSourceCommit} ${"g".repeat(64)}`],
  ["ego", `${"e".repeat(39)} ${currentSourceSha}`],
  ["ego", `${"e".repeat(41)} ${currentSourceSha}`],
  ["ego", `${currentSourceCommit} ${"f".repeat(63)}`],
  ["ego", `${currentSourceCommit} ${"f".repeat(65)}`],
  ["ego", `${currentSourceCommit} ${currentSourceSha}\r`]
] as const) {
  assert.throws(() => runPreviousSourceRecordParser(target, sourceRecord))
}
const legacyEgoFields = [
  legacyEgoCommit,
  legacyEgoTree,
  legacyValidatedSuperego,
  legacyEgoArchive
]
for (const fieldIndex of legacyEgoFields.keys()) {
  for (const replacement of [
    legacyEgoFields[fieldIndex].toUpperCase(),
    `g${legacyEgoFields[fieldIndex].slice(1)}`,
    legacyEgoFields[fieldIndex].slice(1),
    `${legacyEgoFields[fieldIndex]}a`
  ]) {
    const malformedFields = [...legacyEgoFields]
    malformedFields[fieldIndex] = replacement
    assert.throws(() =>
      runPreviousSourceRecordParser("ego", malformedFields.join(" "))
    )
  }
}
for (const sourceRecordSize of [105, 107]) {
  assert.throws(() =>
    runPreviousSourceRecordParser(
      "ego",
      `${currentSourceCommit} ${currentSourceSha}`,
      sourceRecordSize
    )
  )
}
for (const sourceRecordSize of [187, 189]) {
  assert.throws(() =>
    runPreviousSourceRecordParser("ego", legacyEgoRecord, sourceRecordSize)
  )
}




const opsHelper = read("deploy/ops/matsci-sam-ops")
const configPresenceSection = opsHelper.match(
  /^  config-presence\)\n([\s\S]*?)^    ;;$/m
)
assert(configPresenceSection, "Could not locate the config-presence operation")
const configPresenceProgram = configPresenceSection[1].match(
  /^\s*awk -F= '\n([\s\S]*?)^\s*' "\$\{config\}" \| sort$/m
)
assert(configPresenceProgram, "Could not locate the config-presence awk program")

const configPresenceFixture = [
  "# Values must never be printed by the diagnostic.",
  "NEXT_PUBLIC_SITE_URL=https://example.invalid",
  "NEXT_PUBLIC_SITE_NAME=First name",
  "NEXT_PUBLIC_SITE_NAME=Duplicate name",
  "DATABASE_URL=   ",
  "IGNORED_SECRET=do-not-print",
  ""
].join("\n")
const configPresenceDirectory = mkdtempSync(
  resolve(tmpdir(), "matsci-sam-config-presence-")
)
const configPresencePath = resolve(configPresenceDirectory, "app.env")
writeFileSync(configPresencePath, configPresenceFixture, { mode: 0o600 })
try {
  const configPresenceOutput = execFileSync(
    "mawk",
    ["-F=", configPresenceProgram[1], configPresencePath],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .sort()
  assert.deepEqual(configPresenceOutput, [
    "AUTH_TOKEN_ENCRYPTION_KEY=missing",
    "DATABASE_URL=blank",
    "DEV_AUTH_ENABLED=missing",
    "EMAIL_AUTH_ACCOUNT_CREATION_ENABLED=missing",
    "EMAIL_AUTH_ENABLED=missing",
    "GOOGLE_AUTH_ACCESS_MODE=missing",
    "GOOGLE_AUTH_ALLOWED_EMAILS=missing",
    "GOOGLE_CALLBACK_URL=missing",
    "GOOGLE_CLIENT_ID=missing",
    "GOOGLE_CLIENT_SECRET=missing",
    "NEXT_PUBLIC_SITE_NAME=duplicate",
    "NEXT_PUBLIC_SITE_URL=set",
    "OLLAMA_HOST=missing",
    "ORCID_AUTH_ENABLED=missing",
    "REFINE_PROMPT_KEY=missing",
    "SESSION_COOKIE_SECURE=missing",
    "SESSION_PASSWORD=missing",
    "SYSTEM_PROMPT_KEY=missing"
  ])
} finally {
  rmSync(configPresenceDirectory, { recursive: true, force: true })
}


console.log("Deployment contract checks passed.")
