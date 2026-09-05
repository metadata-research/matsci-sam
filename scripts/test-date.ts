import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"

// A server in UTC and a browser elsewhere must produce identical first renders.
const check = `
  const { formatDate, formatDateTime } = require("./lib/date.ts")
  console.log(JSON.stringify([
    formatDate("2026-09-05T00:30:00Z"),
    formatDate("2026-09-05"),
    formatDateTime("2025-10-20 20:39:00+00"),
    formatDateTime("2026-03-08T01:30:00-05:00"),
    formatDateTime("2026-09-05 00:30:00.123456"),
    formatDateTime("2026-09-05T00:30:00"),
    formatDateTime(new Date("2026-09-05T00:30:00Z")),
    formatDateTime(Date.parse("2026-09-05T00:30:00Z"))
  ]))
`

for (const timeZone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
  const result = spawnSync(process.execPath, [...process.execArgv, "-e", check], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: timeZone },
    encoding: "utf8"
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    JSON.parse(result.stdout),
    [
      "Sep 5, 2026",
      "Sep 5, 2026",
      "Oct 20, 2025 at 8:39 PM UTC",
      "Mar 8, 2026 at 6:30 AM UTC",
      "Sep 5, 2026 at 12:30 AM UTC",
      "Sep 5, 2026 at 12:30 AM UTC",
      "Sep 5, 2026 at 12:30 AM UTC",
      "Sep 5, 2026 at 12:30 AM UTC"
    ],
    `Date rendering differs in ${timeZone}`
  )
}

console.log("Date rendering is consistent in UTC, New York, and Tokyo.")
