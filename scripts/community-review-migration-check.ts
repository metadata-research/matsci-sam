import "next/dist/server/node-environment"
import { readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { reviewFingerprints } from "./community-review-test-support"
async function main() {
  const path = process.argv[3]
  const data = await reviewFingerprints()
  if (process.argv[2] === "record")
    await writeFile(path, JSON.stringify(data), { mode: 0o600 })
  else {
    const before = JSON.parse(await readFile(path, "utf8"))
    for (const [name, value] of Object.entries(before))
      assert.deepEqual(data[name], value, `Existing table changed: ${name}`)
    console.log(
      `Preservation verified for ${Object.keys(before).length} existing tables`
    )
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
