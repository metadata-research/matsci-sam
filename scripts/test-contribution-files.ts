import assert from "node:assert/strict"
import {
  validateContributionFile,
  readContributionFileBody,
  readContributionUpload,
  safeContributionFilename,
  contributionFileDownloadHeaders
} from "../lib/contribution-file-validation"
import {
  CONTRIBUTION_FILE_MAX_BYTES,
  contributionFilePublicationsSchema
} from "../lib/contribution-file-types"

async function main() {
  const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF")
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const jpeg = Buffer.from([255, 216, 255, 224])
  assert.equal(
    validateContributionFile(pdf, "application/pdf"),
    "application/pdf"
  )
  assert.equal(validateContributionFile(png, "image/png"), "image/png")
  assert.equal(validateContributionFile(jpeg, "image/jpeg"), "image/jpeg")
  for (const [bytes, type] of [
    [pdf, "image/png"],
    [Buffer.from("<svg/>"), "image/svg+xml"],
    [Buffer.from("<script>"), "application/pdf"],
    [Buffer.alloc(0), "image/jpeg"]
  ] as const)
    assert.throws(() => validateContributionFile(bytes, type))
  assert.throws(() =>
    validateContributionFile(
      Buffer.alloc(CONTRIBUTION_FILE_MAX_BYTES + 1),
      "application/pdf"
    )
  )
  assert.deepEqual(
    await readContributionFileBody(
      new Request("http://localhost/", { method: "POST", body: pdf })
    ),
    pdf
  )
  await assert.rejects(
    readContributionFileBody(
      new Request("http://localhost/", {
        method: "POST",
        body: pdf,
        headers: { "Content-Length": String(CONTRIBUTION_FILE_MAX_BYTES + 1) }
      })
    )
  )
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(CONTRIBUTION_FILE_MAX_BYTES))
      controller.enqueue(new Uint8Array(1))
      controller.close()
    }
  })
  await assert.rejects(
    readContributionFileBody(
      new Request("http://localhost/", {
        method: "POST",
        body: stream,
        duplex: "half"
      } as RequestInit)
    )
  )
  const upload = new FormData()
  upload.set(
    "file",
    new Blob([pdf], { type: "application/pdf" }),
    "fixture.pdf"
  )
  const internationalMetadata = {
    term: "water",
    vocabularySlug: "matsci-sam",
    filename: "fixture.pdf",
    role: "source",
    title: "水",
    caption: "水".repeat(1800)
  }
  upload.set("metadata", JSON.stringify(internationalMetadata))
  const parsed = await readContributionUpload(
    new Request("http://localhost/", { method: "POST", body: upload })
  )
  assert.deepEqual(
    parsed.metadata,
    internationalMetadata,
    "Long valid multilingual metadata travels in the body, not request headers"
  )
  assert.deepEqual(parsed.bytes, pdf)
  upload.append(
    "file",
    new Blob([pdf], { type: "application/pdf" }),
    "extra.pdf"
  )
  await assert.rejects(
    readContributionUpload(
      new Request("http://localhost/", { method: "POST", body: upload })
    )
  )
  const headers = contributionFileDownloadHeaders(
    'a";\r\nBad: yes/🧪.pdf',
    "application/pdf",
    12
  )
  assert.ok(headers["Content-Disposition"].startsWith("attachment;"))
  assert.ok(!headers["Content-Disposition"].includes("\r"))
  assert.ok(!headers["Content-Disposition"].includes("\n"))
  assert.equal(headers["X-Content-Type-Options"], "nosniff")
  assert.equal(
    headers["Content-Security-Policy"],
    "sandbox; default-src 'none'"
  )
  assert.equal(safeContributionFilename("../a.pdf"), ".._a.pdf")
  assert.equal(
    contributionFilePublicationsSchema.safeParse([
      { fileId: crypto.randomUUID(), publish: false }
    ]).success,
    false
  )
  assert.equal(
    contributionFilePublicationsSchema.safeParse(
      Array.from({ length: 4 }, () => ({
        fileId: crypto.randomUUID(),
        publish: true
      }))
    ).success,
    false
  )
  console.log(
    "Contribution file validation passed: file signatures, declared types, actual byte limits, download headers, and explicit publication."
  )
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
