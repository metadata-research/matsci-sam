import "server-only"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const VERSION = "v1"

const encryptionKey = () => {
  const encoded = process.env.AUTH_TOKEN_ENCRYPTION_KEY?.trim()
  if (!encoded)
    throw new Error(
      "AUTH_TOKEN_ENCRYPTION_KEY is required for external authentication"
    )

  const key = Buffer.from(encoded, "base64")
  if (key.length !== 32)
    throw new Error(
      "AUTH_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
    )

  return key
}

export const validateAuthTokenEncryptionKey = () => {
  encryptionKey()
}

export const encryptAuthToken = (value: string) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".")
}

export const decryptAuthToken = (value: string) => {
  const [version, encodedIv, encodedTag, encodedValue] = value.split(".")
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedValue)
    throw new Error("Unsupported encrypted authentication token")

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(encodedIv, "base64url")
  )
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"))

  return Buffer.concat([
    decipher.update(Buffer.from(encodedValue, "base64url")),
    decipher.final()
  ]).toString("utf8")
}
