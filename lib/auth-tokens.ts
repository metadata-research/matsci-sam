import { createHash, randomBytes } from "node:crypto"

export const createOneTimeToken = () => randomBytes(32).toString("base64url")

export const hashOneTimeToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex")

export const oneTimeTokenExpiry = ({
  lifetimeMinutes,
  now = Date.now()
}: {
  lifetimeMinutes: number
  now?: number
}) => new Date(now + lifetimeMinutes * 60 * 1000).toISOString()
