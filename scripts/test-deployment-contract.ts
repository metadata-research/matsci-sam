import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"

const root = process.cwd()

const read = (path: string) => readFileSync(resolve(root, path), "utf8")

const workstationRows = read("deploy/workstations.tsv")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("\t"))
assert(workstationRows.length > 0, "The workstation registry is empty")
const workstationIds = new Set<string>()
const workstationHosts = new Set<string>()
for (const [id, host, snapshotRecipient, ...extra] of workstationRows) {
  assert.match(id, /^[a-z][a-z0-9-]*$/, "Invalid workstation ID")
  assert.match(
    host,
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/,
    "Invalid workstation hostname"
  )
  assert(
    snapshotRecipient === "yes" || snapshotRecipient === "no",
    "Invalid snapshot permission"
  )
  assert.equal(extra.length, 0, "The workstation registry has extra fields")
  assert(!workstationIds.has(id), `Duplicate workstation ID: ${id}`)
  assert(!workstationHosts.has(host), `Duplicate workstation host: ${host}`)
  workstationIds.add(id)
  workstationHosts.add(host)
}

const superegoContentVerifier = read(
  "deploy/lib/verify-superego-public-content.sh"
)
const operationsOnlyMatch = superegoContentVerifier.match(
  /operations_only_paths=\(\n([\s\S]*?)\n\)/
)
assert(
  operationsOnlyMatch,
  "Could not locate the reviewed operations-only path list"
)
const expectedOperationsOnlyPaths = [
  ".agents/skills/manage-matsci-environments/SKILL.md",
  ".agents/skills/manage-matsci-environments/agents/openai.yaml",
  ".agents/skills/manage-matsci-environments/references/environments.md",
  ".agents/skills/manage-matsci-environments/scripts/status.sh",
  ".github/workflows/pr-verify.yml",
  ".gitignore",
  "README.md",
  "developing.md",
  "deploy/README.md",
  "deploy/configure-email-auth.sh",
  "deploy/lib/configure-email-auth-remote.sh",
  "deploy/lib/verify-superego-public-content.sh",
  "deploy/workstations.tsv",
  "scripts/test-deployment-contract.ts"
]
assert.deepEqual(
  operationsOnlyMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
  expectedOperationsOnlyPaths
)
assert.equal(
  execFileSync(
    resolve(root, "deploy/lib/verify-superego-public-content.sh"),
    ["--print-allowlist"],
    { encoding: "utf8" }
  ).trim(),
  operationsOnlyMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
)
assert.match(
  superegoContentVerifier,
  /merge-base --is-ancestor[\s\S]*validated_commit[\s\S]*candidate_commit/
)
assert.match(
  superegoContentVerifier,
  /--no-ext-diff[\s\S]*--no-textconv[\s\S]*--no-renames[\s\S]*--ignore-submodules=none/
)
assert.match(superegoContentVerifier, /export GIT_NO_REPLACE_OBJECTS=1/)
assert.match(
  superegoContentVerifier,
  /--verify-worktree[\s\S]*ls-files -v[\s\S]*write-tree[\s\S]*hash-object --no-filters/
)

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
  for (const path of expectedOperationsOnlyPaths) {
    const fixture = resolve(equivalenceDirectory, path)
    mkdirSync(dirname(fixture), { recursive: true })
    writeFileSync(fixture, `validated ${path}\n`)
  }
  mkdirSync(resolve(equivalenceDirectory, "app"), { recursive: true })
  writeFileSync(
    resolve(equivalenceDirectory, "app/page.tsx"),
    "export default function Page() { return null }\n"
  )
  const validatedCommit = commitFixture("validated application")
  assert.equal(
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, validatedCommit],
      { encoding: "utf8" }
    ).trim(),
    "exact-tree"
  )
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

  for (const path of expectedOperationsOnlyPaths) {
    writeFileSync(
      resolve(equivalenceDirectory, path),
      `reviewed operations change ${path}\n`
    )
  }
  const operationsCommit = commitFixture("change reviewed operations")
  assert.equal(
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, operationsCommit],
      { encoding: "utf8" }
    ).trim(),
    "reviewed-operations-only"
  )

  writeFileSync(
    resolve(equivalenceDirectory, "app/page.tsx"),
    "export default function Page() { return <main>changed</main> }\n"
  )
  const applicationCommit = commitFixture("change application")
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, applicationCommit],
      { stdio: "pipe" }
    )
  )
  const validatedTree = runGit("rev-parse", `${validatedCommit}^{tree}`)
  const replacementCommit = runGit(
    "-c",
    "user.name=MatSci deployment test",
    "-c",
    "user.email=deployment-test@example.invalid",
    "commit-tree",
    validatedTree,
    "-p",
    validatedCommit,
    "-m",
    "malicious local replacement"
  )
  runGit("replace", applicationCommit, replacementCommit)
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, applicationCommit],
      { stdio: "pipe" }
    )
  )
  runGit("replace", "-d", applicationCommit)

  writeFileSync(
    resolve(equivalenceDirectory, "app/page.tsx"),
    "export default function Page() { return null }\n"
  )
  mkdirSync(resolve(equivalenceDirectory, "drizzle"), { recursive: true })
  writeFileSync(
    resolve(equivalenceDirectory, "drizzle/schema.ts"),
    "export const changedSchema = true\n"
  )
  const schemaCommit = commitFixture("change schema")
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, schemaCommit],
      { stdio: "pipe" }
    )
  )

  rmSync(resolve(equivalenceDirectory, "drizzle"), {
    recursive: true,
    force: true
  })
  writeFileSync(resolve(equivalenceDirectory, "pnpm-lock.yaml"), "changed\n")
  const dependencyCommit = commitFixture("change dependency lock")
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, dependencyCommit],
      { stdio: "pipe" }
    )
  )

  rmSync(resolve(equivalenceDirectory, "pnpm-lock.yaml"))
  writeFileSync(
    resolve(equivalenceDirectory, "deploy/lib/reset-db-invariants.sql"),
    "SELECT false;\n"
  )
  const invariantCommit = commitFixture("change protected invariant")
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, invariantCommit],
      { stdio: "pipe" }
    )
  )

  rmSync(resolve(equivalenceDirectory, "deploy/lib/reset-db-invariants.sql"))
  chmodSync(resolve(equivalenceDirectory, "app/page.tsx"), 0o755)
  const modeCommit = commitFixture("change application mode")
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, modeCommit],
      { stdio: "pipe" }
    )
  )

  chmodSync(resolve(equivalenceDirectory, "app/page.tsx"), 0o644)
  renameSync(
    resolve(equivalenceDirectory, "deploy/README.md"),
    resolve(equivalenceDirectory, "app/deploy-readme.md")
  )
  const moveCommit = commitFixture("move allowed path into application")
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, moveCommit],
      { stdio: "pipe" }
    )
  )
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, "not-a-commit", moveCommit],
      { stdio: "pipe" }
    )
  )

  renameSync(
    resolve(equivalenceDirectory, "app/deploy-readme.md"),
    resolve(equivalenceDirectory, "deploy/README.md")
  )
  runGit("add", ".")
  runGit("config", "diff.ignoreSubmodules", "all")
  runGit(
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${operationsCommit},vendor/ignored`
  )
  const gitlinkCommit = commitIndex("add disallowed gitlink")
  assert.throws(() =>
    execFileSync(
      resolve(root, "deploy/lib/verify-superego-public-content.sh"),
      [equivalenceDirectory, validatedCommit, gitlinkCommit],
      { stdio: "pipe" }
    )
  )
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
for (const [environment, values] of [
  ["local", local],
  ["Superego", superego],
  ["Ego", ego]
] as const) {
  assert.equal(
    values.get("NEXT_PUBLIC_SITE_NAME"),
    "MatSci-SAM",
    `${environment} must use the protected MatSci-SAM application identity`
  )
  assert.equal(
    values.get("EMAIL_AUTH_ENABLED"),
    "false",
    `${environment} must default email authentication off`
  )
  assert.equal(
    values.get("EMAIL_AUTH_ACCOUNT_CREATION_ENABLED"),
    "false",
    `${environment} must default email account creation off`
  )
}
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

const expectedVersionKeys = [
  "ARCHITECTURE",
  "NGINX_PACKAGE_VERSION",
  "NODE_PACKAGE_VERSION",
  "NODE_VERSION",
  "PGVECTOR_PACKAGE_VERSION",
  "PNPM_VERSION",
  "POSTGRES_COMMON_PACKAGE_VERSION",
  "POSTGRES_MAJOR",
  "POSTGRES_PACKAGE_VERSION",
  "UBUNTU_VERSION"
].sort()
assert.deepEqual(sortedKeys(versions), expectedVersionKeys)

const packageJson = JSON.parse(read("package.json")) as {
  packageManager?: string
}
assert.equal(
  packageJson.packageManager,
  `pnpm@${versions.get("PNPM_VERSION")}`,
  "packageManager and the runtime contract differ"
)

const service = read("deploy/systemd/matsci-sam.service")
assert.match(
  service,
  /^ExecStart=\/usr\/bin\/pnpm exec next start --hostname 127\.0\.0\.1 --port 3000$/m
)

const egoProvisioner = read("deploy/lib/provision-ego-runtime-remote.sh")
assert.match(egoProvisioner, /umask 0022\s+npm install --global/)
assert.match(
  egoProvisioner,
  /runuser -u "\$\{app_user\}" -- \/usr\/bin\/pnpm --version/
)

const healthRoute = read("app/api/health/route.ts")
assert.match(healthRoute, /drizzle\."__drizzle_migrations"/)
for (const table of ['"users"', '"terms"', '"definitions"']) {
  assert(healthRoute.includes(table), `Health readiness does not check ${table}`)
}

const localProxy = read(
  "deploy/nginx/matsci-sam-public-local-ready.conf"
)
assert.match(localProxy, /server 127\.0\.0\.1:3000;/)
assert(!localProxy.includes("10.246.250.19"))
assert(!localProxy.includes("superego.cci.drexel.edu"))

const superegoBootstrap = read(
  "deploy/nginx/matsci-sam-superego.conf"
)
assert.match(superegoBootstrap, /server_name superego\.cci\.drexel\.edu;/)
assert(!superegoBootstrap.includes("server_name ego.cci.drexel.edu"))
assert(!superegoBootstrap.includes("129.25.202.67"))

const repeatableRelease = read("deploy/release.sh")
assert.match(
  repeatableRelease,
  /Usage: deploy\/release\.sh <superego\|ego>/
)
assert.match(
  repeatableRelease,
  /deploy\/release\.sh superego[\s\S]*deploy\/release\.sh ego/
)
assert.match(
  repeatableRelease,
  /superego\.cci\.drexel\.edu\/login[\s\S]*release this exact commit with: \.\/deploy\/release\.sh ego/
)
assert.match(
  repeatableRelease,
  /ego\.cci\.drexel\.edu\/login/
)
assert.match(
  repeatableRelease,
  /--resume-public-verification[\s\S]*resume-public-verification/
)
assert.match(
  repeatableRelease,
  /--forward-repair[\s\S]*operation=forward-repair/
)
assert.match(
  repeatableRelease,
  /candidate} == "\$\{superego_commit\}"[\s\S]*Deploy this exact commit to Superego before releasing it to Ego/
)
assert.match(
  repeatableRelease,
  /source_verifier=\$\{script_dir\}\/lib\/verify-superego-public-content\.sh/
)
assert.match(
  repeatableRelease,
  /for file in[\s\S]*"\$\{source_verifier\}"[\s\S]*"\$\{state_file\}"[\s\S]*"\$\{workstation_registry\}"/
)
assert.match(
  repeatableRelease,
  /"\$\{source_verifier\}" --verify-worktree "\$\{repo\}" "\$\{candidate\}"/
)
assert.match(
  repeatableRelease,
  /"\$\{source_verifier\}" --create-archive "\$\{repo\}" "\$\{candidate\}" "\$\{archive\}"/
)
assert.doesNotMatch(repeatableRelease, /^\s*git(?:\s+-C "[^"]+")?\s+archive\b/m)

const emailAuthConfigurator = read("deploy/configure-email-auth.sh")
const emailAuthConfiguratorRemote = read(
  "deploy/lib/configure-email-auth-remote.sh"
)
assert.match(
  emailAuthConfigurator,
  /<superego\|ego> <stage\|enable\|disable>/
)
assert.match(
  emailAuthConfigurator,
  /status --porcelain=v1[\s\S]*checkout must equal the reviewed origin\/dev commit/
)
assert.match(
  emailAuthConfigurator,
  /EMAIL_AUTH_GMAIL_REFRESH_TOKEN: tokenDocument\.refresh_token/
)
assert.match(
  emailAuthConfigurator,
  /base64 --decode[\s\S]*sudo \/bin\/bash -s --/
)
assert.doesNotMatch(emailAuthConfigurator, /systemctl|journalctl/)
assert.match(
  emailAuthConfiguratorRemote,
  /expected_hostname=cci-superego[\s\S]*expected_hostname=cci-ego/
)
assert.match(
  emailAuthConfiguratorRemote,
  /sha256sum "\$\{payload\}"[\s\S]*expected_payload_sha/
)
assert.match(
  emailAuthConfiguratorRemote,
  /app\.env\.\$\(date -u[\s\S]*install -o root -g root -m 0400/
)
assert.match(
  emailAuthConfiguratorRemote,
  /chown root:matsci-sam "\$\{partial\}"[\s\S]*chmod 0640 "\$\{partial\}"[\s\S]*mv -f "\$\{partial\}" "\$\{config\}"/
)
assert.match(
  emailAuthConfiguratorRemote,
  /No secret values were displayed and no service was restarted/
)
assert.doesNotMatch(emailAuthConfiguratorRemote, /systemctl|journalctl/)

const releaseForwardAncestryIndex = repeatableRelease.search(
  /git -C "\$\{repo\}" merge-base --is-ancestor "\$\{active_commit\}" "\$\{candidate\}"/
)
const releaseTargetSpecificGateIndex = repeatableRelease.indexOf(
  "if [[ ${target} == ego ]]; then"
)
assert(
  releaseForwardAncestryIndex >= 0 &&
    releaseForwardAncestryIndex < releaseTargetSpecificGateIndex,
  "Both Superego and Ego releases must move forward before target-specific gates"
)

const releaseWorktreeVerificationIndex = repeatableRelease.search(
  /"\$\{source_verifier\}" --verify-worktree/
)
const releaseArchiveCreationIndex = repeatableRelease.search(
  /"\$\{source_verifier\}" --create-archive/
)
assert(
  releaseWorktreeVerificationIndex >= 0 &&
    releaseWorktreeVerificationIndex < releaseArchiveCreationIndex,
  "The release archive must come from a verified, hardened worktree"
)

const superegoCandidateFunction = repeatableRelease.match(
  /^verify_superego_candidate\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  superegoCandidateFunction,
  "Could not locate the repeatable Superego candidate gate"
)
assert.match(
  superegoCandidateFunction[1],
  /readlink -e \/opt\/matsci-sam\/current[\s\S]*expected_candidate} == "\$\{superego_commit\}"/
)
assert.match(
  superegoCandidateFunction[1],
  /systemctl is-active --quiet matsci-sam\.service[\s\S]*systemctl is-active --quiet nginx\.service[\s\S]*curl[\s\S]*http:\/\/127\.0\.0\.1:3000\//
)
const superegoCandidateCalls = [
  ...repeatableRelease.matchAll(
    /^  verify_superego_candidate "\$\{candidate\}"$/gm
  )
]
assert.equal(
  superegoCandidateCalls.length,
  2,
  "Ego must gate on the exact healthy Superego candidate before preparation and mutation"
)
const releaseConfirmationIndex = repeatableRelease.indexOf(
  'fail "Release cancelled."'
)
const candidateRevalidationCalls = [
  ...repeatableRelease.matchAll(/^revalidate_candidate$/gm)
]
assert.equal(
  candidateRevalidationCalls.length,
  2,
  "Every target must revalidate reviewed source before artifact creation and remote staging"
)
const lateCandidateRevalidationIndex = repeatableRelease.lastIndexOf(
  "\nrevalidate_candidate\n"
)
const lateSuperegoGateIndex = repeatableRelease.lastIndexOf(
  '  verify_superego_candidate "${candidate}"'
)
const remoteStagingIndex = repeatableRelease.indexOf(
  'ssh "${ssh_host}" "mkdir --mode=0700'
)
assert(
  releaseConfirmationIndex >= 0 &&
    releaseConfirmationIndex < lateCandidateRevalidationIndex &&
    lateCandidateRevalidationIndex < lateSuperegoGateIndex &&
    lateSuperegoGateIndex < remoteStagingIndex,
  "Ego must recheck reviewed source and healthy exact-commit Superego immediately before staging"
)
assert.match(
  repeatableRelease.slice(releaseConfirmationIndex, remoteStagingIndex),
  /revalidate_candidate[\s\S]*if \[\[ \$\{target\} == ego \]\]; then[\s\S]*verify_superego_candidate "\$\{candidate\}"[\s\S]*fi/
)
assert.doesNotMatch(repeatableRelease, /refs\/remotes\/origin\/main/)
assert.doesNotMatch(
  repeatableRelease,
  /allow-undeployed|seed-ego-from-superego|deploy-ego-from-workstation|cutover-ego-public/
)
assert.doesNotMatch(
  repeatableRelease,
  /sudo (?:\/bin\/)?bash ['"]?\$\{remote_dir\}\/deploy-superego-in-place-remote\.sh/
)
assert.match(
  repeatableRelease,
  /launcher_base64=\$\(base64 --wrap=0 "\$\{remote_launcher\}"\)[\s\S]*base64 --decode[\s\S]*sudo \/bin\/bash -s --[\s\S]*release-payload\.tar[\s\S]*payload_sha/
)
assert.match(
  repeatableRelease,
  /printf 'format\\t2\\n'[\s\S]*printf 'operation\\t%s\\n' "\$\{operation\}"/
)
assert.match(
  read("deploy/deploy-superego-from-workstation.sh"),
  /exec "\$\{script_dir\}\/release\.sh" superego "\$@"/
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
assert.match(
  previousSourceRecordParser[1],
  /current_record_re='\^\(\[0-9a-f\]\{40\}\) \(\[0-9a-f\]\{64\}\)\$'[\s\S]*legacy_ego_record_re='\^\(\[0-9a-f\]\{40\}\) \(\[0-9a-f\]\{40\}\) \(\[0-9a-f\]\{40\}\) \(\[0-9a-f\]\{64\}\)\$'/
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

const currentPointerIndex = repeatableReleaseRemote.indexOf(
  'previous=$(readlink -e "${app_root}/current")'
)
const canonicalReleaseNameIndex = repeatableReleaseRemote.indexOf(
  "[[ ${previous_name} =~ ^([0-9a-f]{40})-([A-Za-z0-9]{8})$ ]]"
)
const sourceRecordMetadataIndex = repeatableReleaseRemote.indexOf(
  `$(stat -c '%U' "\${previous_source_record}") == root`
)
const sourceRecordWritableIndex = repeatableReleaseRemote.indexOf(
  `find "\${previous_source_record}" -maxdepth 0 -perm /022 -print -quit`
)
const sourceRecordLineCountIndex = repeatableReleaseRemote.indexOf(
  `$(awk 'END { print NR }' "\${previous_source_record}") == 1`
)
const sourceRecordParserIndex = repeatableReleaseRemote.indexOf(
  `parse_previous_source_record \\
  "\${source_record}" \\
  "\${target}" \\
  "\${source_record_size}"`
)
const previousManifestBindingIndex = repeatableReleaseRemote.indexOf(
  '[[ ${previous_commit} == "${manifest[previous_commit]}" ]]'
)
assert(
  currentPointerIndex >= 0 &&
    currentPointerIndex < canonicalReleaseNameIndex &&
    canonicalReleaseNameIndex < sourceRecordMetadataIndex &&
    sourceRecordMetadataIndex < sourceRecordWritableIndex &&
    sourceRecordWritableIndex < sourceRecordLineCountIndex &&
    sourceRecordLineCountIndex < sourceRecordParserIndex &&
    sourceRecordParserIndex < previousManifestBindingIndex,
  "Previous releases must have canonical names and exact trusted records before manifest binding"
)
assert.match(
  repeatableReleaseRemote,
  /printf '%s %s\\n' \\\n  "\$\{manifest\[commit\]\}" \\\n  "\$\{manifest\[archive_sha256\]\}" \\\n  >"\$\{release\}\/\.matsci-release-source"/
)
assert.match(
  repeatableReleaseRemote,
  /chown root:matsci-sam "\$\{release\}\/\.matsci-release-source"\nchmod 0640 "\$\{release\}\/\.matsci-release-source"/
)
assert.doesNotMatch(
  repeatableReleaseRemote.slice(
    sourceRecordMetadataIndex,
    sourceRecordLineCountIndex
  ),
  /%G|%a|root:root:444/
)
const reviewedReleaseLauncher = read(
  "deploy/lib/launch-reviewed-release-remote.sh"
)
assert.match(
  reviewedReleaseLauncher,
  /transport_payload=\$\{1:-\}[\s\S]*target=\$\{2:-\}[\s\S]*expected_payload_sha=\$\{3:-\}/
)
assert.match(
  reviewedReleaseLauncher,
  /root_payload=\$\{root_stage\}\/\.release-payload\.tar[\s\S]*install -o root -g root -m 0600[\s\S]*sha256sum "\$\{root_payload\}"[\s\S]*expected_payload_sha/
)
assert.match(
  reviewedReleaseLauncher,
  /expected_members=\$\([\s\S]*deploy-superego-in-place-remote\.sh[\s\S]*manifest\.tsv[\s\S]*reset-db-invariants\.sql[\s\S]*source\.tar[\s\S]*verify-migration-ledger\.sh[\s\S]*workstations\.tsv/
)
assert.match(
  reviewedReleaseLauncher,
  /root_stage=\$\(mktemp -d "\$\{incoming_root\}\/launch-\$\{target\}\.XXXXXXXX"\)[\s\S]*\/bin\/bash[\s\S]*"\$\{root_stage\}\/deploy-superego-in-place-remote\.sh"/
)
assert.match(
  repeatableReleaseRemote,
  /stage} =~ \^\$\{admin_root\}\/incoming\/launch-\$\{target\}/
)
assert.match(
  repeatableReleaseRemote,
  /stat -c '%U:%G:%a' "\$\{stage\}"\) == root:root:700/
)
assert.doesNotMatch(
  repeatableReleaseRemote,
  /allow-undeployed|seed-ego-from-superego|origin\/main/
)
assert.match(
  repeatableReleaseRemote,
  /superego\)[\s\S]*expected_hostname=cci-superego[\s\S]*authority_file=\$\{admin_workspace\}\/DATA-AUTHORITY[\s\S]*public_host=superego\.cci\.drexel\.edu/
)
assert.match(
  repeatableReleaseRemote,
  /ego\)[\s\S]*expected_hostname=cci-ego[\s\S]*expected_authority=ego[\s\S]*public_host=ego\.cci\.drexel\.edu/
)
assert.match(
  repeatableReleaseRemote,
  /verify_protected_app_config[\s\S]*NEXT_PUBLIC_SITE_URL[\s\S]*GOOGLE_CALLBACK_URL/
)
const protectedDatabaseIdentityFunction = repeatableReleaseRemote.match(
  /^verify_protected_database_identity\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  protectedDatabaseIdentityFunction,
  "Could not locate the protected database identity gate"
)
assert.match(
  protectedDatabaseIdentityFunction[1],
  /read-only\)[\s\S]*default_transaction_read_only=on[\s\S]*read_only_flag/
)
const repeatableProtectedConfigFunction = repeatableReleaseRemote.match(
  /^verify_protected_app_config\(\) \{\n([\s\S]*?)^APP_CONFIG\n^\}$/m
)
assert(
  repeatableProtectedConfigFunction,
  "Could not locate the repeatable release protected-config gate"
)
assert.match(
  repeatableProtectedConfigFunction[1],
  /\[\[ \$\{NEXT_PUBLIC_SITE_NAME:-\} == MatSci-SAM \]\]/
)
const protectedConfigCallIndexes = Array.from(
  repeatableReleaseRemote.matchAll(/^verify_protected_app_config$/gm),
  (match) => match.index
)
const repeatableBuildStartIndex = repeatableReleaseRemote.indexOf(
  'echo "Preparing and building the candidate'
)
assert.equal(
  protectedConfigCallIndexes.length,
  1,
  "The protected application configuration must be checked exactly once"
)
assert(
  protectedConfigCallIndexes[0] < repeatableBuildStartIndex,
  "The protected application configuration must be checked before the build"
)
assert.match(
  repeatableReleaseRemote,
  /target} == ego[\s\S]*DEV_AUTH_ENABLED[\s\S]*SESSION_COOKIE_SECURE/
)
assert.match(
  repeatableReleaseRemote,
  /EMAIL_AUTH_ENABLED[\s\S]*EMAIL_AUTH_FROM[\s\S]*gmail-api[\s\S]*EMAIL_AUTH_GMAIL_REFRESH_TOKEN[\s\S]*smtp[\s\S]*EMAIL_AUTH_SMTP_HOST/
)
assert.match(
  repeatableReleaseRemote,
  /systemctl stop nginx\.service[\s\S]*systemctl stop matsci-sam\.service/
)
assert.match(
  repeatableReleaseRemote,
  /pnpm install --frozen-lockfile --package-import-method=copy/
)
assert.match(
  repeatableReleaseRemote,
  /find "\$\{runtime_cache\}" -xdev -type d -exec chmod 00750[\s\S]*find "\$\{runtime_cache\}" -xdev -type f -exec chmod 00640/
)
assert.match(
  repeatableReleaseRemote,
  /find "\$\{release\}" -xdev -type d -exec chmod 00555[\s\S]*find "\$\{release\}" -xdev -type f -perm \/111 -exec chmod 00555[\s\S]*find "\$\{release\}" -xdev -type f ! -perm \/111 -exec chmod 00444/
)

const vectorExtensionIdentityFunction = repeatableReleaseRemote.match(
  /^read_vector_extension_identity\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  vectorExtensionIdentityFunction,
  "Could not locate the shared pgvector ownership reader"
)
assert.match(
  vectorExtensionIdentityFunction[1],
  /read-only\)[\s\S]*PGOPTIONS=-c default_transaction_read_only=on[\s\S]*pg_get_userbyid\(extowner\)[\s\S]*FROM pg_extension[\s\S]*WHERE extname = 'vector'/
)

const vectorExtensionAssertionFunction = repeatableReleaseRemote.match(
  /^assert_vector_extension\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  vectorExtensionAssertionFunction,
  "Could not locate the shared pgvector ownership assertion"
)
assert.match(
  vectorExtensionAssertionFunction[1],
  /read_vector_extension_identity "\$\{target_database\}" "\$\{session_mode\}"[\s\S]*vector\\tpostgres/
)

const liveDatabaseContractFunction = repeatableReleaseRemote.match(
  /^verify_live_database_contract\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  liveDatabaseContractFunction,
  "Could not locate the live database verification contract"
)
assert.match(
  liveDatabaseContractFunction[1],
  /read-only\)[\s\S]*PGOPTIONS=-c default_transaction_read_only=on[\s\S]*assert_vector_extension "\$\{database\}" "\$\{session_mode\}"[\s\S]*read_database_facts "\$\{database\}" "\$\{session_mode\}"/
)

const sharedDatabaseRestoreFunction = repeatableReleaseRemote.match(
  /^create_and_restore_database\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  sharedDatabaseRestoreFunction,
  "Could not locate the shared database restore contract"
)
assert.match(
  sharedDatabaseRestoreFunction[1],
  /runuser -u postgres -- createdb[\s\S]*--owner=matsci-sam[\s\S]*runuser -u postgres -- psql[\s\S]*CREATE EXTENSION IF NOT EXISTS vector;[\s\S]*runuser -u matsci-sam -- pg_restore[\s\S]*--no-comments[\s\S]*assert_vector_extension "\$\{target_database\}"/
)
assert.match(
  sharedDatabaseRestoreFunction[1],
  /if runuser -u postgres -- dropdb[\s\S]*then[\s\S]*scratch_database_created=false[\s\S]*else[\s\S]*failed restore database could not be removed/
)
assert.match(
  repeatableReleaseRemote,
  /database_stamp=\$\{stamp\/\/\[!0-9\]\/\}[\s\S]*scratch_database="matsci_\$\{environment_slug\}_release_check_\$\{database_stamp\}_\$\$"/
)
assert.match(
  repeatableReleaseRemote,
  /displaced_database="matsci_\$\{environment_slug\}_rollback_old_\$\{database_stamp\}_\$\$"/
)
for (const environment of ["superego", "ego"]) {
  const databaseStamp = "20260728T075400Z".replaceAll(/\D/g, "")
  for (const databaseName of [
    `matsci_${environment}_release_check_${databaseStamp}_4194304`,
    `matsci_${environment}_rollback_old_${databaseStamp}_4194304`
  ]) {
    assert.match(databaseName, /^[a-z][a-z0-9_]{0,62}$/)
    assert(Buffer.byteLength(databaseName, "utf8") <= 63)
  }
}
assert.equal(
  [...repeatableReleaseRemote.matchAll(/runuser -u postgres -- createdb/g)]
    .length,
  1,
  "Database creation must stay inside the shared pgvector-safe restore contract"
)
assert.equal(
  [...repeatableReleaseRemote.matchAll(/runuser -u matsci-sam -- pg_restore/g)]
    .length,
  1,
  "Database restores must not bypass the shared pgvector-safe contract"
)

const sharedDatabaseRestoreCalls = [
  ...repeatableReleaseRemote.matchAll(
    /^[ \t]*create_and_restore_database[ \t]+"\$\{([^}]+)\}"[ \t]+"\$\{([^}]+)\}"(?:[ \t]+\|\|[ \t]+return 1)?$/gm
  )
]
assert.equal(
  sharedDatabaseRestoreCalls.length,
  3,
  "Rollback, online rehearsal, and frozen rehearsal must share one restore contract"
)
assert(
  sharedDatabaseRestoreCalls.every((match) => match[1] === "scratch_database"),
  "Every repeatable restore must complete in scratch before use"
)
assert.deepEqual(
  sharedDatabaseRestoreCalls.map((match) => match[2]).sort(),
  ["backup", "backup_partial", "preflight_dump"],
  "The three repeatable restore paths changed"
)
const rollbackDatabaseRestoreFunction = repeatableReleaseRemote.match(
  /^restore_database_backup\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  rollbackDatabaseRestoreFunction,
  "Could not locate the repeatable release database rollback"
)
const rollbackScratchRestoreIndex = rollbackDatabaseRestoreFunction[1].indexOf(
  'create_and_restore_database "${scratch_database}" "${backup}"'
)
const rollbackLiveRenameIndex = rollbackDatabaseRestoreFunction[1].indexOf(
  'ALTER DATABASE \\"${database}\\" RENAME'
)
assert(
  rollbackScratchRestoreIndex >= 0 &&
    rollbackScratchRestoreIndex < rollbackLiveRenameIndex,
  "Rollback must restore and verify scratch before displacing the live database"
)
assert.match(
  repeatableReleaseRemote,
  /case \$\{live_vector_identity\} in[\s\S]*vector\\tpostgres[\s\S]*vector\\tmatsci-sam[\s\S]*target} == superego[\s\S]*live_vector_normalization_required=true[\s\S]*unexpected owner/
)
const vectorNormalizationFunction = repeatableReleaseRemote.match(
  /^normalize_live_vector_extension\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  vectorNormalizationFunction,
  "Could not locate the one-time live pgvector ownership normalization"
)
assert.match(
  vectorNormalizationFunction[1],
  /target} == superego[\s\S]*BEGIN;[\s\S]*extension_owner <> 'matsci-sam'[\s\S]*extension_schema <> 'public'[\s\S]*extension_config IS NOT NULL[\s\S]*pg_available_extension_versions[\s\S]*d\.deptype = 'x'[\s\S]*CREATE SCHEMA %I AUTHORIZATION %I[\s\S]*DROP EXTENSION vector RESTRICT[\s\S]*CREATE EXTENSION vector WITH SCHEMA %I VERSION %L[\s\S]*ALTER EXTENSION vector SET SCHEMA %I[\s\S]*pg_get_userbyid\(e\.extowner\) = 'postgres'[\s\S]*COMMIT;/
)
assert.doesNotMatch(
  vectorNormalizationFunction[1],
  /DROP EXTENSION vector CASCADE/
)
const vectorNormalizationBranch = repeatableReleaseRemote.match(
  /if \[\[ \$\{live_vector_normalization_required\} == true \]\]; then\n([\s\S]*?)\nfi/
)
assert(
  vectorNormalizationBranch,
  "Could not locate the one-time live pgvector ownership normalization"
)
assert.match(
  vectorNormalizationBranch[1],
  /read_vector_extension_identity "\$\{database\}"[\s\S]*vector\\tmatsci-sam[\s\S]*normalize_live_vector_extension "\$\{database\}"[\s\S]*live_vector_normalized=true[\s\S]*assert_vector_extension "\$\{database\}"/
)
assert.doesNotMatch(
  vectorNormalizationBranch[1],
  /restore_database_backup|database_mutation_started=true/
)
const vectorNormalizationIndex = repeatableReleaseRemote.indexOf(
  "if [[ ${live_vector_normalization_required} == true ]]; then"
)
const liveMigrationIndex = repeatableReleaseRemote.indexOf(
  'echo "Applying the verified migrations to the authoritative database."'
)
const liveDatabaseVerificationIndex = repeatableReleaseRemote.lastIndexOf(
  'verify_live_database_contract "${release}"'
)
assert(
  vectorNormalizationIndex >= 0 &&
    vectorNormalizationIndex < liveMigrationIndex &&
    liveMigrationIndex < liveDatabaseVerificationIndex,
  "Historical pgvector ownership must be normalized before live migration and verification"
)
const releaseRollbackFunction = repeatableReleaseRemote.match(
  /^rollback_on_failure\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  releaseRollbackFunction,
  "Could not locate the repeatable release rollback"
)
assert.match(
  releaseRollbackFunction[1],
  /database_mutation_started} == true[\s\S]*Restoring the prior release and database state[\s\S]*live_vector_normalized} == true[\s\S]*application data was unchanged[\s\S]*the database was unchanged/
)

const loopbackContractFunction = repeatableReleaseRemote.match(
  /^verify_loopback_contract\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  loopbackContractFunction,
  "Could not locate the shared loopback verification contract"
)
assert.match(
  loopbackContractFunction[1],
  /local_paths=\(\/ \/api\/health \/login /
)
assert.match(
  loopbackContractFunction[1],
  /http:\/\/127\.0\.0\.1:3000\/api\/login[\s\S]*verify_redirect_headers[\s\S]*307[\s\S]*\/login[\s\S]*local login compatibility entry/
)

const publicContractFunction = repeatableReleaseRemote.match(
  /^verify_public_contract\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  publicContractFunction,
  "Could not locate the shared public verification contract"
)
assert.match(
  publicContractFunction[1],
  /public_paths=\(\/ \/api\/health \/login /
)
const publicLoginCompatibilityIndex = publicContractFunction[1].indexOf(
  '"https://${host}/api/login"'
)
const publicGoogleEntryIndex = publicContractFunction[1].indexOf(
  '"https://${host}/api/auth/google"'
)
assert(
  publicLoginCompatibilityIndex >= 0 &&
    publicLoginCompatibilityIndex < publicGoogleEntryIndex &&
    publicContractFunction[1]
      .slice(publicLoginCompatibilityIndex, publicGoogleEntryIndex)
      .includes("The public login compatibility entry"),
  "Public verification must check the internal login page before Google OAuth"
)
assert.match(
  publicContractFunction[1],
  /Google entry did not return HTTP 307[\s\S]*accounts\.google\.com/
)

const publicHttpsWaitFunction = repeatableReleaseRemote.match(
  /^wait_for_public_https\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  publicHttpsWaitFunction,
  "Could not locate the bounded Nginx HTTPS readiness wait"
)
assert.match(
  publicHttpsWaitFunction[1],
  /timeout_seconds=\$\{2:-60\}[\s\S]*deadline=\$\(\(SECONDS \+ timeout_seconds\)\)[\s\S]*while \(\(SECONDS < deadline\)\)[\s\S]*--resolve "\$\{host\}:443:127\.0\.0\.1"[\s\S]*sleep 2/
)
const reopenAndVerifyFunction = repeatableReleaseRemote.match(
  /^reopen_and_verify_public\(\) \{\n([\s\S]*?)^\}$/m
)
assert(
  reopenAndVerifyFunction,
  "Could not locate the shared public reopen and verification function"
)
const publicReopenedIndex = reopenAndVerifyFunction[1].indexOf(
  "public_reopened=true"
)
const finalNginxStartIndex = reopenAndVerifyFunction[1].indexOf(
  "systemctl start nginx.service"
)
const boundedPublicWaitIndex = reopenAndVerifyFunction[1].indexOf(
  'wait_for_public_https "${public_host}" 60'
)
const strictPublicSmokeIndex = reopenAndVerifyFunction[1].indexOf(
  "verify_public_contract"
)
assert(
  publicReopenedIndex >= 0 &&
    publicReopenedIndex < finalNginxStartIndex &&
    finalNginxStartIndex < boundedPublicWaitIndex &&
    boundedPublicWaitIndex < strictPublicSmokeIndex,
  "Nginx must settle for a bounded interval before strict public smoke tests"
)
assert.equal(
  [...repeatableReleaseRemote.matchAll(/^[ \t]*reopen_and_verify_public$/gm)]
    .length,
  2,
  "Normal release and explicit recovery must share public verification"
)
assert.equal(
  [...repeatableReleaseRemote.matchAll(/^[ \t]*verify_loopback_contract$/gm)]
    .length,
  2,
  "Normal release and explicit recovery must share loopback verification"
)

const resumeBranchStart = repeatableReleaseRemote.lastIndexOf(
  "if [[ ${operation} == resume-public-verification ]]; then"
)
const normalReleaseStart = repeatableReleaseRemote.indexOf(
  '[[ ${previous_commit} != "${manifest[commit]}" ]]',
  resumeBranchStart
)
assert(
  resumeBranchStart >= 0 && normalReleaseStart > resumeBranchStart,
  "Could not isolate the explicit public-verification recovery branch"
)
const resumeBranch = repeatableReleaseRemote.slice(
  resumeBranchStart,
  normalReleaseStart
)
assert.match(
  resumeBranch,
  /previous_commit} == "\$\{manifest\[commit\]\}"[\s\S]*recorded_previous_sha:-} == "\$\{manifest\[archive_sha256\]\}"/
)
assert.match(
  resumeBranch,
  /verify_protected_database_identity|verify_live_database_contract/
)
assert.match(
  resumeBranch,
  /verify_live_database_contract "\$\{release\}" read-only[\s\S]*configure_definition_probe[\s\S]*verify_loopback_contract[\s\S]*reopen_and_verify_public[\s\S]*complete_operation/
)
assert.match(
  resumeBranch,
  /verify_protected_database_identity read-only/
)
const resumeIngressStopIndex = resumeBranch.indexOf(
  "systemctl stop nginx.service"
)
const resumeIngressInactiveIndex = resumeBranch.indexOf(
  "Nginx did not stop for public verification recovery"
)
const resumeDatabaseValidationIndex = resumeBranch.indexOf(
  "verify_protected_database_identity"
)
assert(
  resumeBranch.includes("keep_public_access_closed_on_failure=true") &&
    resumeIngressStopIndex >= 0 &&
    resumeIngressStopIndex < resumeIngressInactiveIndex &&
    resumeIngressInactiveIndex < resumeDatabaseValidationIndex,
  "Recovery must close ingress and preserve that closure before validation"
)
for (const forbiddenRecoveryMutation of [
  "pg_dump",
  "pg_restore",
  "create_and_restore_database",
  "pnpm db:migrate",
  "pnpm build",
  "pnpm install",
  "restore_database_backup",
  'mv -Tf "${next_link}"'
]) {
  assert(
    !resumeBranch.includes(forbiddenRecoveryMutation),
    `Public verification recovery unexpectedly mutates release state: ${forbiddenRecoveryMutation}`
  )
}
assert.doesNotMatch(
  repeatableReleaseRemote,
  /actions\.runner|\/etc\/sudoers\.d\/matsci-sam-runner|usermod --lock/
)
assert.match(
  repeatableReleaseRemote,
  /keep_public_access_closed_on_failure} != true[\s\S]*systemctl start nginx\.service/
)
assert.match(
  repeatableReleaseRemote,
  /nginx_initial_state=\$\(systemctl is-active nginx\.service[\s\S]*active\)[\s\S]*operation} == release[\s\S]*inactive\)[\s\S]*operation} == forward-repair[\s\S]*keep_public_access_closed_on_failure=true/
)
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

const maintenance = read(
  "deploy/nginx/matsci-sam-public-maintenance.conf"
)
const maintenanceHash = createHash("sha256")
  .update(maintenance)
  .digest("hex")
assert.equal(
  maintenanceHash,
  "0cc2bdcf106b8335d7bbacd9e51d445af3760557fb046adf98c4a1fc2593b593",
  "The known-good Ego maintenance configuration changed"
)

console.log("Deployment contract checks passed.")
