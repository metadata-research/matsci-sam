import { createHash } from "node:crypto"
import type { InferenceConfig } from "./config"
import { InferenceError } from "./types"

type CachedToken = { value: string; refreshAt: number }

// Process-local cache: concurrent callers share a token request. Rotation
// changes the cache key, without logging credentials or sending them to clients.
export class ClientCredentialsTokens {
  private entries = new Map<
    string,
    { token?: CachedToken; pending?: Promise<string> }
  >()
  constructor(
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
    private now = () => performance.now()
  ) {}

  private key(config: InferenceConfig) {
    return createHash("sha256")
      .update(
        JSON.stringify([config.tokenUrl, config.clientId, config.clientSecret])
      )
      .digest("hex")
  }

  invalidate(config: InferenceConfig, rejectedToken: string) {
    const entry = this.entries.get(this.key(config))
    if (entry?.token?.value === rejectedToken) entry.token = undefined
  }

  get(config: InferenceConfig): Promise<string> {
    const key = this.key(config)
    let entry = this.entries.get(key)
    if (!entry) {
      if (this.entries.size >= 16)
        this.entries.delete(this.entries.keys().next().value!)
      entry = {}
      this.entries.set(key, entry)
    }
    if (entry.token && this.now() < entry.token.refreshAt)
      return Promise.resolve(entry.token.value)
    if (entry.pending) return entry.pending
    const started = this.now()
    const pending = (async () => {
      try {
        const response = await this.fetcher(config.tokenUrl!, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(Math.min(config.timeoutMs, 15000)),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: config.clientId!,
            client_secret: config.clientSecret!
          })
        })
        if (!response.ok)
          throw new InferenceError(
            response.status === 400 ||
            response.status === 401 ||
            response.status === 403
              ? "authentication"
              : "unavailable",
            response.status === 429 || response.status >= 500
          )
        const data = await response.json()
        if (
          typeof data?.access_token !== "string" ||
          !data.access_token ||
          !Number.isFinite(data.expires_in) ||
          data.expires_in <= 0 ||
          (data.token_type &&
            String(data.token_type).toLowerCase() !== "bearer")
        )
          throw new InferenceError("authentication")
        const lifetime = data.expires_in * 1000
        entry.token = {
          value: data.access_token,
          refreshAt: started + lifetime - Math.min(30000, lifetime / 10)
        }
        return entry.token.value
      } catch (error) {
        if (error instanceof InferenceError) throw error
        throw new InferenceError("unavailable", true)
      }
    })()
    entry.pending = pending
    void pending
      .finally(() => {
        if (entry.pending === pending) entry.pending = undefined
      })
      .catch(() => {})
    return pending
  }
}

export const inferenceTokens = new ClientCredentialsTokens()
