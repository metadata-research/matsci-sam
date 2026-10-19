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

  // JSONB can return object keys in a different order from the editor's
  // projection. Merely opening that saved draft must not create a new version.
  type SelectionPayload = {
    definition: string
    editorState: {
      step: string
      references: Array<{ lookupId: string; cited: boolean }>
    }
  }
  type SelectionRecord = Omit<Record, "payload"> & {
    payload: SelectionPayload
  }
  const renderedSelection: SelectionPayload = {
    definition: "Saved writing",
    editorState: {
      step: "review",
      references: [
        { lookupId: "first", cited: true },
        { lookupId: "second", cited: false }
      ]
    }
  }
  const restoredSelection: SelectionPayload = {
    editorState: {
      references: [
        { cited: true, lookupId: "first" },
        { cited: false, lookupId: "second" }
      ],
      step: "review"
    },
    definition: "Saved writing"
  }
  assert.deepEqual(restoredSelection, renderedSelection)
  assert.notEqual(
    JSON.stringify(restoredSelection),
    JSON.stringify(renderedSelection)
  )
  const selectionWrites: SelectionPayload[] = []
  const selectionQueue = new TermDraftSaveQueue<
    SelectionPayload,
    SelectionRecord
  >(renderedSelection, {
    meaningful: (payload) => !!payload.definition,
    uuid: () => `id-${++ids}`,
    changed() {},
    async create() {
      throw new Error("This fixture already has a saved draft")
    },
    async update(input) {
      selectionWrites.push(input.payload)
      return {
        id: input.id,
        version: input.expectedVersion + 1,
        payload: input.payload,
        status: "draft"
      }
    }
  })
  selectionQueue.restore({
    id: "draft",
    version: 1,
    payload: restoredSelection,
    status: "draft"
  })
  selectionQueue.update(renderedSelection)
  assert.equal(
    selectionQueue.dirty,
    false,
    "Object key order alone cannot dirty a restored draft or cause a phantom save"
  )
  await selectionQueue.flush()
  assert.equal(selectionWrites.length, 0)
  assert.equal(selectionQueue.record?.version, 1)
  const reorderedSelection = {
    ...renderedSelection,
    editorState: {
      ...renderedSelection.editorState,
      references: [...renderedSelection.editorState.references].reverse()
    }
  }
  selectionQueue.update(reorderedSelection)
  assert.equal(selectionQueue.dirty, true, "Array order remains meaningful")
  await selectionQueue.flush()
  assert.equal(selectionWrites.length, 1)
  assert.equal(
    JSON.stringify(selectionWrites[0]),
    JSON.stringify(reorderedSelection),
    "Comparison must not rewrite the submitted payload"
  )
  const changedSelection = {
    ...reorderedSelection,
    editorState: {
      ...reorderedSelection.editorState,
      references: reorderedSelection.editorState.references.map(
        (reference, index) =>
          index === 0 ? { ...reference, cited: !reference.cited } : reference
      )
    }
  }
  selectionQueue.update(changedSelection)
  assert.equal(selectionQueue.dirty, true, "Nested citation edits remain dirty")
  await selectionQueue.flush()
  assert.equal(selectionWrites.length, 2)
  assert.deepEqual(selectionWrites[1], changedSelection)
  assert.equal(selectionQueue.record?.version, 3)
  assert.equal(selectionQueue.dirty, false)

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

  // A server commit can succeed even when its response never reaches the
  // browser. Reverting a citation/text change must not make that unknown
  // outcome clean: acknowledge the original request before saving the revert.
  for (const revertBeforeRetry of [false, true]) {
    type Update = {
      id: string
      payload: Payload
      expectedVersion: number
      mutationId: string
    }
    const previous = { text: "Citation unchecked" }
    const attempted = { text: "Citation checked" }
    let remote = record(previous)
    let committed: Update | null = null
    const requests: Update[] = []
    const uncertainQueue = new TermDraftSaveQueue<Payload, Record>(previous, {
      meaningful: () => true,
      uuid: () => `id-${++ids}`,
      changed() {},
      async create() {
        throw new Error("This fixture already has a saved draft")
      },
      async update(input) {
        requests.push(structuredClone(input))
        if (input.mutationId === committed?.mutationId) {
          assert.deepEqual(input, committed)
          return structuredClone(remote)
        }
        assert.equal(input.expectedVersion, remote.version)
        remote = record(structuredClone(input.payload), remote.version + 1)
        committed = structuredClone(input)
        if (requests.length === 1) throw new Error("Response lost after commit")
        return structuredClone(remote)
      }
    })
    uncertainQueue.restore(structuredClone(remote))
    uncertainQueue.update(attempted)
    await assert.rejects(uncertainQueue.flush(), /Response lost/)
    assert.deepEqual(remote.payload, attempted)
    assert.equal(remote.version, 2)
    if (revertBeforeRetry) uncertainQueue.update(previous)
    const protectedBeforeRetry = uncertainQueue.dirty
    await assert.rejects(
      uncertainQueue.flush(),
      /Response lost/,
      "An uncertain save requires an explicit retry"
    )
    await uncertainQueue.flush(true)
    assert.equal(
      requests.length,
      revertBeforeRetry ? 3 : 2,
      "Retry reconciles the committed request before saving any newer writing"
    )
    assert.deepEqual(
      requests[1],
      requests[0],
      "A lost response retries the exact identity, version and payload"
    )
    if (revertBeforeRetry) {
      assert.notEqual(requests[2].mutationId, requests[0].mutationId)
      assert.equal(requests[2].expectedVersion, 2)
      assert.deepEqual(requests[2].payload, previous)
    }
    assert.equal(
      protectedBeforeRetry,
      true,
      "Unknown server outcomes keep navigation/leave protection active even after an exact revert"
    )
    assert.deepEqual(remote.payload, revertBeforeRetry ? previous : attempted)
    assert.equal(remote.version, revertBeforeRetry ? 3 : 2)
    assert.deepEqual(uncertainQueue.payload, remote.payload)
    assert.equal(uncertainQueue.record?.version, remote.version)
    assert.equal(uncertainQueue.error, null)
    assert.equal(uncertainQueue.dirty, false)
    await uncertainQueue.flush()
    assert.equal(requests.length, revertBeforeRetry ? 3 : 2)
  }

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
