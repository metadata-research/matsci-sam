import {
  extractSourceDocument,
  SourceDocumentError
} from "../lib/source-document-extraction"

/** Produces one terminal result, including a missing input after claiming a job. */
export async function sourceDocumentWorkerResult(
  file: { bytes: Uint8Array | null; mediaType: string } | undefined,
  forceOcr: boolean
) {
  try {
    if (!file?.bytes?.length)
      throw new SourceDocumentError(
        "missing_source",
        "The original source file is unavailable. Attach the source again."
      )
    const result = await extractSourceDocument({
      bytes: file.bytes,
      mediaType: file.mediaType,
      forceOcr
    })
    return {
      update: {
        ...result,
        status: "ready" as const,
        completedAt: new Date().toISOString()
      },
      event: {
        event: "source_ready",
        pages: result.pages.length,
        ocr: result.hasOcr
      }
    }
  } catch (error) {
    return {
      update: {
        status: "failed" as const,
        completedAt: new Date().toISOString(),
        error:
          error instanceof SourceDocumentError
            ? error.message
            : "This document could not be read. Try a readable PDF, DOCX or plain text."
      },
      event: {
        event: "source_failed",
        category:
          error instanceof SourceDocumentError ? error.code : "processing"
      }
    }
  }
}
