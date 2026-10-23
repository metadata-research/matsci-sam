import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  FieldDraftRecovery,
  recoveryKey,
  sameRecoveryPayload
} from "../components/metadata-workspace/field-draft-recovery"
import { TermDraftSaveQueue } from "../lib/term-draft-save-queue"
import {
  emptyMatcoreDraftPayload,
  matcoreDraftPayloadSchema
} from "../lib/matcore-workflow-types"

function store() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    }
  }
}
const original = emptyMatcoreDraftPayload()
original.label = "Creation date"
original.definition = "The date the dataset was created."
const edit = {
  ...original,
  definition: "The date the dataset was first created."
}
const later = {
  ...edit,
  rationale: "Keep later writing while an earlier save finishes."
}
function record(id: string, payload = original, version = 1, ownerId = 1) {
  return { id, ownerId, version, status: "draft", payload }
}

{
  const storage = store(),
    id = randomUUID()
  const first = new FieldDraftRecovery(1, id, () => storage)
  assert.deepEqual(first.load(record(id)), { kind: "none" })
  first.capture(record(id), edit, true)
  assert.equal(storage.data.size, 1)
  assert.equal(JSON.parse(storage.getItem(recoveryKey(1, id))!).baseVersion, 1)
  const returned = new FieldDraftRecovery(1, id, () => storage)
  const recovered = returned.load(record(id))
  assert.equal(recovered.kind, "recover")
  assert.equal(returned.recovered, true)
  if (recovered.kind === "recover")
    assert.equal(recovered.entry.payload.definition, edit.definition)
  returned.capture(record(id, edit, 2), later, true)
  assert.equal(
    returned.recovered,
    true,
    "An earlier acknowledgement cannot clear newer writing"
  )
  assert.equal(JSON.parse(storage.getItem(recoveryKey(1, id))!).baseVersion, 2)
  first.capture(record(id, edit, 2), edit, false)
  assert.equal(
    JSON.parse(storage.getItem(recoveryKey(1, id))!).payload.rationale,
    later.rationale,
    "An old editor's completion cannot clear the current editor's copy"
  )
  returned.capture(record(id, later, 3), later, false)
  assert.equal(storage.getItem(recoveryKey(1, id)), null)
  assert.equal(returned.recovered, false)
}
{
  const storage = store(),
    id = randomUUID()
  const first = new FieldDraftRecovery(1, id, () => storage)
  first.load(record(id))
  first.capture(record(id), edit, true)
  const otherOwner = new FieldDraftRecovery(2, id, () => storage)
  assert.equal(otherOwner.load(record(id, original, 1, 2)).kind, "none")
  assert.throws(() => otherOwner.load(record(id)), /does not match/)
  const stale = new FieldDraftRecovery(1, id, () => storage)
  const recovered = stale.load(
    record(id, { ...original, definition: "A newer server definition." }, 4)
  )
  assert.equal(recovered.kind, "conflict")
  if (recovered.kind === "conflict")
    assert.equal(recovered.entry.baseVersion, 1)
  stale.discard()
  assert.equal(
    new FieldDraftRecovery(1, id, () => storage).load(record(id)).kind,
    "none"
  )
}
{
  const storage = store(),
    id = randomUUID()
  const first = new FieldDraftRecovery(1, id, () => storage)
  first.load(record(id))
  first.capture(record(id), edit, true)
  const reconciled = new FieldDraftRecovery(1, id, () => storage)
  assert.equal(
    reconciled.load(record(id, edit, 2)).kind,
    "none",
    "A lost successful response is reconciled by the exact saved payload"
  )
  assert.equal(storage.getItem(recoveryKey(1, id)), null)
}
{
  const storage = store(),
    id = randomUUID()
  const unavailable = () => ({
    ...storage,
    setItem: () => {
      throw new Error("Quota exceeded")
    }
  })
  const first = new FieldDraftRecovery(1, id, unavailable)
  first.load(record(id))
  first.capture(record(id), edit, true)
  assert.match(first.warning ?? "", /memory only/)
  const returned = new FieldDraftRecovery(1, id, unavailable)
  assert.equal(returned.load(record(id)).kind, "recover")
  assert.match(returned.warning ?? "", /memory only/)
  returned.discard()
}
for (const invalid of [
  "not JSON",
  "x".repeat(400_001),
  JSON.stringify({
    schemaVersion: 1,
    ownerId: 99,
    draftId: randomUUID(),
    baseVersion: 1,
    payload: original
  }),
  JSON.stringify({
    schemaVersion: 1,
    ownerId: 1,
    draftId: randomUUID(),
    baseVersion: -2,
    payload: { ...original, citations: [{ url: "javascript:alert(1)" }] }
  })
]) {
  const storage = store(),
    id = randomUUID()
  storage.setItem(recoveryKey(1, id), invalid)
  const recovery = new FieldDraftRecovery(1, id, () => storage)
  assert.equal(recovery.load(record(id)).kind, "invalid")
  assert.match(recovery.warning ?? "", /could not be read/)
  assert.equal(recovery.recovered, false)
}
{
  const storage = store(),
    id = randomUUID()
  const recovery = new FieldDraftRecovery(1, id, () => storage)
  recovery.load(record(id))
  recovery.capture(record(id), edit, true)
  const published = new FieldDraftRecovery(1, id, () => storage)
  assert.equal(
    published.load({ ...record(id, original, 2), status: "published" }).kind,
    "conflict"
  )
  assert.ok(
    storage.getItem(recoveryKey(1, id)),
    "Another tab publishing must preserve divergent writing for copying"
  )
  published.discard()
  const equal = new FieldDraftRecovery(1, id, () => storage)
  equal.load(record(id))
  equal.capture(record(id), edit, true)
  assert.equal(
    new FieldDraftRecovery(1, id, () => storage).load({
      ...record(id, edit, 2),
      status: "published"
    }).kind,
    "none"
  )
}
assert.equal(
  sameRecoveryPayload(original, JSON.parse(JSON.stringify(original))),
  true
)
assert.equal(sameRecoveryPayload(original, edit), false)
{
  const storage = store(),
    id = randomUUID()
  const unicode = {
    ...original,
    specification: {
      ...original.specification,
      allowedValues: Array.from(
        { length: 100 },
        (_, i) => `${i}${"材".repeat(450)}`
      )
    }
  }
  assert.ok(matcoreDraftPayloadSchema.safeParse(unicode).success)
  assert.ok(new TextEncoder().encode(JSON.stringify(unicode)).length > 110_000)
  const first = new FieldDraftRecovery(1, id, () => storage)
  first.load(record(id))
  first.capture(record(id), unicode, true)
  assert.equal(first.warning, null)
  const loaded = new FieldDraftRecovery(1, id, () => storage).load(record(id))
  assert.equal(loaded.kind, "recover")
  if (loaded.kind === "recover") assert.deepEqual(loaded.entry.payload, unicode)
}

async function uncertainReversion() {
  const storage = store(),
    id = randomUUID()
  const first = new FieldDraftRecovery(1, id, () => storage)
  first.load(record(id))
  first.capture(record(id), original, true)
  const returned = new FieldDraftRecovery(1, id, () => storage)
  const restored = returned.load(record(id))
  assert.equal(
    restored.kind,
    "recover",
    "An old request may still commit after a same-version read; the intended reversion needs acknowledgement"
  )
  assert.ok(restored.kind === "recover")
  let calls = 0
  let server = record(id)
  const queue = new TermDraftSaveQueue(original, {
    create: async () => {
      throw new Error("Unexpected create")
    },
    update: async (input: {
      id: string
      payload: typeof original
      expectedVersion: number
      mutationId: string
    }) => {
      calls++
      assert.equal(
        input.expectedVersion,
        1,
        "Recovered work never adopts a newer base"
      )
      if (server.version !== input.expectedVersion)
        throw Object.assign(new Error("Newer saved row"), {
          data: { code: "CONFLICT" }
        })
      server = record(id, input.payload, server.version + 1)
      return server
    },
    meaningful: () => true,
    uuid: randomUUID,
    changed: () => {}
  })
  queue.restore(record(id), restored.entry.payload, {
    requireAcknowledgement: true
  })
  assert.equal(queue.dirty, true)
  await queue.flush()
  assert.equal(
    calls,
    1,
    "An identical recovered payload still receives a version-checked acknowledgement"
  )
  returned.capture(server, queue.payload, queue.dirty)
  assert.equal(returned.recovered, false)
  assert.equal(storage.getItem(recoveryKey(1, id)), null)

  queue.restore(record(id), original, { requireAcknowledgement: true })
  server = record(id, edit, 2) // The old request completed before retry.
  await assert.rejects(queue.flush(), /Newer saved row/)
  assert.deepEqual(
    queue.payload,
    original,
    "A late old commit cannot erase the intended reversion"
  )
  assert.equal(queue.dirty, true)
  assert.equal(
    server.payload.definition,
    edit.definition,
    "Conflict never overwrites the newer saved row"
  )
}
uncertainReversion().then(() =>
  console.log(
    "MatCore draft recovery scope, conflict, acknowledgement, Unicode and storage checks passed."
  )
)
