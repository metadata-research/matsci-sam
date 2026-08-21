/*
 * The drizzle journal must be strictly increasing in `when`.
 *
 * drizzle-kit applies only migrations whose `when` exceeds the last applied
 * one, so an entry stamped below its predecessor is skipped in silence while
 * `db:migrate` still reports success. That has happened twice here, both times
 * from a hand-written timestamp set ahead of the real clock, and it would skip
 * migrations on a release host exactly as readily as on a workstation.
 *
 * Run as: tsx scripts/test-migration-journal.ts
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

type Entry = { idx: number; when: number; tag: string }

const journal = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "drizzle", "migrations", "meta", "_journal.json"),
    "utf8"
  )
) as { entries: Entry[] }

const entries = journal.entries
assert.ok(entries.length > 0, "journal has entries")

for (let i = 1; i < entries.length; i++) {
  const previous = entries[i - 1]
  const current = entries[i]

  assert.equal(current.idx, previous.idx + 1, `idx gap before ${current.tag}`)
  assert.ok(
    current.when > previous.when,
    `${current.tag} is stamped ${current.when}, at or below ${previous.tag} ` +
      `at ${previous.when}. drizzle-kit would skip it without reporting a ` +
      `failure. Raise the later entry above the earlier one.`
  )
}

// A tag must name a file that exists, or the migration is unrunnable.
for (const entry of entries) {
  const file = path.join(
    process.cwd(),
    "drizzle",
    "migrations",
    `${entry.tag}.sql`
  )
  assert.ok(readFileSync(file, "utf8").length > 0, `${entry.tag}.sql is empty`)
}

console.log(`Migration journal tests passed (${entries.length} entries)`)
