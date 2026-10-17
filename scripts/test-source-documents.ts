// Local parser/matcher checks only; no database, browser or provider requests.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import childProcess from "node:child_process"
import { syncBuiltinESMExports } from "node:module"
import { mock } from "node:test"
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { deflateSync } from "node:zlib"
import {
  extractSourceDocument,
  parseOcrTsv,
  SourceDocumentError
} from "../lib/source-document-extraction"
import { checkSourceDocument } from "../lib/source-document-matching"
import {
  sourceSelectionText,
  type SourceExtractionResult
} from "../lib/source-document-types"

const execute = promisify(execFile)
const docxType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const utf8 = (text: string) => new TextEncoder().encode(text)

/** A tiny PDF writer for deterministic embedded-text and scanned-page fixtures. */
function pdfFixture(
  pages: Array<{
    text?: string
    raster?: { width: number; height: number; bytes: Buffer }
  }>
) {
  const objects: Buffer[] = []
  const add = (value: string | Buffer) => {
    objects.push(typeof value === "string" ? Buffer.from(value) : value)
    return objects.length
  }
  add("<< /Type /Catalog /Pages 2 0 R >>")
  add("")
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  const pageIds: number[] = []
  for (const page of pages) {
    let content = ""
    let image = 0
    if (page.raster) {
      const compressed = deflateSync(page.raster.bytes)
      image = add(
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width ${page.raster.width} /Height ${page.raster.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`
          ),
          compressed,
          Buffer.from("\nendstream")
        ])
      )
      content += "q 612 0 0 792 0 0 cm /Im1 Do Q\n"
    }
    if (page.text) {
      const chunks = page.text.split("\n")
      content += `BT /F1 22 Tf 40 ${page.raster ? 770 : 720} Td `
      for (const [index, text] of chunks.entries()) {
        if (index) content += "0 -38 Td "
        content += `(${text.replace(/[()\\]/g, "\\$&")}) Tj `
      }
      content += "ET\n"
    }
    const stream = add(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`
    )
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> ${image ? `/XObject << /Im1 ${image} 0 R >>` : ""} >> /Contents ${stream} 0 R >>`
      )
    )
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`
  )
  const buffers = [Buffer.from("%PDF-1.4\n")]
  const offsets = [0]
  let offset = buffers[0].length
  for (const [index, object] of objects.entries()) {
    offsets.push(offset)
    const encoded = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n")
    ])
    buffers.push(encoded)
    offset += encoded.length
  }
  buffers.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          ""
        )}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${offset}\n%%EOF\n`
    )
  )
  return Buffer.concat(buffers)
}

async function rejects(bytes: Uint8Array, mediaType: string, code: string) {
  await assert.rejects(
    extractSourceDocument({ bytes, mediaType }),
    (error: unknown) =>
      error instanceof SourceDocumentError && error.code === code
  )
}

function verifyLocations(result: SourceExtractionResult) {
  assert.match(result.textHash, /^[a-f0-9]{64}$/)
  let end = 0
  for (const page of result.pages) {
    assert(page.start >= end)
    assert(page.end >= page.start && page.end <= result.text.length)
    end = page.end
  }
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "matsci-source-test-"))
  try {
    const text =
      "A GRAIN\n\tBOUNDARY separates grains.\r\n\r\nThermo\u00ad\nmechanical behavior and α-phase are relevant.\nMicrograin boundary, grain boundaries and α-phases are different strings.\nAn explicit alias, GB, is accepted. Café and 𐐀phase show Unicode boundaries."
    const extracted = await extractSourceDocument({
      bytes: utf8(text),
      mediaType: "text/plain"
    })
    verifyLocations(extracted)
    assert(!extracted.text.includes("\r"))
    const checked = checkSourceDocument({
      ...extracted,
      term: "grain boundary",
      aliases: ["GB", " Grain Boundary "]
    })
    assert.equal(checked.matches.length, 2)
    assert.equal(checked.matches[0].text, "GRAIN\n\tBOUNDARY")
    assert.equal(checked.matches[1].matchedTerm, "GB")
    assert.equal(checked.matches[1].isAlias, true)
    for (const match of checked.matches)
      assert.equal(extracted.text.slice(match.start, match.end), match.text)
    assert.deepEqual(
      checkSourceDocument({
        ...extracted,
        term: "grain boundary",
        aliases: ["GB"]
      }).matches,
      checked.matches
    )
    const soft = checkSourceDocument({ ...extracted, term: "thermomechanical" })
    assert.equal(soft.matches[0].text, "Thermo\u00ad\nmechanical")
    const spacedSoft = await extractSourceDocument({
      bytes: utf8("A grain\u00ad boundary retains its ordinary word space."),
      mediaType: "text/plain"
    })
    assert.equal(
      checkSourceDocument({ ...spacedSoft, term: "grain boundary" }).matches
        .length,
      1
    )
    assert.equal(
      checkSourceDocument({ ...spacedSoft, term: "grainboundary" }).matches
        .length,
      0
    )
    assert.equal(
      checkSourceDocument({ ...extracted, term: "α-phase" }).matches.length,
      1
    )
    assert.equal(
      checkSourceDocument({ ...extracted, term: "phase" }).matches.length,
      1,
      "Astral letters must participate in word boundaries"
    )
    assert.equal(
      checkSourceDocument({ ...extracted, term: "CAFE\u0301" }).matches[0].text,
      "Café"
    )
    assert.equal(
      checkSourceDocument({ ...extracted, term: "not present" }).matches.length,
      0
    )
    const punctuated = await extractSourceDocument({
      bytes: utf8("A grain-\nboundary is not normalized to a space."),
      mediaType: "text/plain"
    })
    assert.equal(
      checkSourceDocument({ ...punctuated, term: "grain boundary" }).matches
        .length,
      0
    )
    const chosen = checked.passages.filter((passage) => passage.matchIds.length)
    assert.equal(
      sourceSelectionText(extracted.text, checked.passages, {
        mode: "passages",
        passageIds: chosen.map((passage) => passage.id)
      }),
      chosen.map((passage) => passage.text).join("\n\n")
    )
    assert.equal(
      sourceSelectionText(extracted.text, [], { mode: "full", passageIds: [] }),
      extracted.text
    )
    assert.throws(() =>
      sourceSelectionText(extracted.text, [], {
        mode: "passages",
        passageIds: ["forged"]
      })
    )
    await rejects(new Uint8Array([0xff]), "text/plain", "invalid_utf8")
    await rejects(utf8("\u0000binary"), "text/plain", "invalid_text")
    await rejects(utf8("   \n"), "text/plain", "unreadable_text")
    await rejects(utf8("x".repeat(200001)), "text/plain", "text_limit")
    await rejects(
      new Uint8Array(5 * 1024 * 1024 + 1),
      "text/plain",
      "file_limit"
    )
    await rejects(utf8("not a pdf"), "application/pdf", "invalid_document")
    await rejects(
      pdfFixture(Array.from({ length: 51 }, () => ({ text: "A page." }))),
      "application/pdf",
      "page_limit"
    )
    let ghostscriptAvailable = true
    try {
      await access("/usr/bin/gs")
    } catch {
      ghostscriptAvailable = false
    }
    if (ghostscriptAvailable) {
      const plainPath = join(directory, "encryption-input.pdf")
      const protectedPath = join(directory, "encrypted.pdf")
      await writeFile(
        plainPath,
        pdfFixture([{ text: "Protected fixture text." }])
      )
      await execute(
        "/usr/bin/gs",
        [
          "-q",
          "-dSAFER",
          "-dBATCH",
          "-dNOPAUSE",
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.4",
          "-dEncryptionR=3",
          "-dKeyLength=128",
          "-dPermissions=-4",
          "-sOwnerPassword=fixture-owner",
          "-sUserPassword=fixture-reader",
          `-sOutputFile=${protectedPath}`,
          plainPath
        ],
        { timeout: 10000, maxBuffer: 8192 }
      )
      await rejects(
        await readFile(protectedPath),
        "application/pdf",
        "password_protected"
      )
      console.log("PASS real encrypted PDF rejection")
    } else console.log("SKIP encrypted PDF fixture: Ghostscript unavailable")

    const long = await extractSourceDocument({
      bytes: utf8(
        `${"Unrelated paragraph. ".repeat(450)}\n\nA grain boundary separates grains.\n\n${"More context. ".repeat(450)}`
      ),
      mediaType: "text/plain"
    })
    const longCheck = checkSourceDocument({ ...long, term: "grain boundary" })
    assert(longCheck.passages.length > 2)
    const matchedPassages = longCheck.passages.filter(
      (passage) => passage.matchIds.length
    )
    assert.equal(matchedPassages.length, 1)
    assert(matchedPassages[0].text.length < 1600)
    for (let index = 1; index < longCheck.passages.length; index++)
      assert(
        longCheck.passages[index].start >= longCheck.passages[index - 1].end
      )
    const boundaryText = `${"Background measurement notes. ".repeat(42)}\n\nA grain boundary separates grains.\n\n${"Instrument settings are recorded separately. ".repeat(60)}`
    const boundarySource = await extractSourceDocument({
      bytes: utf8(boundaryText),
      mediaType: "text/plain"
    })
    const boundaryCheck = checkSourceDocument({
      ...boundarySource,
      term: "grain boundary"
    })
    assert.equal(
      boundaryCheck.passages.map((p) => p.text).join(""),
      boundaryText
    )
    for (const passage of boundaryCheck.passages) {
      assert.equal(
        /[\p{L}\p{N}\p{M}]$/u.test(boundaryText.slice(0, passage.start)) &&
          /^[\p{L}\p{N}\p{M}]/u.test(passage.text),
        false,
        "A selected passage must not start inside a word"
      )
    }

    const pdf = await extractSourceDocument({
      bytes: pdfFixture([
        {
          text: "A grain boundary separates neighboring grains.\nThis embedded PDF has an independently readable body."
        }
      ]),
      mediaType: "application/pdf"
    })
    verifyLocations(pdf)
    assert.equal(pdf.hasOcr, false)
    assert.equal(pdf.pages[0].page, 1)
    assert.equal(
      checkSourceDocument({ ...pdf, term: "grain boundary" }).matches.length,
      1
    )

    await execute(
      "/usr/bin/python3",
      [
        "-c",
        `
import sys, zipfile, os
root = sys.argv[1]
ct = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
body = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A grain boundary separates grains.</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p></w:body></w:document>'
def make(name, text=body, extra=None):
 with zipfile.ZipFile(os.path.join(root,name), 'w', zipfile.ZIP_DEFLATED) as f:
  f.writestr('[Content_Types].xml', ct)
  f.writestr('_rels/.rels', '<Relationships/>')
  f.writestr('word/document.xml', text)
  if extra: f.writestr(*extra)
make('valid.docx')
make('doctype.docx', '<!DOCTYPE doc [<!ENTITY unsafe "private">]>' + body)
make('bomb.docx', extra=('large.bin', 'a'*2000000))
make('path.docx', extra=('../outside', 'no'))
`,
        directory
      ],
      { timeout: 10000, maxBuffer: 8192 }
    )
    const docx = await extractSourceDocument({
      bytes: await readFile(join(directory, "valid.docx")),
      mediaType: docxType
    })
    verifyLocations(docx)
    assert.equal(docx.pages.length, 2)
    // Exercise the real extraction error boundary without exhausting host tasks.
    for (const code of ["EAGAIN", "EMFILE", "ENOMEM"]) {
      const mocked = mock.method(childProcess, "execFile", ((
        ...args: unknown[]
      ) => {
        const callback = args.at(-1) as (
          error: Error & { code: string },
          stdout: Buffer,
          stderr: Buffer
        ) => void
        queueMicrotask(() =>
          callback(
            Object.assign(new Error("Private processor diagnostic"), { code }),
            Buffer.alloc(0),
            Buffer.from("Private source content")
          )
        )
      }) as typeof childProcess.execFile)
      syncBuiltinESMExports()
      try {
        await rejects(
          await readFile(join(directory, "valid.docx")),
          docxType,
          "unavailable"
        )
      } finally {
        mocked.mock.restore()
        syncBuiltinESMExports()
      }
    }
    assert.equal(docx.pages[0].page, null)
    assert.equal(docx.pages[0].method, "docx")
    assert.equal(
      checkSourceDocument({ ...docx, term: "grain boundary" }).matches.length,
      1
    )
    await rejects(
      await readFile(join(directory, "doctype.docx")),
      docxType,
      "invalid_docx"
    )
    await rejects(
      await readFile(join(directory, "bomb.docx")),
      docxType,
      "archive_limit"
    )
    await rejects(
      await readFile(join(directory, "path.docx")),
      docxType,
      "archive_limit"
    )
    await rejects(utf8("fake docx"), docxType, "invalid_docx")
    const slowParser = join(directory, "slow-parser.py")
    const slowPid = join(directory, "slow-parser.pid")
    await writeFile(
      slowParser,
      `#!/usr/bin/python3\nimport os, pathlib, time\npathlib.Path(${JSON.stringify(slowPid)}).write_text(str(os.getpid()))\ntime.sleep(60)\n`,
      { mode: 0o700 }
    )
    const originalPython = process.env.SOURCE_PYTHON_BIN
    try {
      process.env.SOURCE_PYTHON_BIN = slowParser
      await rejects(
        await readFile(join(directory, "valid.docx")),
        docxType,
        "timeout"
      )
      const pid = Number(await readFile(slowPid, "utf8"))
      assert(Number.isSafeInteger(pid) && pid > 0)
      assert.throws(
        () => process.kill(pid, 0),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH",
        "A timed-out parser must be terminated"
      )
      console.log("PASS parser deadline and child termination")
      await writeFile(
        slowParser,
        "#!/usr/bin/python3\nimport sys\nsys.stdout.write('x' * 1700000)\n",
        { mode: 0o700 }
      )
      await rejects(
        await readFile(join(directory, "valid.docx")),
        docxType,
        "text_limit"
      )
      console.log("PASS bounded parser output classification")
    } finally {
      if (originalPython === undefined) delete process.env.SOURCE_PYTHON_BIN
      else process.env.SOURCE_PYTHON_BIN = originalPython
    }
    const ocr = parseOcrTsv(
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t20\t10\t80\tgrain\n5\t1\t1\t1\t1\t2\t20\t0\t20\t10\t90\tboundary\n"
    )
    assert.equal(ocr.text, "grain boundary")
    assert(
      ocr.confidence !== null && ocr.confidence > 80 && ocr.confidence < 90
    )

    const binary = process.env.SOURCE_TESSERACT_BIN || "/usr/bin/tesseract"
    let available = true
    try {
      await access(binary)
    } catch {
      available = false
    }
    if (available) {
      const rasterSource = join(directory, "raster-source.pdf")
      await writeFile(
        rasterSource,
        pdfFixture([
          {
            text: "Silicon grain boundary\nA boundary separates neighboring grains.\nThis is a scanned source for OCR verification."
          }
        ])
      )
      const prefix = join(directory, "scan")
      await execute(
        "/usr/bin/pdftoppm",
        ["-singlefile", "-r", "100", rasterSource, prefix],
        { timeout: 10000, maxBuffer: 8192 }
      )
      const ppm = await readFile(`${prefix}.ppm`)
      const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(
        ppm.subarray(0, 100).toString("ascii")
      )
      assert(header)
      const raster = {
        width: Number(header[1]),
        height: Number(header[2]),
        bytes: ppm.subarray(header[0].length)
      }
      assert.equal(raster.bytes.length, raster.width * raster.height * 3)
      const scanned = await extractSourceDocument({
        bytes: pdfFixture([{ raster }]),
        mediaType: "application/pdf"
      })
      verifyLocations(scanned)
      assert.equal(scanned.hasOcr, true)
      assert.match(scanned.parserVersion, /tesseract:.*lang:eng/)
      assert.equal(
        checkSourceDocument({ ...scanned, term: "grain boundary" }).matches
          .length,
        1
      )
      const mixed = await extractSourceDocument({
        bytes: pdfFixture([
          {
            text: "A fully embedded page remains available.\nA grain boundary can be defined from this text."
          },
          { raster, text: "Heading" }
        ]),
        mediaType: "application/pdf"
      })
      verifyLocations(mixed)
      assert.deepEqual(
        mixed.pages.map((page) => page.method),
        ["embedded", "ocr"]
      )
      assert.equal(
        checkSourceDocument({ ...mixed, term: "grain boundary" }).matches
          .length,
        2
      )
      console.log(
        "PASS real scanned and mixed PDF OCR, including image body below embedded heading"
      )
    } else
      console.log(
        "SKIP real OCR: Tesseract unavailable; set SOURCE_TESSERACT_BIN and language data"
      )
    console.log(
      "PASS source UTF-8, embedded PDF, DOCX, archive limits, page/text bounds, Unicode term/alias spans, stable passages, context assembly and OCR TSV"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
