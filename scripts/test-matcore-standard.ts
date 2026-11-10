import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import {
  parseMatcoreSourceManifest,
  matcoreManifestRows,
  getMatCoreStandardProfileClosure
} from "../lib/matcore-standard"
import { MATCORE_STANDARD_MANIFEST as fixture } from "./fixtures/matcore-source-fixture"
const manifest = parseMatcoreSourceManifest(fixture)
assert.equal(manifest.fields.length, 53)
assert.equal(matcoreManifestRows(manifest).length, 53)
assert.deepEqual(getMatCoreStandardProfileClosure(manifest, "mbpt"), [
  "minimal",
  "dft",
  "mbpt"
])
assert.ok(
  matcoreManifestRows(manifest).every((row) =>
    row.baseline.definition.startsWith("Invented field")
  )
)
for (const mutation of [
  (copy: typeof fixture) => {
    copy.fields.push(copy.fields[0])
  },
  (copy: typeof fixture) => {
    copy.occurrences[0].fieldId = "missing"
  },
  (copy: typeof fixture) => {
    copy.profiles[0].inherits = ["mbpt"]
  },
  (copy: typeof fixture) => {
    copy.occurrences[0].id = "matcore:other:field"
  },
  (copy: typeof fixture) => {
    copy.fields[0].source.url = "javascript:alert(1)"
  },
  (copy: typeof fixture) => {
    copy.fields[0].definition = "x".repeat(100001)
  }
]) {
  const copy = structuredClone(fixture)
  mutation(copy)
  assert.throws(() => parseMatcoreSourceManifest(copy))
}
assert.doesNotMatch(
  readFileSync("lib/matcore-standard.ts", "utf8"),
  /from ["'].*data\/matcore/
)
// Parser primitives are exercised with invented source fragments only. The
// exact reviewed corpus is validated during protected installation, not CI.
const parser = spawnSync(
  "python3",
  [
    "-B",
    "-c",
    `import importlib.util
spec=importlib.util.spec_from_file_location('parser','scripts/build-matcore-standard.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.text('<p>Invented &amp; safe</p>') == 'Invented & safe'
assert m.description_parts('<p>Definition: Invented unit. Values: Synthetic text. Repeatable: False.</p>')[:3] == ('Invented unit.','Synthetic text.',False)
try: m.build_manifest(b'Invented source fixture')
except ValueError: pass
else: raise AssertionError('Unreviewed artifact was accepted')
`
  ],
  { encoding: "utf8" }
)
assert.equal(parser.status, 0, parser.stderr)
const pdfParser = spawnSync(
  "python3",
  ["-B", "scripts/test-matcore-standard-pdf.py"],
  {
    encoding: "utf8"
  }
)
assert.equal(pdfParser.status, 0, pdfParser.stderr)
// Supplied PDFs identify a publisher separately from the document location.
const pdfFixture = structuredClone(
  fixture
) as import("../lib/matcore-standard-types").MatCoreStandardManifest
pdfFixture.release.sourceUrlRole = "publisher"
pdfFixture.release.artifactTitle = "Invented supplied PDF"
pdfFixture.fields[0].source.page = 4
const pdfRows = matcoreManifestRows(parseMatcoreSourceManifest(pdfFixture))
assert.equal(pdfRows[0].source.sourceUrlRole, "publisher")
assert.equal(pdfRows[0].source.artifactTitle, "Invented supplied PDF")
assert.equal(pdfRows[0].source.sourcePage, 4)
console.log(
  "Synthetic MatCore source validation, inheritance, parser primitives and unreviewed-source rejection passed."
)
