import "server-only"

import {
  getGoogleAuthAccessMode,
  isGoogleAuthConfigured
} from "@/lib/apis/google"
import { isOrcidAccountCreationEnabled } from "@/lib/apis/orcid"
import { isEmailAccountCreationEnabled } from "@/lib/email-auth"

export const getAccountCreationMethods = () => ({
  google: isGoogleAuthConfigured() && getGoogleAuthAccessMode() === "open",
  orcid: isOrcidAccountCreationEnabled(),
  email: isEmailAccountCreationEnabled()
})

export const isAccountCreationEnabled = () => {
  const methods = getAccountCreationMethods()
  return methods.google || methods.orcid || methods.email
}
