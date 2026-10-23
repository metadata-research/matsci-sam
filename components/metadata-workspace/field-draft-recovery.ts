import { z } from "zod"
import {
  matcoreDraftPayloadSchema,
  type MatCoreDraftPayload
} from "@/lib/matcore-workflow-types"

// The server accepts 100,000 UTF-16 code units; UTF-8 can use three bytes
// per code unit, plus the small recovery envelope.
const MAX_RECOVERY_BYTES = 400_000
const envelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    ownerId: z.number().int().positive(),
    draftId: z.string().uuid(),
    baseVersion: z.number().int().positive(),
    requiresAcknowledgement: z.boolean().default(false),
    payload: matcoreDraftPayloadSchema
  })
  .strict()
type Envelope = z.infer<typeof envelopeSchema>
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">
type SavedRecord = {
  id: string
  ownerId: number
  version: number
  status: string
  payload: MatCoreDraftPayload
}
export type RecoveryResult =
  | { kind: "none" | "invalid" }
  | { kind: "recover" | "conflict"; entry: Envelope }

// These maps live only in this browser context. They preserve a failed save
// across App Router unmounts when sessionStorage is unavailable. Entries are
// removed when acknowledged/discarded; each payload has the draft's 100KB cap.
const memory = new Map<string, Envelope>()
const active = new Map<string, FieldDraftRecovery>()
const memoryOnly = new Set<string>()
const discarded = new Set<string>()
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, part: unknown) =>
    part !== null && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(
          Object.entries(part).sort(([a], [b]) => a.localeCompare(b))
        )
      : part
  )
export const recoveryKey = (ownerId: number, draftId: string) =>
  `matsci:field-draft-recovery:v1:${ownerId}:${draftId}`
export function sameRecoveryPayload(
  a: MatCoreDraftPayload,
  b: MatCoreDraftPayload
) {
  const left = matcoreDraftPayloadSchema.safeParse(a)
  const right = matcoreDraftPayloadSchema.safeParse(b)
  return (
    left.success &&
    right.success &&
    canonical(left.data) === canonical(right.data)
  )
}

/** A recovery copy never upgrades its base version to an unrelated saved row. */
export class FieldDraftRecovery {
  readonly key: string
  recovered = false
  warning: string | null = null
  private started = false
  constructor(
    readonly ownerId: number,
    readonly draftId: string,
    private readonly storage: () => StorageLike | null = () =>
      typeof window === "undefined" ? null : window.sessionStorage
  ) {
    this.key = recoveryKey(ownerId, draftId)
  }

  private unavailable() {
    this.warning =
      "Browser storage is unavailable. Unsaved changes are kept in this app’s memory only; save to your account before closing or reloading this tab."
  }
  private read(): Envelope | null | "invalid" {
    if (discarded.has(this.key)) return null
    const fallback = memory.get(this.key)
    if (fallback) {
      if (memoryOnly.has(this.key)) this.unavailable()
      return fallback
    }
    let raw: string | null
    try {
      const store = this.storage()
      if (!store) {
        this.unavailable()
        return null
      }
      raw = store.getItem(this.key)
    } catch {
      this.unavailable()
      return null
    }
    if (!raw) return null
    if (new TextEncoder().encode(raw).length > MAX_RECOVERY_BYTES)
      return "invalid"
    try {
      const parsed = envelopeSchema.safeParse(JSON.parse(raw))
      if (
        !parsed.success ||
        parsed.data.ownerId !== this.ownerId ||
        parsed.data.draftId !== this.draftId
      )
        return "invalid"
      return parsed.data
    } catch {
      return "invalid"
    }
  }

  load(record: SavedRecord): RecoveryResult {
    if (record.ownerId !== this.ownerId || record.id !== this.draftId)
      throw new Error("Recovery account or draft does not match.")
    active.set(this.key, this)
    const entry = this.read()
    this.started = true
    if (entry === "invalid") {
      this.warning =
        "This tab’s recovery copy could not be read. The account’s saved draft is shown; the unreadable copy has not been used."
      return { kind: "invalid" }
    }
    if (!entry) return { kind: "none" }
    if (
      sameRecoveryPayload(record.payload, entry.payload) &&
      (!entry.requiresAcknowledgement ||
        record.version > entry.baseVersion ||
        record.status !== "draft")
    ) {
      this.discard()
      return { kind: "none" }
    }
    this.recovered = true
    return {
      kind:
        record.status === "draft" && record.version === entry.baseVersion
          ? "recover"
          : "conflict",
      entry
    }
  }

  withoutCapturing(run: () => void) {
    const started = this.started
    this.started = false
    try {
      run()
    } finally {
      this.started = started
    }
  }

  capture(record: SavedRecord, payload: MatCoreDraftPayload, dirty: boolean) {
    if (!this.started || active.get(this.key) !== this) return
    if (record.ownerId !== this.ownerId || record.id !== this.draftId) return
    if (!dirty) {
      if (sameRecoveryPayload(record.payload, payload)) this.discard()
      return
    }
    if (record.status !== "draft") return
    const parsed = envelopeSchema.safeParse({
      schemaVersion: 1,
      ownerId: this.ownerId,
      draftId: this.draftId,
      baseVersion: record.version,
      requiresAcknowledgement: true,
      payload
    })
    if (!parsed.success) {
      this.warning =
        "The recovery copy could not be updated because this writing exceeds the draft limits. Correct the invalid fields and save before leaving."
      return
    }
    const raw = JSON.stringify(parsed.data)
    if (new TextEncoder().encode(raw).length > MAX_RECOVERY_BYTES) {
      this.warning =
        "The recovery copy is too large. Save to your account before leaving this page."
      return
    }
    memory.set(this.key, parsed.data)
    discarded.delete(this.key)
    try {
      const store = this.storage()
      if (!store) {
        memoryOnly.add(this.key)
        this.unavailable()
        return
      }
      store.setItem(this.key, raw)
      memoryOnly.delete(this.key)
      this.warning = null
    } catch {
      memoryOnly.add(this.key)
      this.unavailable()
    }
  }

  discard() {
    if (active.get(this.key) !== this) return
    memory.delete(this.key)
    memoryOnly.delete(this.key)
    discarded.add(this.key)
    this.recovered = false
    try {
      const store = this.storage()
      if (!store) {
        this.unavailable()
        return
      }
      store.removeItem(this.key)
      this.warning = null
    } catch {
      this.unavailable()
    }
  }
}
