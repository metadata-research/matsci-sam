// Offline checks only: no host unit installation, service manager, DB or provider.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile
} from "node:fs/promises"
import { constants } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)
const serviceName = "matsci-sam-source-worker.service"
async function main() {
  const source = await readFile(
    new URL(`../ops/${serviceName}`, import.meta.url),
    "utf8"
  )
  const sections = new Map<string, Map<string, string[]>>()
  let section = ""
  for (const raw of source.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1)
      sections.set(section, new Map())
      continue
    }
    const separator = line.indexOf("=")
    assert(
      separator > 0 && sections.has(section),
      `Unexpected unit line: ${line}`
    )
    const key = line.slice(0, separator)
    const values = sections.get(section)!.get(key) ?? []
    values.push(line.slice(separator + 1))
    sections.get(section)!.set(key, values)
  }
  const values = (group: string, key: string) =>
    sections.get(group)?.get(key) ?? []
  const words = (group: string, key: string) =>
    values(group, key).flatMap((value) => value.split(/\s+/u))
  const one = (group: string, key: string) => {
    assert.equal(
      values(group, key).length,
      1,
      `${group}.${key} must be set once`
    )
    return values(group, key)[0]
  }

  assert(
    words("Unit", "PartOf").includes("matsci-sam.service"),
    "Application restart/stop must propagate to the worker"
  )
  assert(
    words("Unit", "BindsTo").includes("matsci-sam.service"),
    "Worker must not outlive an inactive application"
  )
  assert(
    words("Unit", "After").includes("matsci-sam.service"),
    "Stop ordering must drain the worker before the application stop completes"
  )
  assert(words("Unit", "After").includes("postgresql.service"))
  assert.equal(
    one("Unit", "ConditionPathExists"),
    "/opt/matsci-sam/current/scripts/source-document-worker.ts",
    "Older rollback releases must skip a missing worker"
  )
  assert.deepEqual(
    words("Install", "WantedBy"),
    ["matsci-sam.service"],
    "Application lifecycle must own worker activation"
  )
  assert.equal(one("Service", "WorkingDirectory"), "/opt/matsci-sam/current")
  assert.equal(
    one("Service", "ExecStart"),
    "/usr/bin/node --import tsx scripts/source-document-worker.ts"
  )
  assert.equal(one("Service", "EnvironmentFile"), "/etc/matsci-sam/app.env")
  assert.equal(
    one("Service", "KillMode"),
    "mixed",
    "Initial SIGTERM must let the current parser finish; the final kill must cover its cgroup"
  )
  assert(
    Number(one("Service", "TimeoutStopSec")) > 120,
    "Graceful stop must allow the bounded document operation to finish"
  )
  assert.equal(one("Service", "Restart"), "on-failure")
  assert.equal(one("Service", "CPUQuota"), "100%")
  assert.equal(one("Service", "MemoryMax"), "512M")
  assert.equal(one("Service", "MemorySwapMax"), "0")
  assert.equal(one("Service", "TasksMax"), "32")
  for (const entry of [
    "NODE_OPTIONS=--max-old-space-size=192",
    "OMP_THREAD_LIMIT=1",
    "UV_THREADPOOL_SIZE=2",
    "GOMAXPROCS=2",
    "RAYON_NUM_THREADS=2",
    "TOKIO_WORKER_THREADS=2"
  ])
    assert(
      values("Service", "Environment").includes(entry),
      `Missing thread/heap bound: ${entry}`
    )

  const available = async (path: string) =>
    access(path, constants.X_OK).then(
      () => true,
      () => false
    )
  if (
    process.platform === "linux" &&
    (await available("/usr/bin/systemd-analyze")) &&
    (await available("/usr/bin/systemctl"))
  ) {
    const root = await mkdtemp(join(tmpdir(), "matsci-worker-unit-test-"))
    try {
      const units = join(root, "etc/systemd/system")
      await mkdir(units, { recursive: true })
      await mkdir(join(root, "usr/bin"), { recursive: true })
      await writeFile(join(units, serviceName), source)
      // The offline analyzer checks executable presence but never executes it.
      for (const binary of ["node", "true"]) {
        const path = join(root, "usr/bin", binary)
        await writeFile(path, "#!/bin/sh\nexit 0\n")
        await chmod(path, 0o755)
      }
      for (const dependency of ["matsci-sam.service", "postgresql.service"]) {
        await writeFile(
          join(units, dependency),
          "[Unit]\nDescription=Offline dependency fixture\nDefaultDependencies=no\n[Service]\nExecStart=/usr/bin/true\n"
        )
      }
      for (const target of [
        "sysinit.target",
        "basic.target",
        "shutdown.target"
      ]) {
        await writeFile(
          join(units, target),
          "[Unit]\nDescription=Offline target fixture\nDefaultDependencies=no\n"
        )
      }
      await execute(
        "/usr/bin/systemctl",
        ["--root", root, "--no-reload", "enable", serviceName],
        { timeout: 10000 }
      )
      const link = await readlink(
        join(units, "matsci-sam.service.wants", serviceName)
      )
      assert.equal(link, `/etc/systemd/system/${serviceName}`)
      await assert.rejects(
        access(join(units, "multi-user.target.wants", serviceName))
      )
      await execute(
        "/usr/bin/systemd-analyze",
        [
          "--root",
          root,
          "--man=no",
          "verify",
          serviceName,
          "matsci-sam.service"
        ],
        { timeout: 10000 }
      )
      console.log(
        "Source worker unit: systemd offline verification and application-owned enablement passed."
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  } else {
    console.log(
      "SKIP systemd offline verification: systemd tools are unavailable on this platform."
    )
  }
  console.log(
    "Source worker unit: release/rollback lifecycle, bounded graceful stop and resource controls passed."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
