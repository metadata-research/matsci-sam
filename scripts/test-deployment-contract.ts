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
  "deploy/cutover-ego-public.sh",
  "deploy/deploy-ego-from-workstation.sh",
  "deploy/ego/AGENTS.md",
  "deploy/lib/cutover-ego-public-remote.sh",
  "deploy/lib/deploy-ego-precutover-remote.sh",
  "deploy/lib/export-superego-for-ego-seed-remote.sh",
  "deploy/lib/seed-ego-from-superego-remote.sh",
  "deploy/lib/verify-superego-public-content.sh",
  "deploy/seed-ego-from-superego.sh",
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

const egoSeedWrapper = read("deploy/seed-ego-from-superego.sh")
const egoSeedHelper = read(
  "deploy/lib/seed-ego-from-superego-remote.sh"
)
const egoSeedExportHelper = read(
  "deploy/lib/export-superego-for-ego-seed-remote.sh"
)
const egoSeedTransform = read(
  "deploy/lib/ego-public-seed-transform.sql"
)
const egoSeedInvariants = read(
  "deploy/lib/ego-public-seed-invariants.sql"
)
assert.match(egoSeedWrapper, /export GIT_NO_REPLACE_OBJECTS=1/)

const seedEnvironmentProgram = egoSeedHelper.match(
  /environment_contract=\$\(\s+awk -F= '\n([\s\S]*?)\n  ' \/etc\/matsci-sam\/app\.env \|/
)
assert(
  seedEnvironmentProgram,
  "Could not locate the Ego seed environment-contract awk program"
)
const seedEnvironmentOutput = execFileSync(
  "mawk",
  [
    "-F=",
    seedEnvironmentProgram[1],
    resolve(root, "deploy/ego/app.env.example")
  ],
  { encoding: "utf8" }
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort()
assert.deepEqual(seedEnvironmentOutput, [
  "AUTH_TOKEN_ENCRYPTION_KEY",
  "GOOGLE_AUTH_ALLOWED_EMAILS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SESSION_PASSWORD"
])

const seedCleanupProgram = egoSeedWrapper.match(
  /phase=\$\(\s+awk -F '\\t' '([\s\S]*?)' \\\s+"\$\{stage\}\/prepare-state\.tsv"\s+\)/
)
assert(
  seedCleanupProgram,
  "Could not locate the Ego seed cleanup-state awk program"
)
const seedCleanupDirectory = mkdtempSync(
  resolve(tmpdir(), "matsci-sam-seed-cleanup-")
)
const seedCleanupPath = resolve(seedCleanupDirectory, "prepare-state.tsv")
writeFileSync(seedCleanupPath, "phase\tawaiting-offhost\n", { mode: 0o600 })
try {
  assert.equal(
    execFileSync("mawk", ["-F", "\t", seedCleanupProgram[1], seedCleanupPath], {
      encoding: "utf8"
    }).trim(),
    "awaiting-offhost"
  )
} finally {
  rmSync(seedCleanupDirectory, { recursive: true, force: true })
}

assert.match(egoSeedWrapper, /EGO_SEED_CHAT_FALLBACK/)
assert.match(
  egoSeedWrapper,
  /superego_content_verifier[\s\S]*superego_commit[\s\S]*public_commit/
)
assert.match(egoSeedWrapper, /public_tree} == "\$\{dev_tree\}"/)
assert.doesNotMatch(egoSeedWrapper, /superego_tree} == "\$\{public_tree\}"/)
assert.match(
  egoSeedWrapper,
  /superego_content_verifier}"[\s\S]*--create-archive[\s\S]*public_commit[\s\S]*--prefix=source\//
)
assert.doesNotMatch(egoSeedWrapper, /git -C "\$\{repo\}" archive/)
assert.match(
  egoSeedWrapper,
  /\.local\/state\/matsci-sam\/backups/
)
assert.match(egoSeedWrapper, /prepare '\$\{ego_dir\}'/)
assert.match(egoSeedWrapper, /finalize '\$\{ego_dir\}'/)
assert.match(egoSeedWrapper, /phase\\toffhost-verified/)
assert.match(egoSeedWrapper, /ego_audit=/)
assert.match(egoSeedWrapper, /Reusing the previously verified off-host seed backup/)
assert.match(egoSeedWrapper, /existing off-host seed backup does not match/)
assert.match(
  egoSeedWrapper,
  /stat -c "%U:%a" "\$\{marker\}"\) == cr625:600/
)
assert.match(
  egoSeedWrapper,
  /\/var\/lib\/matsci-sam-admin\/backups\/ego-initial-seed-/
)
assert.match(egoSeedHelper, /pnpm install --frozen-lockfile/)
assert.match(egoSeedHelper, /pnpm db:migrate/)
assert.match(
  egoSeedHelper,
  /NODE_OPTIONS=--max-old-space-size=3072 \/usr\/bin\/pnpm build/
)
assert.match(egoSeedHelper, /install -o root -g root -m 0400/)
assert.match(egoSeedHelper, /install -o cr625[\s\S]*-m 0600/)
assert.match(egoSeedHelper, /old_operations_sha=/)
assert.match(egoSeedHelper, /published_content_sha256\(\)/)
assert.match(egoSeedHelper, /LC_ALL=C/)
assert.match(egoSeedHelper, /PGTZ=UTC/)
assert.match(egoSeedHelper, /sha256sum "\$\{payload\}"/)
assert(!egoSeedHelper.includes("md5("))
assert.match(egoSeedHelper, /CREATE EXTENSION IF NOT EXISTS vector/)
assert.match(egoSeedHelper, /assert_pgvector "\$\{database\}"/)
assert.match(egoSeedHelper, /phase\]} == offhost-verified/)
assert.match(
  egoSeedHelper,
  /workstations\.tsv[\s\S]*source workstation is not uniquely registered/
)
const seedSourceGrammarIndex = egoSeedHelper.indexOf(
  "${manifest[source_host]} =~ ^[a-z][a-z0-9-]*$"
)
assert(
  seedSourceGrammarIndex >= 0 &&
    seedSourceGrammarIndex < egoSeedHelper.indexOf("registered_source=$("),
  "The seed helper must validate source_host before its registry lookup"
)
assert.match(
  egoSeedHelper,
  /source\/deploy\/workstations\.tsv[\s\S]*cmp --silent/
)
assert.doesNotMatch(egoSeedHelper, /manifest\[source_host\]\} == pa90/)
assert.match(egoSeedHelper, /admin_state=\/var\/lib\/matsci-sam-admin/)
assert.match(egoSeedHelper, /backup_dir=\$\{admin_state\}\/backups/)
assert.match(egoSeedHelper, /stat -c '%U:%G:%a'[\s\S]*root:root:700/)
assert(!egoSeedHelper.includes("/var/lib/matsci-sam/.ego-seed-root"))
assert(!egoSeedHelper.includes("live-mutation-starting"))
assert.match(
  egoSeedHelper,
  /seed_complete\} != true && \$\{live_mutation_started\} == true[\s\S]*restore_empty_live_database/
)
assert.match(egoSeedHelper, /live_mutation_started=true/)
assert.match(
  egoSeedHelper,
  /install -o root -g root -m 0400[\s\S]*"\$\{stage\}\/\$\{staged_file\}"[\s\S]*"\$\{input_dir\}\/\$\{staged_file\}"/
)
assert.match(egoSeedExportHelper, /admin_state=\/var\/lib\/matsci-sam-admin/)
assert.match(egoSeedExportHelper, /ego-seed-export\.XXXXXXXX/)
assert(!egoSeedExportHelper.includes("/var/lib/matsci-sam/.ego-seed-export"))
assert.match(
  egoSeedExportHelper,
  /install -o root -g root -m 0400[\s\S]*"\$\{stage\}\/\$\{staged_file\}"[\s\S]*"\$\{input_dir\}\/\$\{staged_file\}"/
)
assert.match(egoSeedExportHelper, /CREATE EXTENSION IF NOT EXISTS vector/)
assert.match(
  egoSeedExportHelper,
  /CREATE EXTENSION IF NOT EXISTS vector[\s\S]*pg_restore[\s\S]*--no-comments[\s\S]*<"\$\{dump\}"/
)
assert.match(
  egoSeedHelper,
  /restore_dump\(\)[\s\S]*pg_restore[\s\S]*--no-comments[\s\S]*<"\$\{dump\}"/
)

const transformIndex = egoSeedHelper.indexOf(
  'echo "Applying the reviewed public privacy transformation."'
)
const secondRestoreIndex = egoSeedHelper.indexOf(
  'echo "Restoring the sanitized dump a second time."'
)
const buildIndex = egoSeedHelper.indexOf(
  'echo "Installing dependencies, migrating scratch, and building'
)
const liveInitializationIndex = egoSeedHelper.indexOf(
  'echo "Initializing the live Ego database'
)
const rawRemovalIndex = egoSeedHelper.indexOf(
  'unlink "${stage}/superego-database.dump"'
)
const authorityTransitionIndex = egoSeedHelper.indexOf(
  'mv -Tf "${authority_partial}" "${authority_file}"'
)
assert(
  transformIndex >= 0 &&
    transformIndex < secondRestoreIndex &&
    secondRestoreIndex < buildIndex &&
    buildIndex < rawRemovalIndex &&
    !egoSeedHelper.slice(rawRemovalIndex).includes(
      'echo "Initializing the live Ego database'
    ),
  "The Ego seed rehearsal and privacy-boundary order changed"
)
assert(
  liveInitializationIndex >= 0 &&
    liveInitializationIndex < authorityTransitionIndex &&
    egoSeedHelper
      .slice(liveInitializationIndex, authorityTransitionIndex)
      .includes('restore_dump "${database}" "${result[root_backup]}"'),
  "Finalization no longer restores the verified backup before authority"
)

const prepareCallIndex = egoSeedWrapper.indexOf(
  "seed-ego-from-superego-remote.sh' prepare"
)
const offHostVerifiedIndex = egoSeedWrapper.indexOf(
  "finalize_receipt=${work_dir}/finalize-receipt.tsv"
)
const finalizeCallIndex = egoSeedWrapper.indexOf(
  "seed-ego-from-superego-remote.sh' finalize"
)
assert(
  prepareCallIndex >= 0 &&
    prepareCallIndex < offHostVerifiedIndex &&
    offHostVerifiedIndex < finalizeCallIndex,
  "Ego authority may finalize before the verified off-host copy"
)

for (const privateTable of [
  '"emailAuthTokens"',
  '"oauthAccounts"',
  '"siteFeedback"',
  '"chats"',
  '"definitionEdits"'
]) {
  assert(
    egoSeedTransform.includes(`DELETE FROM ${privateTable}`),
    `The Ego seed does not purge ${privateTable}`
  )
  assert(
    egoSeedInvariants.includes(privateTable),
    `The Ego seed does not verify ${privateTable}`
  )
}
assert.match(egoSeedTransform, /SET email = NULL,[\s\S]*"emailVerifiedAt" = NULL/)
assert.match(egoSeedInvariants, /definition score differs from current-revision/)

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
  "3a569089e44265314a3cba59237b2619940960543d6f609343d7bf2973d4a4a8",
  "The known-good Ego maintenance configuration changed"
)

const egoReleaseWrapper = read("deploy/deploy-ego-from-workstation.sh")
const egoReleaseRemote = read(
  "deploy/lib/deploy-ego-precutover-remote.sh"
)
const egoCutoverWrapper = read("deploy/cutover-ego-public.sh")
const egoCutoverRemote = read(
  "deploy/lib/cutover-ego-public-remote.sh"
)
for (const wrapper of [
  egoSeedWrapper,
  egoReleaseWrapper,
  egoCutoverWrapper
]) {
  assert.match(wrapper, /verify_reviewed_worktree\(\)/)
  assert.match(
    wrapper,
    /hash-object[\s\S]*--no-filters[\s\S]*--verify-worktree/
  )
  assert.match(wrapper, /unset[\s\S]*GIT_INDEX_FILE/)
}
for (const wrapper of [
  egoReleaseWrapper,
  egoCutoverWrapper
]) {
  assert.match(wrapper, /export GIT_NO_REPLACE_OBJECTS=1/)
}
for (const [name, remote] of [
  ["first-release", egoReleaseRemote],
  ["cutover", egoCutoverRemote]
] as const) {
  const grammarIndex = remote.indexOf(
    "${manifest[source_host]} =~ ^[a-z][a-z0-9-]*$"
  )
  const lookupIndex = remote.indexOf("registered_source=$(")
  assert(
    grammarIndex >= 0 && grammarIndex < lookupIndex,
    `The ${name} helper must validate source_host before its registry lookup`
  )
}

assert.match(egoReleaseWrapper, /state_authority} == ego/)
assert.match(egoReleaseWrapper, /remote_authority} == ego/)
// The public candidate is the reviewed commit itself: no promotion branch,
// no tree diffing, no path allowlist. Superego equivalence is exact commit
// equality, and shipping a commit Superego has not run is an explicit,
// recorded operator override.
assert.doesNotMatch(egoReleaseWrapper, /refs\/remotes\/origin\/main/)
assert.match(egoReleaseWrapper, /candidate=\$\{origin_dev\}/)
assert.match(
  egoReleaseWrapper,
  /\[\[ \$\{superego_commit\} == "\$\{candidate\}" \]\][\s\S]*superego_validation=deployed-on-superego/
)
assert.match(
  egoReleaseWrapper,
  /allow_undeployed} == true[\s\S]*superego_validation=undeployed-operator-override/
)
assert.match(egoReleaseWrapper, /--allow-undeployed/)
assert.match(
  egoReleaseWrapper,
  /superego_content_verifier}"[\s\S]*--create-archive[\s\S]*candidate/
)
assert.doesNotMatch(egoReleaseWrapper, /git -C "\$\{repo\}" archive/)
assert.match(
  egoReleaseWrapper,
  /release=absent\\nservice=inactive\\nenabled=disabled/
)
assert.match(
  egoReleaseWrapper,
  /Type PREPARE EGO RELEASE to continue/
)

assert.match(egoReleaseRemote, /\$\(<"\$\{authority_file\}"\) == ego/)
assert.match(
  egoReleaseRemote,
  /!\s+-e \$\{app_root\}\/current && ! -L \$\{app_root\}\/current/
)
assert.match(
  egoReleaseRemote,
  /systemctl is-active matsci-sam\.service[\s\S]*== inactive/
)
assert.match(
  egoReleaseRemote,
  /systemctl is-enabled matsci-sam\.service[\s\S]*== disabled/
)
assert.match(egoReleaseRemote, /pg_dump[\s\S]*--format=custom/)
assert.match(
  egoReleaseRemote,
  /createdb[\s\S]*CREATE EXTENSION IF NOT EXISTS vector[\s\S]*pg_restore[\s\S]*--dbname="\$\{scratch_database\}"[\s\S]*--no-comments[\s\S]*<"\$\{backup_partial\}"/
)
assert.match(
  egoReleaseRemote,
  /source \/etc\/matsci-sam\/app\.env[\s\S]*pnpm build/
)
assert.match(
  egoReleaseRemote,
  /verify_database "\$\{database\}" "\$\{release\}"/
)
assert.match(
  egoReleaseRemote,
  /verify_database "\$\{scratch_database\}" "\$\{release\}"/
)
assert.match(
  egoReleaseRemote,
  /deploy\/lib\/ego-public-seed-invariants\.sql/
)
assert.match(
  egoReleaseRemote,
  /stage}\/ego-public-seed-invariants\.sql/
)
assert.doesNotMatch(egoReleaseRemote, /pnpm db:migrate/)
assert.doesNotMatch(
  egoReleaseRemote,
  /systemctl (?:start|stop|restart|reload) nginx/
)
assert.doesNotMatch(egoReleaseRemote, /nginx -s reload/)
assert.match(
  egoReleaseRemote,
  /\/api\/auth\/google[\s\S]*accounts\.google\.com/
)
assert.match(egoReleaseRemote, /\/dev-login \/api\/auth\/dev-login/)
assert.match(
  egoReleaseRemote,
  /verification_marker=\$\{release\}\/\.matsci-precutover-verified/
)
for (const markerField of [
  "commit",
  "tree",
  "archive_sha256",
  "maintenance_sha256",
  "candidate_nginx_sha256",
  "database_facts_sha256",
  "release_artifact_manifest_sha256",
  "database_backup_path",
  "database_backup_sha256",
  "verified_at"
]) {
  assert.match(
    egoReleaseRemote,
    new RegExp(`printf '${markerField}=%s\\\\n'`)
  )
}
assert.match(egoReleaseRemote, /printf 'format=1\\n'/)
assert.match(
  egoReleaseRemote,
  /install -o root -g root -m 0400[\s\S]*verification_marker/
)
assert.match(
  egoReleaseRemote,
  /admin_state=\/var\/lib\/matsci-sam-admin[\s\S]*root_stage=\$\(mktemp -d "\$\{admin_state\}\/ego-release-stage\.XXXXXX"\)[\s\S]*install -o root -g root -m 0400[\s\S]*stage=\$\{root_stage\}/
)
assert.match(
  egoReleaseRemote,
  /pnpm install --frozen-lockfile --package-import-method=copy/
)
assert.match(
  egoReleaseRemote,
  /runtime_cache=\$\{cache_root\}\/\$\{release_name\}[\s\S]*ln -s "\$\{runtime_cache\}" "\$\{release\}\/\.next\/cache"/
)
assert.match(
  egoReleaseRemote,
  /chown -hR root:root "\$\{release\}"[\s\S]*find "\$\{release\}" -xdev -type d -exec chmod 00555[\s\S]*find "\$\{release\}" -xdev -type f ! -perm \/111 -exec chmod 0444/
)
assert.match(
  egoReleaseRemote,
  /find "\$\{runtime_cache\}" -xdev -type d -exec chmod 00750/
)
assert.match(
  egoReleaseRemote,
  /write_release_artifact_manifest "\$\{release\}" "\$\{artifact_manifest_partial\}"[\s\S]*install -o root -g root -m 0400[\s\S]*\.matsci-release-artifacts/
)
assert.match(
  egoReleaseRemote,
  /for protected_parent in "\$\{app_root\}" "\$\{app_root\}\/releases"[\s\S]*chown root:root "\$\{protected_parent\}"[\s\S]*chmod 00755 "\$\{protected_parent\}"/
)
assert.match(egoReleaseRemote, /public_mode=maintenance/)

assert.doesNotMatch(egoCutoverWrapper, /refs\/remotes\/origin\/main/)
assert.match(egoCutoverWrapper, /expected_commit=\$\{origin_dev\}/)
assert.match(
  egoCutoverWrapper,
  /Type CUT OVER EGO PUBLIC to continue/
)
assert.match(
  egoCutoverWrapper,
  /second gate requires a real browser Google login/
)
assert.match(
  egoCutoverWrapper,
  /workstation_registry_sha256[\s\S]*workstations\.tsv/
)
assert.match(
  egoCutoverRemote,
  /workstations\.tsv[\s\S]*source workstation is not uniquely registered/
)
assert.match(
  egoCutoverRemote,
  /stage}\/workstations\.tsv[\s\S]*release}\/deploy\/workstations\.tsv/
)
assert.doesNotMatch(egoCutoverRemote, /manifest\[source_host\]\} == pa90/)
assert.match(egoCutoverRemote, /\[\[ -t 0 && -t 1 \]\]/)
assert.match(
  egoCutoverRemote,
  /admin_state=\/var\/lib\/matsci-sam-admin[\s\S]*root_stage=\$\(mktemp -d "\$\{admin_state\}\/ego-cutover-stage\.XXXXXX"\)[\s\S]*install -o root -g root -m 0400[\s\S]*stage=\$\{root_stage\}/
)
for (const verifiedField of [
  "release_artifact_manifest_sha256",
  "database_backup_path",
  "database_backup_sha256"
]) {
  assert.match(
    egoCutoverRemote,
    new RegExp(`\\n  ${verifiedField}\\n`)
  )
}
assert.match(
  egoCutoverRemote,
  /pg_restore --list "\$\{database_backup\}"/
)
assert.match(
  egoCutoverRemote,
  /createdb[\s\S]*CREATE EXTENSION IF NOT EXISTS vector[\s\S]*pg_restore[\s\S]*--dbname="\$\{scratch_database\}"[\s\S]*--no-comments[\s\S]*<"\$\{database_backup\}"/
)
assert.match(
  egoCutoverRemote,
  /verify_database "\$\{scratch_database\}" "\$\{release\}"/
)
assert.match(
  egoCutoverRemote,
  /write_release_artifact_manifest "\$\{release\}" "\$\{artifact_check\}"[\s\S]*frozen release changed immediately before public activation/
)
assert.match(
  egoCutoverRemote,
  /database changed immediately before public activation[\s\S]*verify_database "\$\{database\}" "\$\{release\}"/
)
assert.match(
  egoCutoverRemote,
  /cutover_started=true[\s\S]*mv -Tf "\$\{candidate_partial\}" "\$\{active_site\}"/
)
const localEdgeCheck = egoCutoverRemote.indexOf(
  "verify_https_contract local"
)
const publicEdgeCheck = egoCutoverRemote.indexOf(
  "verify_https_contract public"
)
const oauthGate = egoCutoverRemote.indexOf(
  "EGO OAUTH IDENTITY VERIFIED"
)
const serviceEnable = egoCutoverRemote.indexOf(
  'systemctl enable "${service}"'
)
assert(localEdgeCheck >= 0, "Ego cutover lacks the local edge check")
assert(
  publicEdgeCheck > localEdgeCheck,
  "Ego cutover must check the public edge after the local edge"
)
assert(
  oauthGate > publicEdgeCheck,
  "The human OAuth gate must follow automated edge checks"
)
assert(
  serviceEnable > oauthGate,
  "The Ego service must not be enabled before human OAuth validation"
)
const reloadSettle = egoCutoverRemote.indexOf("reload_settled=true")
assert(
  reloadSettle >= 0 && reloadSettle < localEdgeCheck,
  "Ego cutover must wait for the reloaded edge before the local edge check"
)
assert.match(
  egoCutoverRemote,
  /systemctl reload nginx\.service[\s\S]*did not begin serving within 60 seconds/
)
for (const manifestWalk of [egoCutoverRemote, egoReleaseRemote]) {
  assert.match(manifestWalk, /xargs --null --no-run-if-empty sha256sum --zero/)
  assert.match(
    manifestWalk,
    /unsafe_path=\$\([\s\S]*?\) \|\| fail "The release could not be traversed for unsafe paths\."/
  )
  assert.match(
    manifestWalk,
    /-printf '%y\\t%m\\t%u:%g\\t%p\\t%l\\0'[\s\S]*sort --zero-terminated/
  )
  assert.match(
    manifestWalk,
    /while IFS=\$'\\t' read -r -d '' entry_type mode ownership path target/
  )
  assert.match(
    manifestWalk,
    /\[\[ \$\{path\} == "\$\{release_dir\}"\/\* \]\] \|\|\n\s*fail "The release traversal left the release directory\."/
  )
  assert.match(
    manifestWalk,
    /recorded_entries \+ skipped_entries\)\) -eq \$\{expected_entries\}/
  )
}
assert.match(
  egoCutoverRemote,
  /IFS= read -r -t 900 human_confirmation[\s\S]*\$\{human_confirmation\} == "EGO OAUTH IDENTITY VERIFIED"/
)
assert.match(
  egoCutoverRemote,
  /install -o root -g root -m 0400[\s\S]*oauth_validation_install[\s\S]*mv -Tf "\$\{oauth_validation_install\}" "\$\{oauth_validation_record\}"/
)
assert.match(
  egoCutoverRemote,
  /if \(\(status != 0\)\) && \[\[ \$\{cutover_started\} == true \]\]; then\s+rollback/
)

console.log("Deployment contract checks passed.")
