import assert from "node:assert/strict"
import { TermDraftSaveQueue } from "../lib/term-draft-save-queue"

type Payload = { text: string }
type Record = { id: string; version: number; payload: Payload; status: string }
const record = (payload: Payload, version = 1): Record => ({
  id: "draft",
  version,
  payload,
  status: "draft"
})
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function main() {
  let ids = 0
  const first = deferred<Record>()
  const writes: Array<{
    payload: Payload
    expectedVersion?: number
    mutationId?: string
  }> = []
  const queue = new TermDraftSaveQueue<Payload, Record>(
    { text: "" },
    {
      meaningful: (p) => !!p.text.trim(),
      uuid: () => `id-${++ids}`,
      changed() {},
      async create(input) {
        writes.push(input)
        return first.promise
      },
      async update(input) {
        writes.push(input)
        return record(input.payload, input.expectedVersion + 1)
      }
    }
  )
  const acknowledgements: Array<{ version: number; localText: string }> = []
  queue.setOnSaved((saved) => {
    acknowledgements.push({
      version: saved.version,
      localText: queue.payload.text
    })
  })
  assert.equal(
    await queue.flush(),
    null,
    "Untouched empty editors create no draft"
  )
  queue.update({ text: "first" })
  const saving = queue.flush()
  queue.update({ text: "newer writing" })
  first.resolve(record({ text: "first" }))
  await saving
  assert.equal(writes.length, 2)
  assert.equal(writes[1].expectedVersion, 1)
  assert.equal(writes[1].payload.text, "newer writing")
  assert.equal(
    queue.payload.text,
    "newer writing",
    "A late save response cannot replace newer writing"
  )
  assert.equal(queue.dirty, false)
  assert.deepEqual(
    acknowledgements,
    [
      { version: 1, localText: "newer writing" },
      { version: 2, localText: "newer writing" }
    ],
    "Acknowledgements arrive before flush resolves and never restore older writing"
  )
  await queue.flush()
  queue.restore(record({ text: "newer writing" }, 2))
  assert.equal(
    acknowledgements.length,
    2,
    "Clean flushes and restores do not replay save acknowledgements"
  )

  // The wizard immediately leaves Terms after its first successful save. The
  // next editor must see the same ID even if no React effect has run yet.
  const firstAcknowledgement = deferred<Record>()
  let parentDraftId: string | null = null
  let latestListenerCalls = 0
  const handoffQueue = new TermDraftSaveQueue<Payload, Record>(
    { text: "first term" },
    {
      meaningful: (payload) => !!payload.text,
      uuid: () => `id-${++ids}`,
      changed() {},
      async create() {
        return firstAcknowledgement.promise
      },
      async update(input) {
        return record(input.payload, input.expectedVersion + 1)
      }
    }
  )
  const removeOldListener = handoffQueue.setOnSaved(() => {
    throw new Error("The replaced listener must not run")
  })
  const handoff = handoffQueue.flush().then((saved) => {
    assert.equal(
      parentDraftId,
      saved?.id,
      "The parent has the draft ID before Back can unmount Terms"
    )
  })
  handoffQueue.setOnSaved((saved) => {
    parentDraftId = saved.id
    latestListenerCalls += 1
  })
  removeOldListener()
  firstAcknowledgement.resolve(record({ text: "first term" }))
  await handoff
  assert.equal(
    latestListenerCalls,
    1,
    "An in-flight save uses the latest callback once"
  )

  const detachedSave = deferred<Record>()
  let navigation = "/add?draftId=newer-editor"
  const detachedQueue = new TermDraftSaveQueue<Payload, Record>(
    { text: "old editor writing" },
    {
      meaningful: () => true,
      uuid: () => `id-${++ids}`,
      changed() {},
      async create() {
        return detachedSave.promise
      },
      async update(input) {
        return record(input.payload, input.expectedVersion + 1)
      }
    }
  )
  const detach = detachedQueue.setOnSaved((saved) => {
    navigation = `/add?draftId=${saved.id}`
  })
  const leaving = detachedQueue.flush()
  detach()
  detachedSave.resolve(record({ text: "old editor writing" }))
  await leaving
  assert.equal(
    navigation,
    "/add?draftId=newer-editor",
    "An unmounted editor cannot change a newer editor's URL"
  )
  assert.equal(
    detachedQueue.record?.version,
    1,
    "Unmount cleanup does not cancel the durable save"
  )
  assert.equal(detachedQueue.dirty, false)

  let replayCalls = 0
  const sameListener = () => {
    replayCalls += 1
  }
  const oldRegistration = detachedQueue.setOnSaved(sameListener)
  const currentRegistration = detachedQueue.setOnSaved(sameListener)
  oldRegistration()
  detachedQueue.update({ text: "effect replay writing" })
  await detachedQueue.flush()
  assert.equal(
    replayCalls,
    1,
    "Stale cleanup cannot remove a newer registration of the same callback"
  )
  currentRegistration()
  detachedQueue.update({ text: "save after final cleanup" })
  await detachedQueue.flush()
  assert.equal(
    replayCalls,
    1,
    "The current registration stops receiving acknowledgements after cleanup"
  )

  let fail = true
  const retries: Array<{ mutationId: string; payload: Payload }> = []
  const retryQueue = new TermDraftSaveQueue<Payload, Record>(
    { text: "saved" },
    {
      meaningful: () => true,
      uuid: () => `id-${++ids}`,
      changed() {},
      async create(input) {
        return record(input.payload)
      },
      async update(input) {
        retries.push(input)
        if (fail) {
          fail = false
          throw new Error("Response lost after commit")
        }
        return record(input.payload, input.expectedVersion + 1)
      }
    }
  )
  retryQueue.restore(record({ text: "saved" }))
  retryQueue.update({ text: "attempted" })
  await assert.rejects(retryQueue.flush(), /Response lost/)
  retryQueue.update({ text: "kept typing offline" })
  await assert.rejects(
    retryQueue.flush(),
    /Response lost/,
    "Failed saves stop automatic retries"
  )
  await retryQueue.flush(true)
  assert.equal(
    retries[0].mutationId,
    retries[1].mutationId,
    "Unknown outcomes retry the exact mutation"
  )
  assert.deepEqual(retries[0].payload, retries[1].payload)
  assert.notEqual(retries[1].mutationId, retries[2].mutationId)
  assert.equal(retryQueue.payload.text, "kept typing offline")
  assert.equal(retryQueue.record?.version, 3)

  const corrected: Payload[] = []
  const validationQueue = new TermDraftSaveQueue<Payload, Record>(
    { text: "" },
    {
      meaningful: () => true,
      uuid: () => `id-${++ids}`,
      changed() {},
      async create(input) {
        return record(input.payload)
      },
      async update(input) {
        corrected.push(input.payload)
        if (input.payload.text === "invalid attachment")
          throw Object.assign(new Error("Remove unavailable attachment"), {
            data: { code: "BAD_REQUEST" }
          })
        return record(input.payload, input.expectedVersion + 1)
      }
    }
  )
  validationQueue.restore(record({ text: "saved" }))
  validationQueue.update({ text: "invalid attachment" })
  await assert.rejects(validationQueue.flush(), /Remove unavailable/)
  validationQueue.update({ text: "corrected attachment" })
  await validationQueue.flush(true)
  assert.deepEqual(
    corrected.map((p) => p.text),
    ["invalid attachment", "corrected attachment"],
    "A rejected payload does not trap corrected writing in a retry loop"
  )

  const conflict = new Error("Edited elsewhere")
  const conflictQueue = new TermDraftSaveQueue<Payload, Record>(
    { text: "" },
    {
      meaningful: () => true,
      uuid: () => "id",
      changed() {},
      async create(input) {
        return record(input.payload)
      },
      async update() {
        throw conflict
      }
    }
  )
  conflictQueue.restore(record({ text: "remote old" }))
  conflictQueue.update({ text: "my unsaved writing" })
  await assert.rejects(conflictQueue.flush(), /Edited elsewhere/)
  assert.equal(conflictQueue.payload.text, "my unsaved writing")
  conflictQueue.restore(record({ text: "remote new" }, 5))
  assert.equal(conflictQueue.error, null)
  assert.equal(
    conflictQueue.payload.text,
    "remote new",
    "Only an explicit reload replaces local writing"
  )
  conflictQueue.stop()
  conflictQueue.update({ text: "late effect" })
  assert.equal(
    conflictQueue.dirty,
    false,
    "Publication prevents late saves from reopening a draft"
  )
  console.log("Term draft save queue checks passed")
}
void main()
