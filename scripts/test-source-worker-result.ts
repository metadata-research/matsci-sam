// Real parser results, without a database, service manager or provider calls.
import assert from "node:assert/strict"
import { sourceDocumentWorkerResult } from "./source-document-worker-result"

async function main() {
  for (const file of [
    undefined,
    { bytes: null, mediaType: "text/plain" },
    { bytes: new Uint8Array(), mediaType: "text/plain" }
  ]) {
    const result = await sourceDocumentWorkerResult(file, false)
    assert.equal(result.update.status, "failed")
    assert.equal(result.event.category, "missing_source")
    assert.match(
      result.update.error ?? "",
      /original source file is unavailable/
    )
    assert(Number.isFinite(Date.parse(result.update.completedAt)))
    assert.equal("text" in result.update, false)
  }
  const ready = await sourceDocumentWorkerResult(
    {
      bytes: Buffer.from("Ionic conductivity is a transport property."),
      mediaType: "text/plain"
    },
    false
  )
  assert.equal(ready.update.status, "ready")
  assert.equal(ready.update.text, "Ionic conductivity is a transport property.")
  assert.equal(ready.event.event, "source_ready")
  const failed = await sourceDocumentWorkerResult(
    { bytes: Buffer.from([0xff, 0xfe, 0x00, 0xff]), mediaType: "text/plain" },
    false
  )
  assert.equal(failed.update.status, "failed")
  assert.equal(failed.event.event, "source_failed")
  assert(failed.update.error)
  console.log(
    "Source worker terminal results: missing bytes, readable text and parser failure passed."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
