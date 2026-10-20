import { IMPORT_DRAFT_MAX_BYTES } from "./import-draft-types"

/** Preserve the decoded input, including a BOM, so its saved hash is exact. */
export function decodeDraftImportFile(bytes: ArrayBuffer | Uint8Array): string {
  if (bytes.byteLength > IMPORT_DRAFT_MAX_BYTES)
    throw new Error("Choose a file smaller than 1 MB.")
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes
    )
  } catch {
    throw new Error(
      "This file is not valid UTF-8. Save the spreadsheet as UTF-8 CSV or TSV, then choose it again. Your existing input has not been changed."
    )
  }
}
