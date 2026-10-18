/** A serialized, retry-safe save queue. It never replaces newer local writing. */
export class TermDraftSaveQueue<
  P,
  R extends { id: string; version: number; payload: P | null; status: string }
> {
  payload: P
  record: R | null = null
  error: unknown = null
  saving = false
  private saved = ""
  private pending: Promise<R | null> | null = null
  private attempt: {
    id: string
    payload: P
    expectedVersion?: number
    mutationId: string
  } | null = null
  private stopped = false
  private savedListener: { notify(record: R): void } | null = null
  private acknowledgedVersion: string | null = null

  constructor(
    payload: P,
    private readonly transport: {
      create(input: { id: string; payload: P }): Promise<R>
      update(input: {
        id: string
        payload: P
        expectedVersion: number
        mutationId: string
      }): Promise<R>
      meaningful(payload: P): boolean
      uuid(): string
      changed(): void
    }
  ) {
    this.payload = payload
  }

  get dirty() {
    return (
      !this.stopped &&
      JSON.stringify(this.payload) !== this.saved &&
      (!!this.record || this.transport.meaningful(this.payload))
    )
  }

  update(payload: P) {
    this.payload = payload
    this.transport.changed()
  }

  /** Register without replaying restores or replacing newer local writing. */
  setOnSaved(listener: (record: R) => void) {
    const registration = { notify: listener }
    this.savedListener = registration
    return () => {
      // A stale cleanup must not detach a newer registration, even when it
      // happens to use the same callback (for example, effect replay).
      if (this.savedListener === registration) this.savedListener = null
    }
  }

  /** Keep the hydrated record for the editor, but compare writes using the
   * persisted representation when it differs from the restored response. */
  restore(record: R, payload: P | null = record.payload) {
    this.record = record
    if (payload !== null) this.payload = payload
    this.saved = JSON.stringify(this.payload)
    this.attempt = null
    this.error = null
    this.stopped = record.status !== "draft"
    this.transport.changed()
  }

  stop() {
    this.stopped = true
    this.transport.changed()
  }

  async flush(retry = false): Promise<R | null> {
    if (this.pending) return this.pending
    if (this.error && !retry) throw this.error
    if (!this.dirty) return this.record
    this.error = null
    this.saving = true
    this.transport.changed()
    const run = async () => {
      try {
        while (this.dirty) {
          // Retain the exact request after an unknown response, including its
          // mutation ID. The server can acknowledge a committed retry safely.
          const attempt = this.attempt ?? {
            id: this.record?.id ?? this.transport.uuid(),
            payload: this.payload,
            expectedVersion: this.record?.version,
            mutationId: this.transport.uuid()
          }
          this.attempt = attempt
          const saved =
            attempt.expectedVersion === undefined
              ? await this.transport.create({
                  id: attempt.id,
                  payload: attempt.payload
                })
              : await this.transport.update({
                  ...attempt,
                  expectedVersion: attempt.expectedVersion
                })
          this.record = saved
          this.saved = JSON.stringify(attempt.payload)
          this.attempt = null
          if (saved.status !== "draft") this.stopped = true
          // Identity must reach the owner before a flush caller can navigate
          // or unmount. A React effect can run too late and lose the new ID.
          const version = `${saved.id}:${saved.version}`
          if (this.acknowledgedVersion !== version) {
            this.acknowledgedVersion = version
            this.savedListener?.notify(saved)
          }
          this.transport.changed()
        }
        return this.record
      } catch (error) {
        const code = (error as { data?: { code?: string } } | null)?.data?.code
        if (
          code &&
          [
            "BAD_REQUEST",
            "UNAUTHORIZED",
            "FORBIDDEN",
            "NOT_FOUND",
            "CONFLICT",
            "TOO_MANY_REQUESTS",
            "PRECONDITION_FAILED",
            "UNPROCESSABLE_CONTENT"
          ].includes(code)
        )
          this.attempt = null
        this.error = error
        throw error
      } finally {
        this.saving = false
        this.pending = null
        this.transport.changed()
      }
    }
    this.pending = run()
    return this.pending
  }
}
