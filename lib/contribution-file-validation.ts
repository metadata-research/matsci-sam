import { CONTRIBUTION_FILE_MAX_BYTES } from "./contribution-file-types"

export class ContributionFileError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

export function validateContributionFile(
  bytes: Uint8Array,
  declaredType: string
) {
  if (!bytes.length || bytes.length > CONTRIBUTION_FILE_MAX_BYTES)
    throw new ContributionFileError(
      "Choose a file between 1 byte and 5 MB.",
      413
    )
  const starts = (signature: number[]) =>
    signature.every((n, i) => bytes[i] === n)
  const mediaType = starts([0x25, 0x50, 0x44, 0x46, 0x2d])
    ? "application/pdf"
    : starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? "image/png"
      : starts([0xff, 0xd8, 0xff])
        ? "image/jpeg"
        : null
  if (
    !mediaType ||
    declaredType.split(";", 1)[0].trim().toLowerCase() !== mediaType
  )
    throw new ContributionFileError(
      "Choose a PDF, PNG, or JPEG with a matching file type.",
      415
    )
  return mediaType
}

export async function readBoundedContributionBody(
  request: Request,
  maximumBytes = CONTRIBUTION_FILE_MAX_BYTES
) {
  const declared = request.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes))
    throw new ContributionFileError("Files must be 5 MB or smaller.", 413)
  if (!request.body) throw new ContributionFileError("Choose a file to attach.")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximumBytes) {
        await reader.cancel()
        throw new ContributionFileError("Files must be 5 MB or smaller.", 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

export function safeContributionFilename(filename: string) {
  return (
    filename.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) || "attachment"
  )
}

export function contributionFileDownloadHeaders(
  filename: string,
  mediaType: string,
  byteSize: number
) {
  const safeName = safeContributionFilename(filename)
  const ascii = safeName.replace(/[^\x20-\x7e]|[";]/g, "_")
  return {
    "Content-Type": mediaType,
    "Content-Length": String(byteSize),
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safeName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, no-store"
  }
}

export const readContributionFileBody = (request: Request) =>
  readBoundedContributionBody(request)

export async function readContributionUpload(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.startsWith("multipart/form-data;"))
    throw new ContributionFileError("Upload a file with its details.", 415)
  const body = await readBoundedContributionBody(
    request,
    CONTRIBUTION_FILE_MAX_BYTES + 64 * 1024
  )
  let fields: FormData
  try {
    fields = await new Response(new Uint8Array(body), {
      headers: { "Content-Type": contentType }
    }).formData()
  } catch {
    throw new ContributionFileError("The file upload could not be read.")
  }
  const file = fields.get("file")
  const metadata = fields.get("metadata")
  if (
    fields.getAll("file").length !== 1 ||
    fields.getAll("metadata").length !== 1 ||
    !file ||
    typeof file === "string" ||
    typeof metadata !== "string" ||
    metadata.length > 16000
  )
    throw new ContributionFileError("Choose one file and provide its details.")
  let decoded: unknown
  try {
    decoded = JSON.parse(metadata)
  } catch {
    throw new ContributionFileError("File details could not be read.")
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  validateContributionFile(bytes, file.type)
  return { bytes, declaredType: file.type, metadata: decoded }
}
