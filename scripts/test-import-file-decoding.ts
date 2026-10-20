import assert from "node:assert/strict"
import { decodeDraftImportFile } from "../lib/import-file-decoding"
import { IMPORT_DRAFT_MAX_BYTES } from "../lib/import-draft-types"

const unicode =
  "term,definition\r\nLi⁺ mobility,Transport at 25 °C — μm²/s.\r\n"
const utf8 = new TextEncoder().encode(unicode)
assert.equal(decodeDraftImportFile(utf8), unicode)
assert.equal(decodeDraftImportFile(utf8.slice().buffer), unicode)
const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])
assert.equal(decodeDraftImportFile(bom), `\uFEFF${unicode}`)
assert.deepEqual(new TextEncoder().encode(decodeDraftImportFile(bom)), bom)

for (const bytes of [
  [0x74, 0xe9, 0x72, 0x6d], // Latin-1 é is not a UTF-8 sequence.
  [0xe2, 0x82], // Incomplete multibyte character.
  [0xc0, 0xaf], // Overlong encoding.
  [0xed, 0xa0, 0x80], // Surrogate code point.
  [0xff, 0xfe, 0x74, 0x00] // UTF-16 byte order mark.
])
  assert.throws(
    () => decodeDraftImportFile(new Uint8Array(bytes)),
    /not valid UTF-8.*Save the spreadsheet as UTF-8 CSV or TSV.*existing input has not been changed/
  )

assert.equal(
  decodeDraftImportFile(new Uint8Array(IMPORT_DRAFT_MAX_BYTES).fill(0x61))
    .length,
  IMPORT_DRAFT_MAX_BYTES
)
assert.throws(
  () => decodeDraftImportFile(new Uint8Array(IMPORT_DRAFT_MAX_BYTES + 1)),
  /smaller than 1 MB/
)
console.log(
  "Import file decoding checks passed: strict UTF-8, Unicode, exact BOM and byte bound."
)
