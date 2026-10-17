// Worker-only module: document parsers never run in a Next request handler.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  SOURCE_MAX_BYTES,
  SOURCE_MAX_CHARACTERS,
  SOURCE_MAX_PAGES,
  SOURCE_PARSER_VERSION,
  type SourceExtractionResult,
  type SourceMethod,
  type SourcePage
} from "./source-document-types"

export const SOURCE_DOCUMENT_TIMEOUT_MS = 120000
export const SOURCE_OCR_PAGE_TIMEOUT_MS = 30000
export const SOURCE_OCR_MAX_DIMENSION = 2400
export const SOURCE_OCR_LANGUAGE = "eng"

export class SourceDocumentError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "SourceDocumentError"
  }
}

const failure = (code: string, message: string): never => {
  throw new SourceDocumentError(code, message)
}
const textHash = (text: string) =>
  createHash("sha256").update(text).digest("hex")
const lines = (text: string) => text.replace(/\r\n?/g, "\n")
const decoder = () => new TextDecoder("utf-8", { fatal: true })

function checkedText(text: string) {
  if (text.length > SOURCE_MAX_CHARACTERS)
    failure(
      "text_limit",
      "This source exceeds the 200,000-character text limit."
    )
  if (!text.trim())
    failure(
      "unreadable_text",
      "We couldn't read text from this source. Try a clearer file or paste its text."
    )
  return text
}

type CommandResult = { stdout: Buffer; stderr: Buffer }
function run(
  binary: string,
  args: string[],
  deadline: number,
  timeoutMs: number,
  maximumBytes = 1024 * 1024
): Promise<CommandResult> {
  const remaining = deadline - performance.now()
  if (remaining <= 0)
    failure(
      "timeout",
      "Source processing exceeded its two-minute limit. Try a shorter document."
    )
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        encoding: "buffer",
        timeout: Math.max(1, Math.floor(Math.min(remaining, timeoutMs))),
        killSignal: "SIGKILL",
        maxBuffer: maximumBytes,
        windowsHide: true,
        env: {
          ...process.env,
          LC_ALL: "C.UTF-8",
          OMP_THREAD_LIMIT: "1",
          OMP_NUM_THREADS: "1",
          OPENBLAS_NUM_THREADS: "1"
        }
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr })
        if (
          ["ENOENT", "EACCES", "EAGAIN", "EMFILE", "ENFILE", "ENOMEM"].includes(
            String(error.code)
          )
        )
          return reject(
            new SourceDocumentError(
              "unavailable",
              "Source processing is unavailable on this server. Your file is saved; try again later."
            )
          )
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
          return reject(
            new SourceDocumentError(
              "text_limit",
              "This source exceeds the processing output limit. Try a shorter document."
            )
          )
        if (error.killed || error.signal === "SIGKILL")
          return reject(
            new SourceDocumentError(
              "timeout",
              "Source processing reached its time limit. Try a shorter document or a clearer scan."
            )
          )
        // stderr remains local to this boundary; never store document-directed
        // parser diagnostics, file paths or subprocess exception messages.
        const message = stderr.toString("utf8")
        const password = /password|encrypted/i.test(message)
        reject(
          new SourceDocumentError(
            password ? "password_protected" : "invalid_document",
            password
              ? "This document is password protected. Upload an unprotected copy or paste its text."
              : "This document could not be processed. Try another copy or paste its text."
          )
        )
      }
    )
  })
}

function joinParts(
  parts: Array<{
    text: string
    page: number | null
    method: SourceMethod
    label: string
    confidence?: number | null
  }>,
  parserVersion: string
): SourceExtractionResult {
  let text = ""
  const pages: SourcePage[] = []
  for (const part of parts) {
    if (text) text += "\n\n"
    const start = text.length
    text += lines(part.text)
    if (text.length > SOURCE_MAX_CHARACTERS)
      failure(
        "text_limit",
        "This source exceeds the 200,000-character text limit."
      )
    pages.push({
      page: part.page,
      start,
      end: text.length,
      method: part.method,
      label: part.label,
      confidence: part.confidence ?? null
    })
  }
  checkedText(text)
  const methods = [...new Set(parts.map((part) => part.method))]
  return {
    text,
    textHash: textHash(text),
    pages,
    hasOcr: methods.includes("ocr"),
    method: methods.join("+"),
    parserVersion
  }
}

/** Tesseract TSV's page/block/paragraph/line fields reconstruct readable text. */
export function parseOcrTsv(tsv: string) {
  const output: string[] = []
  let lineKey = ""
  let paragraphKey = ""
  let line: string[] = []
  let confidenceSum = 0
  let confidenceWeight = 0
  for (const raw of lines(tsv).split("\n").slice(1)) {
    const cells = raw.split("\t")
    if (cells.length < 12 || cells[0] !== "5") continue
    const word = cells.slice(11).join("\t").trim()
    if (!word) continue
    const nextParagraph = cells.slice(1, 4).join(":")
    const nextLine = cells.slice(1, 5).join(":")
    if (nextLine !== lineKey && line.length) {
      output.push(line.join(" "))
      if (nextParagraph !== paragraphKey) output.push("")
      line = []
    }
    lineKey = nextLine
    paragraphKey = nextParagraph
    line.push(word)
    const confidence = Number(cells[10])
    if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 100) {
      confidenceSum += confidence * word.length
      confidenceWeight += word.length
    }
  }
  if (line.length) output.push(line.join(" "))
  return {
    text: output.join("\n"),
    confidence: confidenceWeight
      ? Math.round((confidenceSum / confidenceWeight) * 100) / 100
      : null
  }
}

/** No network access or shell expansion. Invoke once per bounded queue job. */
export async function extractSourceDocument({
  bytes,
  mediaType,
  forceOcr = false
}: {
  bytes: Uint8Array
  mediaType: string
  forceOcr?: boolean
}): Promise<SourceExtractionResult> {
  if (!bytes.length || bytes.length > SOURCE_MAX_BYTES)
    failure("file_limit", "Choose a source between 1 byte and 5 MB.")
  if (mediaType === "text/plain") {
    let text: string
    try {
      text = lines(decoder().decode(bytes))
    } catch {
      return failure(
        "invalid_utf8",
        "This text file is not valid UTF-8. Save it as UTF-8 or paste its text."
      )
    }
    if (/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(text))
      failure(
        "invalid_text",
        "This file contains binary data rather than plain text."
      )
    return joinParts(
      [{ text, page: null, method: "text", label: "Text" }],
      `${SOURCE_PARSER_VERSION}; utf8-v1`
    )
  }
  const pdf = mediaType === "application/pdf"
  const docx =
    mediaType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (!pdf && !docx)
    failure("unsupported_type", "Choose a PDF, DOCX or UTF-8 text source.")
  if (pdf && Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-")
    failure("invalid_document", "This file is not a readable PDF.")
  const deadline = performance.now() + SOURCE_DOCUMENT_TIMEOUT_MS
  const directory = await mkdtemp(join(tmpdir(), "matsci-source-"))
  await chmod(directory, 0o700)
  try {
    const input = join(directory, pdf ? "source.pdf" : "source.docx")
    await writeFile(input, bytes, { mode: 0o600 })
    if (docx) {
      let result: CommandResult
      try {
        result = await run(
          process.env.SOURCE_PYTHON_BIN || "/usr/bin/python3",
          [
            fileURLToPath(
              new URL("../scripts/extract-docx.py", import.meta.url)
            ),
            input
          ],
          deadline,
          15000,
          SOURCE_MAX_CHARACTERS * 8
        )
      } catch (error) {
        if (
          error instanceof SourceDocumentError &&
          error.code === "invalid_document"
        )
          return failure(
            "invalid_docx",
            "This DOCX could not be read within the document limits. Try a smaller unprotected copy or paste its text."
          )
        throw error
      }
      const parsed = JSON.parse(result.stdout.toString("utf8")) as {
        error?: string
        paragraphs?: Array<{ text: string; part: string }>
        pythonVersion?: string
      }
      if (parsed.error === "text_limit")
        failure(
          "text_limit",
          "This source exceeds the 200,000-character text limit."
        )
      if (parsed.error === "archive_limit")
        failure(
          "archive_limit",
          "This DOCX exceeds the compressed-document limits. Try a smaller copy or paste its text."
        )
      if (!parsed.paragraphs || parsed.error)
        return failure(
          "invalid_docx",
          "This DOCX could not be read. Try another unprotected copy or paste its text."
        )
      return joinParts(
        parsed.paragraphs.map((paragraph, index) => ({
          text: paragraph.text,
          page: null,
          method: "docx",
          label: `${paragraph.part.replace(/^word\//, "").replace(/\.xml$/, "")} paragraph ${index + 1}`
        })),
        `${SOURCE_PARSER_VERSION}; python-stdlib-docx-v1; python:${/^[0-9.]+$/.test(parsed.pythonVersion ?? "") ? parsed.pythonVersion : "unknown"}`
      )
    }
    const info = await run("/usr/bin/pdfinfo", [input], deadline, 10000)
    const infoText = info.stdout.toString("utf8")
    const count = Number(/^Pages:\s+(\d+)\s*$/m.exec(infoText)?.[1])
    if (!Number.isSafeInteger(count) || count < 1)
      failure("invalid_document", "This PDF's page count could not be read.")
    if (count > SOURCE_MAX_PAGES)
      failure(
        "page_limit",
        "This PDF exceeds the 50-page limit. Upload a shorter document."
      )
    if (/^Encrypted:\s+yes/m.test(infoText))
      failure(
        "password_protected",
        "This PDF is encrypted. Upload an unprotected copy or paste its text."
      )
    const [embedded, imageList, version] = await Promise.all([
      run(
        "/usr/bin/pdftotext",
        ["-layout", "-enc", "UTF-8", input, "-"],
        deadline,
        20000,
        SOURCE_MAX_CHARACTERS * 4 + 4096
      ),
      run("/usr/bin/pdfimages", ["-list", input], deadline, 10000),
      run("/usr/bin/pdftotext", ["-v"], deadline, 5000, 4096)
    ])
    const embeddedPages = lines(embedded.stdout.toString("utf8")).split("\f")
    if (!embeddedPages.at(-1)?.trim()) embeddedPages.pop()
    if (embeddedPages.length !== count)
      failure(
        "invalid_document",
        "This PDF's text could not be mapped to its pages. Try another copy or OCR retry."
      )
    if (embeddedPages.join("").length > SOURCE_MAX_CHARACTERS)
      failure(
        "text_limit",
        "This source exceeds the 200,000-character text limit."
      )
    const imageAreas = new Map<number, number>()
    for (const row of imageList.stdout.toString("utf8").split("\n")) {
      const fields = row.trim().split(/\s+/)
      if (!/^\d+$/.test(fields[0] ?? "") || fields[2] !== "image") continue
      const [page, width, height, xPpi, yPpi] = [
        fields[0],
        fields[3],
        fields[4],
        fields[12],
        fields[13]
      ].map(Number)
      if (width > 0 && height > 0 && xPpi > 0 && yPpi > 0)
        imageAreas.set(
          page,
          (imageAreas.get(page) ?? 0) +
            (width / xPpi) * 72 * ((height / yPpi) * 72)
        )
      else imageAreas.set(page, Infinity)
    }
    const pageSizes = new Map<number, number>()
    const dimensions = await run(
      "/usr/bin/pdfinfo",
      ["-f", "1", "-l", String(count), input],
      deadline,
      10000
    )
    for (const row of dimensions.stdout.toString("utf8").split("\n")) {
      const match = /^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/.exec(row)
      if (match)
        pageSizes.set(Number(match[1]), Number(match[2]) * Number(match[3]))
    }
    let tesseractVersion: string | undefined
    const parts: Parameters<typeof joinParts>[0] = []
    for (let page = 1; page <= count; page++) {
      const text = embeddedPages[page - 1].trim()
      const imageHeavy =
        (imageAreas.get(page) ?? 0) / (pageSizes.get(page) ?? 612 * 792) >= 0.2
      // An embedded heading must not hide a scanned body on the same page.
      const useOcr =
        forceOcr || text.replace(/\s/g, "").length < 40 || imageHeavy
      if (!useOcr) {
        parts.push({ text, page, method: "embedded", label: `Page ${page}` })
        continue
      }
      const binary = process.env.SOURCE_TESSERACT_BIN || "/usr/bin/tesseract"
      if (!tesseractVersion) {
        const engine = await run(binary, ["--version"], deadline, 5000, 8192)
        tesseractVersion =
          /tesseract\s+([a-zA-Z0-9.+_-]+)/.exec(
            engine.stdout.toString("utf8")
          )?.[1] ?? "unknown"
      }
      const prefix = join(directory, `page-${page}`)
      await run(
        "/usr/bin/pdftoppm",
        [
          "-f",
          String(page),
          "-l",
          String(page),
          "-singlefile",
          "-r",
          "150",
          "-scale-to",
          String(SOURCE_OCR_MAX_DIMENSION),
          "-gray",
          input,
          prefix
        ],
        deadline,
        SOURCE_OCR_PAGE_TIMEOUT_MS,
        8192
      )
      const raster = await readFile(`${prefix}.pgm`)
      const rasterHeader = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(
        raster.subarray(0, 100).toString("ascii")
      )
      if (!rasterHeader)
        failure(
          "invalid_raster",
          "This PDF page could not be rendered for text recognition."
        )
      const pixelCount = Number(rasterHeader![1]) * Number(rasterHeader![2])
      if (
        pixelCount > SOURCE_OCR_MAX_DIMENSION ** 2 ||
        raster.length - rasterHeader![0].length !== pixelCount
      )
        failure(
          "raster_limit",
          "This PDF page exceeds the text-recognition image limit."
        )
      let inkPixels = 0
      for (let index = rasterHeader![0].length; index < raster.length; index++)
        if (raster[index] < 245) inkPixels++
      const result = await run(
        binary,
        [
          `${prefix}.pgm`,
          "stdout",
          "-l",
          SOURCE_OCR_LANGUAGE,
          "--psm",
          "3",
          "tsv"
        ],
        deadline,
        SOURCE_OCR_PAGE_TIMEOUT_MS,
        SOURCE_MAX_CHARACTERS * 8
      )
      const parsed = parseOcrTsv(result.stdout.toString("utf8"))
      await rm(`${prefix}.pgm`, { force: true })
      if (!parsed.text.trim()) {
        // Preserve actual blank pages; unreadable drawn text or scans are a
        // processing failure, never silently treated as a successful empty page.
        if (!text && inkPixels <= Math.max(20, pixelCount * 0.00001)) {
          parts.push({
            text: "",
            page,
            method: "ocr",
            label: `Page ${page}`,
            confidence: null
          })
          continue
        }
        failure(
          "unreadable_scan",
          `We couldn't read page ${page}. Try a clearer scan or paste its text.`
        )
      }
      parts.push({
        text: parsed.text,
        page,
        method: "ocr",
        label: `Page ${page}`,
        confidence: parsed.confidence
      })
      if (
        parts.reduce((sum, part) => sum + part.text.length, 0) >
        SOURCE_MAX_CHARACTERS
      )
        failure(
          "text_limit",
          "This source exceeds the 200,000-character text limit."
        )
    }
    const popplerVersion =
      /version\s+([a-zA-Z0-9.+_-]+)/.exec(
        version.stderr.toString("utf8") + version.stdout.toString("utf8")
      )?.[1] ?? "unknown"
    return joinParts(
      parts,
      `${SOURCE_PARSER_VERSION}; poppler:${popplerVersion}${tesseractVersion ? `; tesseract:${tesseractVersion}; lang:${SOURCE_OCR_LANGUAGE}; dpi:150; max-dimension:${SOURCE_OCR_MAX_DIMENSION}` : ""}`
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
