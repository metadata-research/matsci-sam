import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = process.cwd()

const read = (path: string) => readFileSync(resolve(root, path), "utf8")

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

console.log("Deployment contract checks passed.")
