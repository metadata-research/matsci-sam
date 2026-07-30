import "server-only"

import { z } from "zod"
import {
  createOneTimeToken,
  hashOneTimeToken,
  oneTimeTokenExpiry
} from "@/lib/auth-tokens"
export { EmailAuthIntentSchema } from "@/lib/email-auth-intent"

export const EmailAddressSchema = z
  .string()
  .trim()
  .email("Enter a valid email address")
  .max(254)
  .transform((value) => value.toLowerCase())

export const isEmailAuthEnabled = () =>
  process.env.EMAIL_AUTH_ENABLED === "true"

export const isEmailAccountCreationEnabled = () =>
  isEmailAuthEnabled() &&
  process.env.EMAIL_AUTH_ACCOUNT_CREATION_ENABLED === "true"

export const getAuthSiteUrl = () => {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!raw)
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is required for passwordless email authentication"
    )

  const url = new URL(raw)
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !isLocal)
    throw new Error(
      "NEXT_PUBLIC_SITE_URL must use HTTPS outside local development"
    )

  return url
}

export const createEmailAuthToken = createOneTimeToken

export const hashEmailAuthToken = hashOneTimeToken

export const getEmailAuthTokenLifetimeMinutes = () => {
  const raw = process.env.EMAIL_AUTH_TOKEN_TTL_MINUTES?.trim() || "15"
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 5 || value > 60)
    throw new Error(
      "EMAIL_AUTH_TOKEN_TTL_MINUTES must be an integer from 5 to 60"
    )
  return value
}

export const emailAuthTokenExpiry = (now = Date.now()) =>
  oneTimeTokenExpiry({
    lifetimeMinutes: getEmailAuthTokenLifetimeMinutes(),
    now
  })
